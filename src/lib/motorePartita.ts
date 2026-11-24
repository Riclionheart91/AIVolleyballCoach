/**
 * Motore locale della partita: replica sul telefono le regole che il database applica quando si registra
 * una partita (punteggio, rotazione, servizio, cambi, Libero, time-out, set, chiusura), così si può
 * giocare un'intera partita senza rete. Al ritorno della connessione le stesse operazioni vengono
 * rimandate al server nello stesso ordine (vedi codaOffline.ts), che le rifà con le sue regole.
 *
 * Questo file NON importa nulla dall'app (solo tipi): le funzioni lavorano su un oggetto StatoPartita
 * e lo modificano in place. Chi le usa (partitaLocale.ts) lavora su una copia e la tiene solo se l'operazione riesce.
 * I messaggi di errore sono gli stessi del database.
 *
 * Fonti: funzioni SQL registra_evento, annulla_ultimo_evento, cambia_giocatore, rimpiazza_con_libero,
 * fai_uscire_libero, registra_timeout, ruota_formazione(_indietro), correggi_formazione, nuovo_set,
 * torna_al_set_precedente, chiudi_match, imposta_formazione_iniziale e i trigger sugli eventi
 * (cattura_stato_servizio, aggiorna_punteggio_da_evento, applica_rotazione_dopo_evento, annulla_rotazione_dopo_delete).
 */
import type { Athlete, Match, MatchConvocato, MatchEvent, MatchSetLineup, MatchSet } from "../types/database";

export type Squadra = "noi" | "avversario";

export interface SetLoc extends MatchSet { turno_servizio_corrente: number }
export interface EventoLoc extends MatchEvent {
  rotazione_applicata: boolean;
  servizio_precedente: Squadra | null;
  rotazione_al_servizio: string | null;
  turno_servizio: number | null;
}
export interface RimpiazzoLibero {
  id: string; set_id: string; libero_id: string; titolare_id: string; posizione: number;
  entrato_il: string; uscito_il: string | null;
}
export interface TimeoutLoc {
  id: string; match_id: string; set_id: string; squadra: Squadra;
  punti_noi: number; punti_avversario: number; creato_il: string;
}
export interface RegolaLiberoLoc { libero_id: string | null; titolare_1: string | null; titolare_2: string | null }
export interface RegoleLoc {
  puntiPerSet: number; puntiSetDecisivo: number;
  /** Dal campionato: massimo di Liberi e di giocatrici in distinta (null = nessun limite). */
  numeroLiberiMax: number; distintaMax: number | null;
}

export interface StatoPartita {
  v: 1;
  match: Match;
  sets: SetLoc[];
  eventi: EventoLoc[];            // dal più vecchio al più recente
  formazioni: MatchSetLineup[];   // righe di tutti i set
  timeouts: TimeoutLoc[];
  rimpiazzi: RimpiazzoLibero[];
  convocati: MatchConvocato[];
  atlete: Athlete[];
  regole: RegoleLoc;
  regolaLibero: RegolaLiberoLoc | null;
  /** Contatore per gli id locali di righe nuove. */
  seq: number;
}

function nuovoIdLocale(s: StatoPartita, prefisso: string): string { s.seq += 1; return `loc-${prefisso}-${s.seq}`; }
export function eIdLocale(id: string | null | undefined): boolean { return !!id && id.startsWith("loc-"); }

function ora(s: StatoPartita): string {
  // Strettamente crescente, anche per azioni nello stesso millisecondo: l'ordine delle azioni è quello dell'array.
  const ultimo = s.eventi.length > 0 ? Date.parse(s.eventi[s.eventi.length - 1].creato_il) : 0;
  const t = Math.max(Date.now(), (Number.isFinite(ultimo) ? ultimo : 0) + 1);
  return new Date(t).toISOString();
}

function setPerId(s: StatoPartita, setId: string): SetLoc {
  const x = s.sets.find((q) => q.id === setId);
  if (!x) throw new Error("Set non trovato");
  return x;
}
function setAperto(s: StatoPartita): SetLoc | undefined {
  return s.sets.filter((q) => !q.concluso).sort((a, b) => b.numero_set - a.numero_set)[0];
}
function righeSet(s: StatoPartita, setId: string): MatchSetLineup[] { return s.formazioni.filter((r) => r.set_id === setId); }
function inCampo(s: StatoPartita, setId: string): MatchSetLineup[] { return righeSet(s, setId).filter((r) => r.in_campo); }
function eLibero(s: StatoPartita, athleteId: string): boolean { return s.convocati.some((c) => c.athlete_id === athleteId && c.is_libero); }

