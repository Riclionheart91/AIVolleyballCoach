/**
 * Coda offline per lo scouting.
 *
 * In palestra il segnale e' debole: se un salvataggio (punto, azione, rotazione,
 * time-out, annulla...) fallisce PER MANCANZA DI RETE non si perde e non blocca lo
 * scout. La scrittura va in una coda locale (una per partita), e viene rinviata
 * IN ORDINE appena la connessione torna (evento `online` + tentativi periodici con
 * attesa crescente).
 *
 * Regole:
 * - Si accodano SOLO gli errori di rete (o di sessione scaduta, che si risolve da sola).
 *   Gli errori di validazione/permessi (risposta del database) NON si accodano: l'azione
 *   fallisce subito col suo messaggio, come prima.
 * - Appena una partita ha voci in coda, anche le scritture successive si accodano (anche
 *   se la rete e' tornata) per non rompere l'ordine: la coda le invia una dopo l'altra.
 * - Se una voce in coda viene poi rifiutata dal database (validazione/permessi), viene
 *   scartata e segnalata, e la coda prosegue: non resta mai bloccata.
 * - Persistenza: localStorage (chiavi per partita) con ripiego in memoria. La coda si
 *   salva quindi anche se la pagina viene ricaricata, ma NON c'e' nessun service worker
 *   ne' cache dell'app: funziona se l'app e' gia' aperta quando la rete cade.
 *
 * Duplicati: il database NON offre una chiave di idempotenza (registra_evento genera
 * l'id da solo). Se la risposta si perde ma la richiesta e' arrivata, il rinvio la
 * ripeterebbe. Per gli eventi si controlla prima sul database se esiste gia' un evento
 * identico creato nella finestra del primo tentativo (vedi `eventoGiaArrivato` in
 * matches.ts); per le altre operazioni il rischio resta (vedi la relazione).
 */

const PREFISSO_CODA = "coda_offline_";
const PREFISSO_ID_NOSTRI = "coda_id_nostri_";
const PREFISSO_LOCK = "coda_lock_";
const SCADENZA_LOCK_MS = 25000;
const ATTESA_MIN_MS = 2000;
const ATTESA_MAX_MS = 30000;
const MOSTRA_TUTTO_INVIATO_MS = 4000;
const MAX_ID_NOSTRI = 100;

export interface EffettoPunteggio { setId: string; noi: number; avv: number }

export interface VoceCoda {
  /** Chiave locale univoca della voce (una voce non viene mai inviata due volte dallo stesso dispositivo). */
  id: string;
  matchId: string;
  tipo: string;
  args: Record<string, unknown>;
  descrizione: string;
  creatoIl: number;
  /** Quando e' partito il primo invio (0 = mai partito) e l'ultimo. Servono al controllo anti-duplicato. */
  primoTentativoIl: number;
  ultimoTentativoIl: number;
  /** Vero se un invio e' partito ma non si sa se il server l'ha ricevuto (risposta persa). */
  ambiguo: boolean;
  /** Effetto sul punteggio del set, mostrato in locale finche' la voce non e' inviata. */
  effetto?: EffettoPunteggio;
  /** Passi gia' completati di un'operazione a piu' passi (es. evento salvato, manca il motivo del punto). */
  parziale?: Record<string, unknown>;
}

export interface ContestoEsecuzione {
  voce: VoceCoda;
  /** Memorizza un passo gia' completato: se l'operazione si interrompe riprende da qui, senza ripeterlo. */
  salvaParziale: (p: Record<string, unknown>) => void;
}
export type Esecutore = (args: Record<string, unknown>, ctx: ContestoEsecuzione) => Promise<unknown>;

export interface StatoCoda {
  daInviare: number;
  inInvio: boolean;
  /** Il dispositivo dice di essere senza rete, oppure l'ultimo invio e' fallito per rete. */
  offline: boolean;
  /** Vero per pochi secondi dopo che la coda si e' svuotata del tutto. */
  tuttoInviato: boolean;
}

export interface OpzioniAccodamento {
  descrizione: string;
  effetto?: EffettoPunteggio;
  /** Se in coda c'e' gia' una voce identica (stesso tipo e argomenti), non se ne aggiunge un'altra. */
  senzaDoppioni?: boolean;
}

export type EsitoEsecuzione<T> = { accodato: false; risultato: T } | { accodato: true };