function nuovaRiga(s: StatoPartita, setId: string, athleteId: string, resto: Partial<MatchSetLineup>): MatchSetLineup {
  const riga: MatchSetLineup = {
    id: nuovoIdLocale(s, "lin"), set_id: setId, athlete_id: athleteId, in_campo: true, posizione: null,
    posizione_iniziale: null, sostituisce_id: null, rientrato: false, aggiornato_il: new Date().toISOString(), ...resto,
  };
  s.formazioni.push(riga);
  return riga;
}

// ───────────────────────── rotazione ─────────────────────────

/** ruota_formazione: chi è in 2 va in 1, 1→6, 6→5, 5→4, 4→3, 3→2. */
export function ruota(s: StatoPartita, setId: string, indietro = false): void {
  const righe = inCampo(s, setId).filter((r) => r.posizione !== null);
  if (righe.length === 0) return;
  const mappa = new Map<number, string>();
  for (const r of righe) mappa.set(r.posizione as number, r.athlete_id);
  for (const r of righe) r.posizione = null;
  const dest: Record<number, number> = indietro
    ? { 1: 2, 6: 1, 5: 6, 4: 5, 3: 4, 2: 3 }   // posizione di partenza -> nuova (ruota_formazione_indietro)
    : { 2: 1, 1: 6, 6: 5, 5: 4, 4: 3, 3: 2 };  // (ruota_formazione)
  for (const [da, a] of Object.entries(dest)) {
    const atleta = mappa.get(Number(da));
    if (!atleta) continue;
    const riga = righe.find((r) => r.athlete_id === atleta);
    if (riga) riga.posizione = a;
  }
}

/** ruota_formazione_manuale */
export function ruotaManuale(s: StatoPartita, setId: string, indietro: boolean): void {
  setPerId(s, setId);
  ruota(s, setId, indietro);
}

// ───────────────────────── Libero ─────────────────────────

/** fai_uscire_libero: la titolare rientra dove si trova il Libero adesso. */
export function liberoEsce(s: StatoPartita, setId: string): void {
  setPerId(s, setId);
  const aperti = s.rimpiazzi.filter((r) => r.set_id === setId && r.uscito_il === null);
  const rimpiazzo = aperti.sort((a, b) => b.entrato_il.localeCompare(a.entrato_il))[0];
  if (!rimpiazzo) return;
  const rigaLibero = inCampo(s, setId).find((r) => r.athlete_id === rimpiazzo.libero_id);
  const posAttuale = rigaLibero?.posizione ?? null;
  for (const r of righeSet(s, setId)) {
    if (r.athlete_id === rimpiazzo.libero_id) { r.in_campo = false; r.posizione = null; }
  }
  for (const r of righeSet(s, setId)) {
    if (r.athlete_id === rimpiazzo.titolare_id) { r.in_campo = true; r.posizione = posAttuale; }
  }
  rimpiazzo.uscito_il = new Date().toISOString();
}

/** gestisci_libero_dopo_rotazione: appena la rotazione dà il servizio, il Libero in prima linea o in battuta esce. */
function gestisciLiberoDopoRotazione(s: StatoPartita, setId: string): void {
  const aperto = s.rimpiazzi.find((r) => r.set_id === setId && r.uscito_il === null);
  if (!aperto) return;
  const riga = inCampo(s, setId).find((r) => r.athlete_id === aperto.libero_id);
  const pos = riga?.posizione ?? null;
  if (pos !== null && [1, 2, 3, 4].includes(pos)) liberoEsce(s, setId);
}