// ---------------------------------------------------------------------------
// Riconoscimento degli errori
// ---------------------------------------------------------------------------

const TESTO_RETE = /failed to fetch|networkerror|network request failed|network error|load failed|fetch failed|timeout|timed out|econn|enotfound|eai_again|err_internet|err_network|err_connection|offline|socket|unreachable|aborterror|the operation was aborted|bad gateway|service unavailable|gateway time-?out|\b50[234]\b/i;
const TESTO_SESSIONE = /jwt expired|pgrst301|invalid jwt/i;

function senzaRete(): boolean {
  try {
    const nav = (globalThis as any).navigator;
    return !!nav && nav.onLine === false;
  } catch { return false; }
}

/** Vero se il dispositivo stesso dice di non avere rete. */
export function dispositivoOffline(): boolean {
  return senzaRete();
}

/** Vero se l'errore e' dovuto alla mancanza di rete (la richiesta non ha avuto risposta dal database). */
export function reteNonDisponibile(e: unknown): boolean {
  if (e == null) return false;
  const o = e as any;
  const codice = typeof o.code === "string" ? o.code : "";
  // Un codice di Postgres (5 caratteri) o di PostgREST significa che il database HA risposto: non e' un problema di rete.
  if (codice && (/^[0-9A-Z]{5}$/.test(codice) || /^PGRST/.test(codice))) return false;
  const stato = typeof o.status === "number" ? o.status : null;
  if (stato === 0 || stato === 408 || stato === 502 || stato === 503 || stato === 504) return true;
  const testo = `${typeof o.message === "string" ? o.message : ""} ${typeof o.details === "string" ? o.details : ""} ${typeof e === "string" ? e : ""}`;
  // Un TypeError qualunque NON basta (potrebbe essere un errore di programmazione): conta solo il testo tipico di fetch().
  return TESTO_RETE.test(testo);
}

/** Errori che si risolvono da soli col tempo e quindi vanno rinviati: rete assente o sessione da rinnovare. */
export function erroreRitentabile(e: unknown): boolean {
  if (reteNonDisponibile(e)) return true;
  const o = e as any;
  const testo = `${typeof o?.message === "string" ? o.message : ""} ${typeof o?.code === "string" ? o.code : ""}`;
  return TESTO_SESSIONE.test(testo);
}

// ---------------------------------------------------------------------------
// Archivio (localStorage con ripiego in memoria)
// ---------------------------------------------------------------------------

const memoria = new Map<string, string>();
let lsFunziona = true;

function leggiGrezzo(chiave: string): string | null {
  if (lsFunziona) {
    try {
      const ls = (globalThis as any).localStorage;
      if (ls) return ls.getItem(chiave);
    } catch { lsFunziona = false; }
  }
  return memoria.get(chiave) ?? null;
}

function scriviGrezzo(chiave: string, valore: string | null) {
  if (valore === null) memoria.delete(chiave); else memoria.set(chiave, valore);
  if (!lsFunziona) return;
  try {
    const ls = (globalThis as any).localStorage;
    if (!ls) return;
    if (valore === null) ls.removeItem(chiave); else ls.setItem(chiave, valore);
  } catch { lsFunziona = false; /* da qui in poi si usa la memoria */ }
}

function leggiJson<T>(chiave: string, predefinito: T): T {
  try {
    const g = leggiGrezzo(chiave);
    if (!g) return predefinito;
    const v = JSON.parse(g);
    return (v ?? predefinito) as T;
  } catch { return predefinito; }
}

function leggiCoda(matchId: string): VoceCoda[] {
  const v = leggiJson<unknown>(PREFISSO_CODA + matchId, []);
  return Array.isArray(v) ? (v as VoceCoda[]) : [];
}

function scriviCoda(matchId: string, coda: VoceCoda[]) {
  scriviGrezzo(PREFISSO_CODA + matchId, coda.length === 0 ? null : JSON.stringify(coda));
}

// ---------------------------------------------------------------------------
// Stato in memoria e notifiche
// ---------------------------------------------------------------------------