/** rimpiazza_con_libero */
export function liberoEntra(s: StatoPartita, setId: string, liberoId: string, titolareId: string): void {
  const set = setPerId(s, setId);
  if (!s.convocati.some((c) => c.athlete_id === liberoId && c.is_libero)) throw new Error("Questa persona non è indicata come Libero nella distinta");
  const rigaTit = inCampo(s, setId).find((r) => r.athlete_id === titolareId);
  const posizione = rigaTit?.posizione ?? null;
  if (posizione === null) throw new Error("Chi deve essere rimpiazzato non è in campo");
  if (![1, 5, 6].includes(posizione)) throw new Error(`Il Libero può entrare solo in seconda linea (posizioni 5, 6, 1): la posizione indicata è ${posizione}`);
  if (posizione === 1 && set.squadra_al_servizio === "noi") throw new Error("In questo momento la posizione 1 è alla battuta (siamo al servizio): il Libero non può servire");
  if (s.rimpiazzi.some((r) => r.set_id === setId && r.uscito_il === null)) throw new Error("C'è già un Libero in campo: fallo uscire prima");

  for (const r of righeSet(s, setId)) if (r.athlete_id === titolareId) { r.in_campo = false; r.posizione = null; }
  const esistente = righeSet(s, setId).find((r) => r.athlete_id === liberoId);
  if (esistente) { esistente.in_campo = true; esistente.posizione = posizione; }
  else nuovaRiga(s, setId, liberoId, { in_campo: true, posizione });
  s.rimpiazzi.push({
    id: nuovoIdLocale(s, "rimp"), set_id: setId, libero_id: liberoId, titolare_id: titolareId, posizione,
    entrato_il: ora(s), uscito_il: null,
  });
}

// ───────────────────────── eventi ─────────────────────────

const SKILL_SENZA_ATLETA = ["Punto_avversario", "Punto_nostro", "Fallo_rotazione"];

export interface ParametriEvento {
  setId: string; skill: string; esito: string | null; athleteId: string | null; qualita: string | null;
  causa?: string | null; zonaArrivo?: number | null; zonaPartenza?: number | null;
}

/** registra_evento + trigger (cattura_stato_servizio, aggiorna_punteggio, applica_rotazione). */
export function registraEvento(s: StatoPartita, p: ParametriEvento): EventoLoc {
  if (s.match.stato === "conclusa") throw new Error("Partita già conclusa");
  if (s.match.stato !== "in_corso") throw new Error("La partita non è ancora iniziata");
  const set = s.sets.find((q) => q.id === p.setId);
  if (!set) throw new Error("Il set indicato non appartiene a questa partita");
  if (righeSet(s, p.setId).length === 0) throw new Error("Formazione non impostata per questo set");

  let esito: string | null;
  let athlete: string | null;
  if (SKILL_SENZA_ATLETA.includes(p.skill)) { esito = null; athlete = null; }
  else {
    esito = p.esito; athlete = p.athleteId;
    if (esito === null) throw new Error("Indica l'esito dell'azione");
    if (athlete !== null) {
      if (!s.atlete.some((a) => a.id === athlete)) throw new Error("Questa persona non fa parte della squadra");
      if (p.skill === "Servizio") {
        const r = inCampo(s, p.setId).find((x) => x.athlete_id === athlete);
        if ((r?.posizione ?? null) !== 1) throw new Error("Il servizio può essere attribuito solo a chi si trova in posizione 1 (zona di battuta)");
      }
    }
  }
  const qualita = (p.skill === "Ricezione" || p.skill === "Difesa") && esito === "neutro" ? p.qualita : null;

  // cattura_stato_servizio (BEFORE INSERT)
  const servizioAttuale = set.squadra_al_servizio;
  const rigaBattuta = inCampo(s, p.setId).find((r) => r.posizione === 1);
  const puntoNostro = esito === "punto" || p.skill === "Punto_nostro";
  const rotazioneApplicata = puntoNostro && servizioAttuale !== "noi";

  const ev: EventoLoc = {
    id: nuovoIdLocale(s, "ev"), match_id: s.match.id, set_id: p.setId, skill: p.skill as EventoLoc["skill"],
    esito: esito as EventoLoc["esito"], athlete_id: athlete, creato_il: ora(s), creato_da: null,
    qualita: qualita as EventoLoc["qualita"],
    zona_arrivo: p.zonaArrivo ?? null, zona_partenza: p.zonaPartenza ?? null, causa: (p.causa ?? null) as EventoLoc["causa"],
    rotazione_applicata: rotazioneApplicata, servizio_precedente: servizioAttuale, rotazione_al_servizio: rigaBattuta?.athlete_id ?? null,
    turno_servizio: set.turno_servizio_corrente,
  };
  s.eventi.push(ev);

  // aggiorna_punteggio_da_evento
  const puntoAvversario = ev.skill === ("Punto_avversario" as string) || ev.skill === ("Fallo_rotazione" as string) || ev.esito === "errore";
  if (puntoAvversario) set.punti_avversario += 1;
  else if (ev.skill === ("Punto_nostro" as string) || ev.esito === "punto") set.punti_noi += 1;

  // applica_rotazione_dopo_evento
  if (ev.rotazione_applicata) {
    ruota(s, p.setId, false);
    gestisciLiberoDopoRotazione(s, p.setId);
    set.squadra_al_servizio = "noi";
    set.turno_servizio_corrente += 1;
  } else if (puntoAvversario && ev.servizio_precedente !== "avversario") {
    set.squadra_al_servizio = "avversario";
    set.turno_servizio_corrente += 1;
  }
  return ev;
}

/** annulla_ultimo_evento + trigger (punteggio e rotazione si correggono). */
export function annullaUltimoEvento(s: StatoPartita): void {
  const ev = s.eventi[s.eventi.length - 1];
  if (!ev) return;
  s.eventi.pop();
  const set = s.sets.find((q) => q.id === ev.set_id);
  if (!set) return;
  const avv = ev.skill === ("Punto_avversario" as string) || ev.skill === ("Fallo_rotazione" as string) || ev.esito === "errore";
  if (avv) set.punti_avversario = Math.max(0, set.punti_avversario - 1);
  else if (ev.skill === ("Punto_nostro" as string) || ev.esito === "punto") set.punti_noi = Math.max(0, set.punti_noi - 1);
  if (ev.rotazione_applicata) ruota(s, ev.set_id, true);
  set.squadra_al_servizio = ev.servizio_precedente;
}

/** imposta_causa_evento / imposta_zone_evento sull'ultimo evento (già fatte dentro registraEvento). */

// ───────────────────────── cambi ─────────────────────────

/** cambia_giocatore */
export function cambio(s: StatoPartita, setId: string, uscenteId: string, entranteId: string): void {
  setPerId(s, setId);
  const rigaUsc = inCampo(s, setId).find((r) => r.athlete_id === uscenteId);
  const posizione = rigaUsc?.posizione ?? null;
  if (posizione === null) throw new Error("Chi deve uscire non risulta in campo in questo set");
  const sostituisce = rigaUsc?.sostituisce_id ?? null;
  const uscenteTitolare = rigaUsc?.posizione_iniziale != null;
  const uscenteRientrato = !!rigaUsc?.rientrato;
  if (uscenteRientrato) throw new Error("Chi è rientrata dopo un cambio non può più uscire in questo set (regolamento). Per correggere un errore usa Formazione");
  if (!s.convocati.some((c) => c.athlete_id === entranteId)) throw new Error("Chi deve entrare non è tra i convocati di questa partita");
  if (inCampo(s, setId).some((r) => r.athlete_id === entranteId)) throw new Error("Chi deve entrare è già in campo");
  const rigaEnt = righeSet(s, setId).find((r) => r.athlete_id === entranteId);
  if (sostituisce !== null && sostituisce !== entranteId) {
    throw new Error("Chi è entrato al posto di una titolare può uscire solo per lei (regolamento): al suo posto può rientrare solo chi aveva sostituito");
  }
  let rientro = false;
  if (rigaEnt) {
    if (rigaEnt.posizione_iniziale == null) throw new Error("Chi deve entrare è già uscito in questo set e non può rientrare");
    if (rigaEnt.rientrato) throw new Error("Chi deve entrare è già rientrato una volta in questo set e non può rientrare ancora");
    if (sostituisce === null) {
      if (uscenteTitolare || inCampo(s, setId).some((r) => r.sostituisce_id === entranteId)) {
        throw new Error("Chi deve entrare è già uscito in questo set e può rientrare solo al posto di chi l'ha sostituita");
      }
    }
    rientro = true;
  }
  for (const r of righeSet(s, setId)) if (r.athlete_id === uscenteId) { r.in_campo = false; r.posizione = null; }
  if (rientro && rigaEnt) {
    rigaEnt.in_campo = true; rigaEnt.posizione = posizione; rigaEnt.sostituisce_id = null; rigaEnt.rientrato = true;
    rigaEnt.aggiornato_il = new Date().toISOString();
  } else if (rigaEnt) {
    rigaEnt.in_campo = true; rigaEnt.posizione = posizione; rigaEnt.sostituisce_id = uscenteId;
  } else {
    nuovaRiga(s, setId, entranteId, { in_campo: true, posizione, sostituisce_id: uscenteId });
  }
  const rg = s.regolaLibero;
  if (rg && (rg.titolare_1 === uscenteId || rg.titolare_2 === uscenteId)) {
    s.regolaLibero = {
      ...rg,
      titolare_1: rg.titolare_1 === uscenteId ? entranteId : rg.titolare_1,
      titolare_2: rg.titolare_2 === uscenteId ? entranteId : rg.titolare_2,
    };
  }
}