const esecutori = new Map<string, Esecutore>();
const inInvio = new Set<string>();
/** Scritture partite direttamente (senza passare dalla coda) e non ancora concluse: le successive si mettono in coda dietro di loro. */
const direttiInCorso = new Map<string, Set<Promise<unknown>>>();
const voceInInvio = new Map<string, string>();
const promesseInvio = new Map<string, Promise<void>>();
const timerRitentativo = new Map<string, ReturnType<typeof setTimeout>>();
const tentativiFalliti = new Map<string, number>();
const ultimoErroreRete = new Map<string, boolean>();
const tuttoInviatoIl = new Map<string, number>();
const ascoltatori = new Map<string, Set<() => void>>();
const ascoltatoriScartate = new Map<string, Set<(descrizione: string, messaggio: string) => void>>();
const ascoltatoriInviate = new Map<string, Set<(voce: VoceCoda) => void>>();
const automatici = new Map<string, number>();
const idIstanza = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let ascoltoFinestraAttivo = false;

function notifica(matchId: string) {
  ascoltatori.get(matchId)?.forEach((cb) => { try { cb(); } catch { /* un ascoltatore non deve fermare gli altri */ } });
}

function notificaTutti() {
  ascoltatori.forEach((_set, matchId) => notifica(matchId));
}

/** Registra come si esegue un tipo di operazione (lo fanno i servizi). */
export function registraEsecutore(tipo: string, fn: Esecutore) {
  esecutori.set(tipo, fn);
}

export function statoCoda(matchId: string): StatoCoda {
  const daInviare = leggiCoda(matchId).length;
  const t = tuttoInviatoIl.get(matchId);
  return {
    daInviare,
    inInvio: inInvio.has(matchId),
    offline: daInviare > 0 && (senzaRete() || ultimoErroreRete.get(matchId) === true),
    tuttoInviato: daInviare === 0 && t !== undefined && Date.now() - t < MOSTRA_TUTTO_INVIATO_MS,
  };
}

/** Si iscrive ai cambiamenti della coda della partita. Restituisce la funzione per disiscriversi. */
export function iscriviStato(matchId: string, cb: () => void): () => void {
  installaAscoltoFinestra();
  let s = ascoltatori.get(matchId);
  if (!s) { s = new Set(); ascoltatori.set(matchId, s); }
  s.add(cb);
  return () => { s?.delete(cb); };
}

export function codaVuota(matchId: string): boolean {
  return leggiCoda(matchId).length === 0;
}

export function vociInCoda(matchId: string): VoceCoda[] {
  return leggiCoda(matchId);
}

/** Effetto cumulato sul punteggio del set, per le voci ancora in coda. */
export function effettoInCoda(matchId: string, setId: string): { noi: number; avv: number } {
  let noi = 0;
  let avv = 0;
  for (const v of leggiCoda(matchId)) {
    // Un evento gia' salvato sul database (resta solo il motivo/zone da inviare) e' gia' nel punteggio letto dal server.
    if (v.tipo === "registra_evento" && v.parziale?.eventId) continue;
    if (v.effetto && v.effetto.setId === setId) { noi += v.effetto.noi; avv += v.effetto.avv; }
  }
  return { noi, avv };
}

/**
 * Toglie dalla coda l'ultima voce di quel tipo (e, se indicato, di quel set) che NON e' in invio in questo momento.
 * Serve ad "annullare" un'azione che non e' ancora partita: basta non inviarla. Vero se l'ha tolta.
 */