/** correggi_formazione */
export function correggiFormazione(s: StatoPartita, setId: string, posizioni: Record<string, string>, chiServe: Squadra | null): void {
  const set = setPerId(s, setId);
  if (s.match.stato !== "in_corso" || set.concluso) throw new Error("La formazione si corregge solo nel set in corso di una partita in corso");
  if (chiServe !== null && chiServe !== "noi" && chiServe !== "avversario") throw new Error("Valore non valido per chi serve");
  const chiavi = Object.keys(posizioni).sort((a, b) => a.length - b.length || a.localeCompare(b));
  const ids: string[] = [];
  for (const k of chiavi) {
    if (!/^[1-6]$/.test(k)) throw new Error(`Posizione non valida: ${k}`);
    const atleta = posizioni[k];
    if (ids.includes(atleta)) throw new Error("La stessa persona è indicata in due posizioni");
    if (!s.convocati.some((c) => c.athlete_id === atleta && !c.is_libero)) throw new Error("Una delle persone indicate non è tra i convocati (o è un Libero)");
    ids.push(atleta);
  }
  if (ids.length !== 6) throw new Error(`Servono esattamente 6 posizioni, ne sono arrivate ${ids.length}`);
  if (inCampo(s, setId).some((r) => eLibero(s, r.athlete_id))) throw new Error("Il Libero è in campo: fallo prima uscire, poi correggi la formazione");
  const haEventi = s.eventi.some((e) => e.set_id === setId);

  s.formazioni = s.formazioni.filter((r) => !(r.set_id === setId && r.in_campo && !ids.includes(r.athlete_id)));
  for (const r of inCampo(s, setId)) if (r.posizione !== null) r.posizione = null;
  for (const k of chiavi) {
    const atleta = posizioni[k];
    const pos = Number(k);
    const esistente = righeSet(s, setId).find((r) => r.athlete_id === atleta);
    if (esistente) {
      esistente.in_campo = true; esistente.posizione = pos;
      if (!haEventi) esistente.posizione_iniziale = pos;
      esistente.aggiornato_il = new Date().toISOString();
    } else {
      nuovaRiga(s, setId, atleta, { in_campo: true, posizione: pos, posizione_iniziale: haEventi ? null : pos });
    }
  }
  if (!haEventi) s.rimpiazzi = s.rimpiazzi.filter((r) => r.set_id !== setId);
  if (chiServe !== null) {
    set.squadra_al_servizio = chiServe;
    if (!haEventi) set.chi_ha_servito_per_primo = chiServe;
  }
}

/** imposta_formazione_iniziale */
export function formazioneIniziale(s: StatoPartita, setId: string, posizioni: Record<string, string>, chiServe: Squadra): void {
  const set = setPerId(s, setId);
  if (s.eventi.some((e) => e.set_id === setId)) throw new Error("Il set è già iniziato: la formazione non può più essere cambiata, usa i cambi");
  const chiavi = Object.keys(posizioni);
  for (const k of chiavi) {
    if (!s.convocati.some((c) => c.athlete_id === posizioni[k])) throw new Error("Una delle persone indicate non è tra i convocati");
  }
  if (chiavi.length !== 6) throw new Error(`Servono esattamente 6 posizioni, ne sono arrivate ${chiavi.length}`);
  s.formazioni = s.formazioni.filter((r) => r.set_id !== setId);
  s.rimpiazzi = s.rimpiazzi.filter((r) => r.set_id !== setId);
  for (const k of chiavi) nuovaRiga(s, setId, posizioni[k], { in_campo: true, posizione: Number(k), posizione_iniziale: Number(k) });
  set.squadra_al_servizio = chiServe;
  set.chi_ha_servito_per_primo = chiServe;
}

// ───────────────────────── time-out ─────────────────────────

export function timeoutRegistra(s: StatoPartita, setId: string, squadra: Squadra): void {
  if (squadra !== "noi" && squadra !== "avversario") throw new Error("Squadra non valida");
  const set = setPerId(s, setId);
  if (s.match.stato !== "in_corso") throw new Error("La partita non e' in corso");
  s.timeouts.push({
    id: nuovoIdLocale(s, "to"), match_id: s.match.id, set_id: setId, squadra,
    punti_noi: set.punti_noi, punti_avversario: set.punti_avversario, creato_il: ora(s),
  });
}

export function timeoutAnnulla(s: StatoPartita, setId: string): void {
  setPerId(s, setId);
  if (s.match.stato !== "in_corso") throw new Error("La partita non e' in corso");
  for (let i = s.timeouts.length - 1; i >= 0; i--) {
    if (s.timeouts[i].set_id === setId) { s.timeouts.splice(i, 1); return; }
  }
}

// ───────────────────────── set e partita ─────────────────────────

/** nuovo_set (ramo allenatore). Restituisce l'id del set aperto (nuovo, o quello già aperto se è ancora vuoto). */
export function nuovoSet(s: StatoPartita): string {
  const aperto = setAperto(s);
  if (aperto && aperto.punti_noi === 0 && aperto.punti_avversario === 0 && !s.eventi.some((e) => e.set_id === aperto.id)) return aperto.id;
  for (const q of s.sets) if (!q.concluso) q.concluso = true;
  const prossimo = s.sets.reduce((m, q) => Math.max(m, q.numero_set), 0) + 1;
  const nuovo: SetLoc = {
    id: nuovoIdLocale(s, "set"), match_id: s.match.id, numero_set: prossimo, punti_noi: 0, punti_avversario: 0,
    concluso: false, squadra_al_servizio: null, chi_ha_servito_per_primo: null, turno_servizio_corrente: 1,
  };
  s.sets.push(nuovo);
  return nuovo.id;
}

function setConsolidato(s: StatoPartita, q: SetLoc): boolean {
  const soglia = q.numero_set === 5 ? s.regole.puntiSetDecisivo : s.regole.puntiPerSet;
  return Math.max(q.punti_noi, q.punti_avversario) >= soglia && Math.abs(q.punti_noi - q.punti_avversario) >= 2;
}

/** torna_al_set_precedente. Restituisce l'id del set riaperto. */
export function tornaAlSetPrecedente(s: StatoPartita): string {
  if (s.match.stato === "conclusa") throw new Error("La partita è conclusa");
  const corrente = setAperto(s);
  if (!corrente) throw new Error("Non c'è un set aperto");
  if (corrente.punti_noi !== 0 || corrente.punti_avversario !== 0 || s.eventi.some((e) => e.set_id === corrente.id)) {
    throw new Error(`Il set ${corrente.numero_set} è già iniziato: non si può tornare indietro`);
  }
  const prec = s.sets.filter((q) => q.numero_set < corrente.numero_set).sort((a, b) => b.numero_set - a.numero_set)[0];
  if (!prec) throw new Error("Non c'è un set precedente");
  if (setConsolidato(s, prec)) {
    throw new Error(`Il set ${prec.numero_set} è finito ${prec.punti_noi}-${prec.punti_avversario} ed è consolidato: non si può riaprire`);
  }
  s.sets = s.sets.filter((q) => q.id !== corrente.id);
  s.formazioni = s.formazioni.filter((r) => r.set_id !== corrente.id);
  s.timeouts = s.timeouts.filter((t) => t.set_id !== corrente.id);
  s.rimpiazzi = s.rimpiazzi.filter((r) => r.set_id !== corrente.id);
  prec.concluso = false;
  return prec.id;
}

/** avvia_match_confermato */
export function avviaMatch(s: StatoPartita): void {
  const aperto = setAperto(s);
  if (!aperto || righeSet(s, aperto.id).length === 0) throw new Error("Imposta prima convocati e formazione iniziale");
  s.match.stato = "in_corso";
}

/** chiudi_match */
export function chiudiMatch(s: StatoPartita): void {
  for (const q of s.sets) if (!q.concluso) q.concluso = true;
  s.match.stato = "conclusa";
  s.match.set_vinti_noi = s.sets.filter((q) => q.punti_noi > q.punti_avversario).length;
  s.match.set_vinti_avversario = s.sets.filter((q) => q.punti_avversario > q.punti_noi).length;
}