export function rimuoviUltimaVoce(matchId: string, tipo: string, idVoce?: string): boolean {
  const coda = leggiCoda(matchId);
  for (let i = coda.length - 1; i >= 0; i--) {
    const v = coda[i];
    if (v.tipo !== tipo) continue;
    if (idVoce && v.id !== idVoce) continue;
    if (voceInInvio.get(matchId) === v.id) return false;
    coda.splice(i, 1);
    scriviCoda(matchId, coda);
    notifica(matchId);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Id degli eventi gia' salvati da questo dispositivo (per il controllo anti-duplicato)
// ---------------------------------------------------------------------------

export function ricordaIdEvento(matchId: string, eventId: string) {
  const l = leggiJson<string[]>(PREFISSO_ID_NOSTRI + matchId, []);
  l.push(eventId);
  scriviGrezzo(PREFISSO_ID_NOSTRI + matchId, JSON.stringify(l.slice(-MAX_ID_NOSTRI)));
}

export function idEventiNostri(matchId: string): Set<string> {
  const l = leggiJson<unknown>(PREFISSO_ID_NOSTRI + matchId, []);
  return new Set(Array.isArray(l) ? (l as string[]) : []);
}

// ---------------------------------------------------------------------------
// Blocco fra schede dello stesso browser (due schede non devono inviare insieme la stessa coda)
// ---------------------------------------------------------------------------

function prendiBlocco(matchId: string): boolean {
  const chiave = PREFISSO_LOCK + matchId;
  const g = leggiJson<{ chi?: string; fino?: number } | null>(chiave, null);
  if (g && g.chi && g.chi !== idIstanza && typeof g.fino === "number" && g.fino > Date.now()) return false;
  scriviGrezzo(chiave, JSON.stringify({ chi: idIstanza, fino: Date.now() + SCADENZA_LOCK_MS }));
  return true;
}

function rinnovaBlocco(matchId: string) {
  scriviGrezzo(PREFISSO_LOCK + matchId, JSON.stringify({ chi: idIstanza, fino: Date.now() + SCADENZA_LOCK_MS }));
}

function rilasciaBlocco(matchId: string) {
  const chiave = PREFISSO_LOCK + matchId;
  const g = leggiJson<{ chi?: string } | null>(chiave, null);
  if (g && g.chi === idIstanza) scriviGrezzo(chiave, null);
}

// ---------------------------------------------------------------------------
// Esecuzione e accodamento
// ---------------------------------------------------------------------------

function nuovoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sostituisciVoce(matchId: string, voce: VoceCoda) {
  const coda = leggiCoda(matchId);
  const i = coda.findIndex((v) => v.id === voce.id);
  if (i >= 0) { coda[i] = voce; scriviCoda(matchId, coda); }
}

function rimuoviVoce(matchId: string, idVoce: string) {
  scriviCoda(matchId, leggiCoda(matchId).filter((v) => v.id !== idVoce));
}

async function eseguiVoce(voce: VoceCoda, salvaSuCoda: boolean): Promise<unknown> {
  const fn = esecutori.get(voce.tipo);
  if (!fn) throw Object.assign(new Error(`Operazione sconosciuta: ${voce.tipo}`), { code: "P0001" });
  const adesso = Date.now();
  if (!voce.primoTentativoIl) voce.primoTentativoIl = adesso;
  voce.ultimoTentativoIl = adesso;
  if (salvaSuCoda) sostituisciVoce(voce.matchId, voce);
  return fn(voce.args, {
    voce,
    salvaParziale: (p) => {
      voce.parziale = { ...(voce.parziale ?? {}), ...p };
      if (salvaSuCoda) sostituisciVoce(voce.matchId, voce);
    },
  });
}

/**
 * Esegue subito la scrittura; se fallisce per mancanza di rete la mette in coda.
 * Se la partita ha gia' voci in coda (o il dispositivo e' offline) va direttamente in coda, per tenere l'ordine.
 * Gli errori che NON sono di rete vengono rilanciati cosi' come sono.
 */
export async function eseguiOAccoda<T = unknown>(
  matchId: string,
  tipo: string,
  args: Record<string, unknown>,
  opz: OpzioniAccodamento,
): Promise<EsitoEsecuzione<T>> {
  const voce: VoceCoda = {
    id: nuovoId(), matchId, tipo, args, descrizione: opz.descrizione, creatoIl: Date.now(),
    primoTentativoIl: 0, ultimoTentativoIl: 0, ambiguo: false, effetto: opz.effetto,
  };

  const inCoda = leggiCoda(matchId);
  if (opz.senzaDoppioni) {
    const chiave = JSON.stringify(args);
    if (inCoda.some((v) => v.tipo === tipo && JSON.stringify(v.args) === chiave)) return { accodato: true };
  }

  if (inCoda.length > 0 || inInvio.has(matchId) || (direttiInCorso.get(matchId)?.size ?? 0) > 0 || senzaRete()) {
    accoda(voce);
    return { accodato: true };
  }

  const invio = eseguiVoce(voce, false);
  let insieme = direttiInCorso.get(matchId);
  if (!insieme) { insieme = new Set(); direttiInCorso.set(matchId, insieme); }
  insieme.add(invio);
  try {
    const risultato = (await invio) as T;
    ultimoErroreRete.set(matchId, false);
    return { accodato: false, risultato };
  } catch (e) {
    if (!erroreRitentabile(e)) throw e;
    voce.ambiguo = voce.primoTentativoIl > 0 && !senzaRete();
    ultimoErroreRete.set(matchId, true);
    accoda(voce);
    return { accodato: true };
  } finally {
    insieme.delete(invio);
  }
}

function accoda(voce: VoceCoda) {
  const coda = leggiCoda(voce.matchId);
  // Nell'ordine in cui sono state fatte (una scrittura diretta fallita rientra davanti a quelle accodate dopo di lei).
  let posto = coda.length;
  while (posto > 0 && coda[posto - 1].creatoIl > voce.creatoIl) posto--;
  coda.splice(posto, 0, voce);
  scriviCoda(voce.matchId, coda);
  notifica(voce.matchId);
  // Se l'invio e' gia' in corso la voce viene presa dal ciclo; altrimenti si prova subito (se c'e' rete) o si programma.
  if (!inInvio.has(voce.matchId)) {
    if (senzaRete()) programmaRitentativo(voce.matchId); else void svuota(voce.matchId);
  }
}

function programmaRitentativo(matchId: string) {
  if (timerRitentativo.has(matchId)) return;
  const n = tentativiFalliti.get(matchId) ?? 0;
  tentativiFalliti.set(matchId, n + 1);
  const attesa = Math.min(ATTESA_MAX_MS, ATTESA_MIN_MS * Math.pow(2, n));
  const t = setTimeout(() => {
    timerRitentativo.delete(matchId);
    void svuota(matchId);
  }, attesa);
  timerRitentativo.set(matchId, t);
}

/** Invia in ordine le voci in coda. Si ferma al primo errore di rete e riprova dopo; scarta (e segnala) le voci rifiutate dal database. */
export function svuota(matchId: string): Promise<void> {
  const inCorso = promesseInvio.get(matchId);
  if (inCorso) return inCorso;
  if (codaVuota(matchId)) return Promise.resolve();
  if (!prendiBlocco(matchId)) { programmaRitentativo(matchId); return Promise.resolve(); }

  const t = timerRitentativo.get(matchId);
  if (t) { clearTimeout(t); timerRitentativo.delete(matchId); }

  const p = (async () => {
    inInvio.add(matchId);
    notifica(matchId);
    let inviatoQualcosa = false;
    try {
      // Se una scrittura diretta e' ancora in corso si aspetta che finisca: se fallisce rientra in coda al suo posto.
      const diretti = direttiInCorso.get(matchId);
      if (diretti && diretti.size > 0) await Promise.allSettled([...diretti]);
      for (;;) {
        const coda = leggiCoda(matchId);
        if (coda.length === 0) break;
        const voce = coda[0];
        voceInInvio.set(matchId, voce.id);
        try {
          await eseguiVoce(voce, true);
          // Prima di toglierla dalla coda si avvisa chi mostra il tabellone, cosi' l'azione non "sparisce" nemmeno per un istante.
          ascoltatoriInviate.get(matchId)?.forEach((cb) => { try { cb(voce); } catch { /* ignorato */ } });
          rimuoviVoce(matchId, voce.id);
          inviatoQualcosa = true;
          tentativiFalliti.set(matchId, 0);
          ultimoErroreRete.set(matchId, false);
        } catch (e) {
          if (erroreRitentabile(e)) {
            // Un invio partito e non concluso puo' essere arrivato lo stesso: al prossimo giro si controlla.
            voce.ambiguo = voce.ambiguo || !senzaRete();
            sostituisciVoce(matchId, voce);
            ultimoErroreRete.set(matchId, true);
            programmaRitentativo(matchId);
            return;
          }
          // Rifiutata dal database (validazione/permessi): non si riprova mai, si segnala e si va avanti.
          rimuoviVoce(matchId, voce.id);
          const msg = (e as Error)?.message || "Operazione non accettata";
          ascoltatoriScartate.get(matchId)?.forEach((cb) => { try { cb(voce.descrizione, msg); } catch { /* ignorato */ } });
        } finally {
          voceInInvio.delete(matchId);
          rinnovaBlocco(matchId);
          notifica(matchId);
        }
      }
      if (inviatoQualcosa) tuttoInviatoIl.set(matchId, Date.now());
      tentativiFalliti.set(matchId, 0);
    } finally {
      inInvio.delete(matchId);
      rilasciaBlocco(matchId);
      promesseInvio.delete(matchId);
      notifica(matchId);
      if (inviatoQualcosa && codaVuota(matchId)) {
        // Fa sparire la scritta "Tutto inviato" dopo qualche secondo.
        setTimeout(() => notifica(matchId), MOSTRA_TUTTO_INVIATO_MS + 100);
      }
    }
  })();
  promesseInvio.set(matchId, p);
  return p;
}

/** Prova a inviare tutto adesso e aspetta. Vero se alla fine la coda e' vuota. */
export async function svuotaOra(matchId: string): Promise<boolean> {
  if (codaVuota(matchId)) return true;
  if (!senzaRete()) await svuota(matchId);
  return codaVuota(matchId);
}

// ---------------------------------------------------------------------------
// Ritorno della connessione e tentativi periodici
// ---------------------------------------------------------------------------

function installaAscoltoFinestra() {
  if (ascoltoFinestraAttivo) return;
  const w = (globalThis as any).window ?? (globalThis as any);
  if (!w || typeof w.addEventListener !== "function") return;
  ascoltoFinestraAttivo = true;
  w.addEventListener("online", () => {
    ascoltatori.forEach((_s, matchId) => {
      if (!codaVuota(matchId)) {
        tentativiFalliti.set(matchId, 0);
        const t = timerRitentativo.get(matchId);
        if (t) { clearTimeout(t); timerRitentativo.delete(matchId); }
        void svuota(matchId);
      }
    });
    notificaTutti();
  });
  w.addEventListener("offline", () => notificaTutti());
}

/**
 * Attiva l'invio automatico per la partita aperta: subito (se in coda c'e' gia' qualcosa da una sessione precedente),
 * al ritorno della rete e con tentativi periodici. Restituisce la funzione per spegnerlo.
 * `quandoSvuotata` viene chiamata quando la coda torna vuota dopo aver inviato; `quandoScartata` per ogni voce rifiutata dal database.
 */
export function avviaInvioAutomatico(
  matchId: string,
  opz: { quandoSvuotata?: () => void; quandoScartata?: (descrizione: string, messaggio: string) => void; quandoInviata?: (voce: VoceCoda) => void } = {},
): () => void {
  installaAscoltoFinestra();
  automatici.set(matchId, (automatici.get(matchId) ?? 0) + 1);

  let eraInCoda = !codaVuota(matchId);
  const disiscrivi = iscriviStato(matchId, () => {
    const vuota = codaVuota(matchId);
    if (eraInCoda && vuota && !inInvio.has(matchId)) { eraInCoda = false; opz.quandoSvuotata?.(); }
    else if (!vuota) eraInCoda = true;
  });

  let scartate: Set<(d: string, m: string) => void> | undefined;
  if (opz.quandoScartata) {
    scartate = ascoltatoriScartate.get(matchId);
    if (!scartate) { scartate = new Set(); ascoltatoriScartate.set(matchId, scartate); }
    scartate.add(opz.quandoScartata);
  }

  let inviate: Set<(v: VoceCoda) => void> | undefined;
  if (opz.quandoInviata) {
    inviate = ascoltatoriInviate.get(matchId);
    if (!inviate) { inviate = new Set(); ascoltatoriInviate.set(matchId, inviate); }
    inviate.add(opz.quandoInviata);
  }

  const periodico = setInterval(() => { if (!codaVuota(matchId) && !senzaRete()) void svuota(matchId); }, ATTESA_MAX_MS);
  const w = (globalThis as any).document;
  const alRitorno = () => { if (w && w.visibilityState === "visible" && !codaVuota(matchId) && !senzaRete()) void svuota(matchId); };
  try { w?.addEventListener?.("visibilitychange", alRitorno); } catch { /* non c'e' document */ }

  if (!codaVuota(matchId) && !senzaRete()) void svuota(matchId);

  return () => {
    disiscrivi();
    if (opz.quandoScartata) scartate?.delete(opz.quandoScartata);
    if (opz.quandoInviata) inviate?.delete(opz.quandoInviata);
    clearInterval(periodico);
    try { w?.removeEventListener?.("visibilitychange", alRitorno); } catch { /* ignorato */ }
    // Il ritentativo programmato resta attivo anche dopo aver lasciato la schermata: le azioni in coda devono comunque partire.
    const n = (automatici.get(matchId) ?? 1) - 1;
    if (n <= 0) automatici.delete(matchId); else automatici.set(matchId, n);
  };
}