// ───────────────────────── distinta e regola del Libero ─────────────────────────

/** aggiungi_convocato */
export function aggiungiConvocato(s: StatoPartita, athleteId: string, isLibero: boolean): void {
  if (s.match.stato === "conclusa") throw new Error("La partita è conclusa");
  if (!isLibero && s.sets.some((q) => q.numero_set > 1 || q.concluso)) throw new Error("I convocati si possono cambiare solo durante il primo set (il Libero si può aggiungere sempre)");
  if (!s.atlete.some((a) => a.id === athleteId)) throw new Error("La persona non appartiene a questa squadra");
  const esistente = s.convocati.find((c) => c.athlete_id === athleteId);
  if (!esistente && s.regole.distintaMax !== null && s.convocati.length >= s.regole.distintaMax) {
    throw new Error(`La distinta ha già il massimo di ${s.regole.distintaMax} giocatrici per questo campionato`);
  }
  if (isLibero && !(esistente?.is_libero ?? false)) {
    const setIds = new Set(s.sets.map((q) => q.id));
    if (s.formazioni.some((r) => setIds.has(r.set_id) && r.athlete_id === athleteId && r.in_campo)) throw new Error("Questa persona è in campo: falla prima uscire per farla diventare Libero");
    if (s.convocati.filter((c) => c.is_libero).length >= s.regole.numeroLiberiMax) throw new Error(`Massimo ${s.regole.numeroLiberiMax} Libero per questa partita`);
  }
  if (esistente) esistente.is_libero = esistente.is_libero || isLibero;
  else s.convocati.push({ id: nuovoIdLocale(s, "conv"), match_id: s.match.id, athlete_id: athleteId, is_libero: isLibero });
}

/** imposta_regola_libero */
export function impostaRegolaLibero(s: StatoPartita, liberoId: string | null, t1: string | null, t2: string | null): void {
  if (liberoId !== null && !s.convocati.some((c) => c.athlete_id === liberoId && c.is_libero)) throw new Error("Questa persona non è indicata come Libero nella distinta");
  if (t1 !== null && t1 === t2) throw new Error("I due centrali devono essere diversi");
  if (t1 !== null && !s.convocati.some((c) => c.athlete_id === t1 && !c.is_libero)) throw new Error("Il primo centrale non è tra i convocati");
  if (t2 !== null && !s.convocati.some((c) => c.athlete_id === t2 && !c.is_libero)) throw new Error("Il secondo centrale non è tra i convocati");
  s.regolaLibero = { libero_id: liberoId, titolare_1: t1, titolare_2: t2 };
}

// ───────────────────────── letture (come le funzioni SQL) ─────────────────────────

/** libero_in_campo */
export function liberoInCampoDi(s: StatoPartita, setId: string): { libero_id: string; titolare_id: string; posizione: number | null } | null {
  const r = s.rimpiazzi.find((x) => x.set_id === setId && x.uscito_il === null);
  if (!r) return null;
  const riga = inCampo(s, setId).find((x) => x.athlete_id === r.libero_id);
  return { libero_id: r.libero_id, titolare_id: r.titolare_id, posizione: riga?.posizione ?? null };
}

/** chi_serve_default_nuovo_set */
export function chiServeDefault(s: StatoPartita, numeroNuovoSet: number): Squadra | null {
  if (numeroNuovoSet === 1 || numeroNuovoSet === 5) return null;
  const prec = s.sets.find((q) => q.numero_set === numeroNuovoSet - 1)?.chi_ha_servito_per_primo ?? null;
  if (prec === null) return null;
  return prec === "noi" ? "avversario" : "noi";
}

/** verifica_formazione: Libero in prima linea o in battuta. */
export function verificaFormazioneDi(s: StatoPartita, setId: string): { avviso: string; gravita: string }[] {
  const out: { avviso: string; gravita: string }[] = [];
  for (const r of inCampo(s, setId)) {
    if (eLibero(s, r.athlete_id) && r.posizione !== null && [1, 2, 3, 4].includes(r.posizione)) {
      const a = s.atlete.find((x) => x.id === r.athlete_id);
      out.push({ avviso: `${a?.cognome ?? "?"} è indicato come Libero ma si trova in posizione ${r.posizione}: il Libero gioca solo in seconda linea (5, 6, 1) e non può servire.`, gravita: "attenzione" });
    }
  }
  return out;
}
