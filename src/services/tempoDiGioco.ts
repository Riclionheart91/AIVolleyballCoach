import { supabaseClient } from "@/src/lib/supabase";
import { elencaAtlete } from "@/src/services/athletes";
import { elencaPartite } from "@/src/services/matches";
import { chiHaSegnato } from "@/src/lib/andamentoPunti";
import type { Athlete, Match } from "@/src/types/database";

/*
 * TEMPO DI GIOCO
 *
 * La pallavolo non ha un cronometro: il "tempo" di un'atleta si misura in
 * PUNTI GIOCATI IN CAMPO e SET GIOCATI, ricostruiti dalle formazioni, dai
 * cambi e dalla sequenza dei punti gia' registrati nello scouting. Nessuna
 * nuova tabella e nessuna funzione SQL: si leggono con semplici select
 * match_sets, match_set_lineups, match_events (solo gli eventi che fanno
 * punto) e match_convocati, e tutto il resto e' calcolo lato client.
 *
 * Cosa e' certo e cosa e' stimato:
 *  - set giocati: certo (esiste la riga di formazione per quel set);
 *  - punti di un set giocato per intero (titolare mai cambiata): certi;
 *  - punti di chi esce o entra a set in corso: STIMATI. Il database non
 *    conserva l'istante del cambio, ma l'ora di registrazione della riga di
 *    formazione e l'ora di ogni punto si, quindi si conta quanti punti sono
 *    stati registrati prima e dopo il cambio. Puo' sbagliare di qualche
 *    punto se il cambio e' stato registrato in ritardo;
 *  - Libero: entra ed esce a ogni rotazione, non e' ricostruibile punto per
 *    punto. Si conta presente dal suo primo ingresso in poi (stima);
 *  - minuti: NON esiste un cronometro. Si stimano solo quando i punti del set
 *    sono stati registrati "in diretta" (orari plausibili); altrimenti non si
 *    mostra nulla. Sono sempre indicati come stima e sommano il tempo
 *    trascorso, scambi e pause comprese, tra l'ingresso e l'uscita;
 *  - dove i dati non bastano (set vecchi senza formazione di partenza, cambi
 *    senza traccia) i punti restano "non disponibili" e NON vengono inventati:
 *    quel set conta come giocato ma resta fuori dalla percentuale.
 */

/** Quanti sottoinsiemi di ID per volta in una query `in (...)`, per non fare URL troppo lunghi. */
const BLOCCO_ID = 40;
const DIMENSIONE_PAGINA = 1000;
/** Per quanti secondi i dati letti restano validi (le due viste condividono la lettura). */
const DURATA_CACHE_MS = 30_000;
/** Sotto questa frazione della media di squadra un'atleta e' segnalata. */
export const FRAZIONE_SOGLIA = 0.5;
/** Servono almeno queste partite disponibili prima di segnalare un'atleta (evita falsi allarmi a inizio stagione). */
export const MIN_PARTITE_PER_SEGNALAZIONE = 2;

export type FiltroTipoGara = "tutte" | "campionato" | "amichevole";

/* -------------------------------------------------------------------------- */
/* Tipi di lettura                                                             */
/* -------------------------------------------------------------------------- */

interface SetLetto {
  id: string;
  match_id: string;
  numero_set: number;
  punti_noi: number;
  punti_avversario: number;
}

interface RigaFormazione {
  set_id: string;
  athlete_id: string;
  in_campo: boolean;
  posizione_iniziale: number | null;
  sostituisce_id: string | null;
  rientrato: boolean;
  aggiornato_il: string;
}

interface PuntoLetto {
  set_id: string;
  skill: string;
  esito: string | null;
  athlete_id: string | null;
  creato_il: string;
}

interface ConvocatoLetto {
  match_id: string;
  athlete_id: string;
  is_libero: boolean;
}

/** Tutto cio' che serve al calcolo, gia' letto dal database. */
export interface DatiTempoDiGioco {
  teamId: string;
  partite: Match[];
  atlete: Athlete[];
  set: SetLetto[];
  formazioni: RigaFormazione[];
  punti: PuntoLetto[];
  convocati: ConvocatoLetto[];
  /** Falso se la colonna delle posizioni iniziali non c'e' (database non aggiornato): i cambi non sono ricostruibili. */
  haInfoFormazioneIniziale: boolean;
}

/* -------------------------------------------------------------------------- */
/* Tipi di risultato                                                           */
/* -------------------------------------------------------------------------- */

export interface DettaglioPartitaAtleta {
  matchId: string;
  avversario: string;
  data: string;
  tipoGara: "campionato" | "amichevole";
  setGiocati: number;
  setTotali: number;
  /** Punti giocati nei set di cui si conosce il dato; null se in nessun set e' ricostruibile. */
  puntiInCampo: number | null;
  /** Punti totali dei soli set contati in `puntiInCampo`. */
  puntiTotali: number;
  convocataSenzaGiocare: boolean;
}

export interface TempoAtleta {
  athleteId: string;
  nome: string;
  cognome: string;
  numeroMaglia: number | null;
  ruolo: Athlete["ruolo_campo"];
  libero: boolean;
  partiteDisponibili: number;
  partiteGiocate: number;
  setDisponibili: number;
  setGiocati: number;
  /** Set giocati per i quali non si possono ricostruire i punti (restano fuori dalla percentuale). */
  setSenzaPunti: number;
  puntiInCampo: number;
  /** Punti della squadra nei set contati (denominatore della percentuale). */
  puntiSquadra: number;
  /** Frazione 0-1 dei punti della squadra giocati in campo; null se non calcolabile. */
  percentuale: number | null;
  /** True se almeno una parte dei punti e' una stima (cambi a set in corso o Libero). */
  conStime: boolean;
  /** Minuti stimati; null se nessun set ha orari attendibili. */
  minutiStimati: number | null;
  /** Set giocati per cui si e' potuto stimare il tempo. */
  setConMinuti: number;
  sottoSoglia: boolean;
  partite: DettaglioPartitaAtleta[];
}

export interface TempoDiGiocoSquadra {
  atlete: TempoAtleta[];
  partiteConsiderate: number;
  setConsiderati: number;
  /** Set con punti ma senza formazione registrata, esclusi dal calcolo. */
  setSenzaFormazione: number;
  /** Media della percentuale delle atlete di movimento (Libero esclusa); null se non calcolabile. */
  mediaPercentuale: number | null;
  /** Percentuale sotto la quale scatta la segnalazione (meta' della media); null se non calcolabile. */
  soglia: number | null;
  /** False se il database non ha le informazioni sui cambi: tutte le stime sui cambi sono assenti. */
  infoCambiDisponibili: boolean;
}

/* -------------------------------------------------------------------------- */
/* Lettura dati                                                                */
/* -------------------------------------------------------------------------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RispostaQuery = { data: any; error: { message: string } | null };

function inBlocchi<T>(valori: T[], dimensione: number): T[][] {
  const blocchi: T[][] = [];
  for (let i = 0; i < valori.length; i += dimensione) blocchi.push(valori.slice(i, i + dimensione));
  return blocchi;
}

/** Legge tutte le pagine di una query (il database restituisce al massimo 1000 righe per volta). */
async function leggiPagine<T>(costruisci: (da: number, a: number) => PromiseLike<RispostaQuery>): Promise<T[]> {
  const tutte: T[] = [];
  for (let da = 0; da < 50000; da += DIMENSIONE_PAGINA) {
    const { data, error } = await costruisci(da, da + DIMENSIONE_PAGINA - 1);
    if (error) throw new Error(error.message);
    const righe = (data ?? []) as T[];
    tutte.push(...righe);
    if (righe.length < DIMENSIONE_PAGINA) break;
  }
  return tutte;
}

let cache: { teamId: string; scadenza: number; dati: DatiTempoDiGioco } | null = null;

/** Da chiamare dopo aver modificato partite o formazioni, se serve rileggere subito. */
export function invalidaTempoDiGioco(): void {
  cache = null;
}

/**
 * Legge dal database tutto cio' che serve (partite, set, formazioni, punti,
 * convocati). Il risultato resta in memoria per pochi secondi, cosi' la vista
 * di squadra e la scheda atleta non rileggono due volte la stessa cosa.
 */
export async function leggiDatiTempoDiGioco(teamId: string, forza = false): Promise<DatiTempoDiGioco> {
  if (!forza && cache && cache.teamId === teamId && cache.scadenza > Date.now()) return cache.dati;

  const [tuttePartite, atlete] = await Promise.all([elencaPartite(teamId), elencaAtlete(teamId)]);
  const partite = tuttePartite.filter((p) => p.stato !== "programmata");
  const idPartite = partite.map((p) => p.id);

  const set: SetLetto[] = [];
  let formazioni: RigaFormazione[] = [];
  const punti: PuntoLetto[] = [];
  const convocati: ConvocatoLetto[] = [];
  let haInfoFormazioneIniziale = true;

  if (idPartite.length > 0) {
    for (const blocco of inBlocchi(idPartite, BLOCCO_ID)) {
      const righe = await leggiPagine<SetLetto>((da, a) =>
        supabaseClient.from("match_sets").select("id, match_id, numero_set, punti_noi, punti_avversario")
          .in("match_id", blocco).order("id").range(da, a));
      set.push(...righe);

      const conv = await leggiPagine<ConvocatoLetto>((da, a) =>
        supabaseClient.from("match_convocati").select("match_id, athlete_id, is_libero")
          .in("match_id", blocco).order("athlete_id").range(da, a)).catch(() => [] as ConvocatoLetto[]);
      convocati.push(...conv);

      // Solo gli eventi che cambiano il punteggio: bastano per sapere ORA e ORDINE di ogni punto.
      const pt = await leggiPagine<PuntoLetto>((da, a) =>
        supabaseClient.from("match_events").select("set_id, skill, esito, athlete_id, creato_il")
          .in("match_id", blocco)
          .or("esito.in.(punto,errore),skill.in.(Punto_avversario,Punto_nostro,Fallo_rotazione)")
          .order("creato_il", { ascending: true }).order("id", { ascending: true }).range(da, a));
      punti.push(...pt);
    }

    const idSet = set.map((s) => s.id);
    for (const blocco of inBlocchi(idSet, BLOCCO_ID)) {
      try {
        const righe = await leggiPagine<RigaFormazione>((da, a) =>
          supabaseClient.from("match_set_lineups")
            .select("set_id, athlete_id, in_campo, posizione_iniziale, sostituisce_id, rientrato, aggiornato_il")
            .in("set_id", blocco).order("athlete_id").range(da, a));
        formazioni.push(...righe.map((r) => ({
          ...r,
          posizione_iniziale: r.posizione_iniziale ?? null,
          sostituisce_id: r.sostituisce_id ?? null,
          rientrato: !!r.rientrato,
        })));
      } catch {
        // Database non ancora aggiornato (colonne dei cambi assenti): si legge il minimo.
        haInfoFormazioneIniziale = false;
        const righe = await leggiPagine<RigaFormazione>((da, a) =>
          supabaseClient.from("match_set_lineups").select("set_id, athlete_id, in_campo, aggiornato_il")
            .in("set_id", blocco).order("athlete_id").range(da, a));
        formazioni.push(...righe.map((r) => ({ ...r, posizione_iniziale: null, sostituisce_id: null, rientrato: false })));
      }
    }
  }

  // Se anche una sola lettura "minima" e' servita, i cambi non sono affidabili per nessuno.
  if (!haInfoFormazioneIniziale) formazioni = formazioni.map((r) => ({ ...r, posizione_iniziale: null, sostituisce_id: null, rientrato: false }));

  const dati: DatiTempoDiGioco = { teamId, partite, atlete, set, formazioni, punti, convocati, haInfoFormazioneIniziale };
  cache = { teamId, scadenza: Date.now() + DURATA_CACHE_MS, dati };
  return dati;
}

/* -------------------------------------------------------------------------- */
/* Calcolo                                                                     */
/* -------------------------------------------------------------------------- */

interface PresenzaSet {
  /** Punti giocati; null = non ricostruibile (non inventato). */
  punti: number | null;
  /** Minuti stimati; null = nessun orario attendibile. */
  minuti: number | null;
  stimata: boolean;
}

interface SequenzaSet {
  totale: number;
  /** Orari dei punti in ordine, solo se coincidono col punteggio del set (altrimenti sequenza non affidabile). */
  orari: number[] | null;
  /** Inizio stimato del set (orario del primo punto meno un intervallo medio) e se gli orari sono plausibili per stimare i minuti. */
  inizio: number | null;
  minutiPlausibili: boolean;
}

function ms(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function costruisciSequenza(s: SetLetto, puntiDelSet: PuntoLetto[]): SequenzaSet {
  const totale = (s.punti_noi ?? 0) + (s.punti_avversario ?? 0);
  const orari: number[] = [];
  for (const p of puntiDelSet) {
    if (!chiHaSegnato(p.skill, p.esito)) continue;
    const t = ms(p.creato_il);
    if (Number.isNaN(t)) return { totale, orari: null, inizio: null, minutiPlausibili: false };
    orari.push(t);
  }
  orari.sort((a, b) => a - b);
  // La sequenza e' affidabile solo se i punti registrati coincidono col punteggio del set.
  if (orari.length !== totale || totale === 0) return { totale, orari: null, inizio: null, minutiPlausibili: false };
  if (orari.length < 2) return { totale, orari, inizio: null, minutiPlausibili: false };
  const intervalloMedio = (orari[orari.length - 1] - orari[0]) / (orari.length - 1);
  const inizio = orari[0] - intervalloMedio;
  const durataMin = (orari[orari.length - 1] - inizio) / 60000;
  // Registrazione "in diretta": un set vero dura 8-70 minuti e un punto ogni almeno 8 secondi.
  const plausibile = orari.length >= 15 && intervalloMedio >= 8000 && durataMin >= 8 && durataMin <= 70;
  return { totale, orari, inizio, minutiPlausibili: plausibile };
}

/** Quanti punti sono stati registrati PRIMA dell'orario t. */
function puntiPrima(orari: number[], t: number): number {
  if (t === Infinity) return orari.length;
  if (t === -Infinity) return 0;
  let n = 0;
  while (n < orari.length && orari[n] < t) n += 1;
  return n;
}

/** Orario (ms) del confine k: -1 = inizio del set, k >= 0 = momento del punto k. */
function orarioConfine(seq: SequenzaSet, k: number): number {
  if (k < 0) return seq.inizio as number;
  return (seq.orari as number[])[k];
}

type Intervallo = [number, number];

function calcolaPresenza(intervalli: Intervallo[], seq: SequenzaSet, stimata: boolean): PresenzaSet {
  const interoSet = intervalli.length === 1 && intervalli[0][0] === -Infinity && intervalli[0][1] === Infinity;
  if (interoSet) {
    let minuti: number | null = null;
    if (seq.minutiPlausibili && seq.orari && seq.inizio !== null) minuti = (seq.orari[seq.orari.length - 1] - seq.inizio) / 60000;
    return { punti: seq.totale, minuti, stimata };
  }
  if (!seq.orari) return { punti: null, minuti: null, stimata };
  let punti = 0;
  let minuti = 0;
  for (const [da, a] of intervalli) {
    const i = puntiPrima(seq.orari, da);
    const j = Math.max(i, puntiPrima(seq.orari, a));
    punti += j - i;
    if (seq.minutiPlausibili && j > i) minuti += (orarioConfine(seq, j - 1) - orarioConfine(seq, i - 1)) / 60000;
  }
  return { punti, minuti: seq.minutiPlausibili ? minuti : null, stimata: true };
}

/**
 * Ricostruisce la presenza in campo di UNA riga di formazione dentro un set.
 * Ritorna null se i dati non permettono di dire quanti punti ha giocato.
 */
function presenzaDaRiga(
  riga: RigaFormazione,
  righeSet: RigaFormazione[],
  seq: SequenzaSet,
  eLibero: (athleteId: string) => boolean,
  haInfoCambi: boolean,
): PresenzaSet {
  const TUTTO: Intervallo = [-Infinity, Infinity];
  const nonDisponibile: PresenzaSet = { punti: null, minuti: null, stimata: false };
  const ingresso = (r: RigaFormazione): number => ms(r.aggiornato_il);

  const libero = eLibero(riga.athlete_id) && riga.posizione_iniziale === null && riga.sostituisce_id === null;
  const titolare = riga.posizione_iniziale !== null;
  const setHaLibero = righeSet.some((r) => r.posizione_iniziale === null && r.sostituisce_id === null && eLibero(r.athlete_id));

  // Chi e' entrato al posto suo (ordinati per orario di ingresso).
  const subentrati = righeSet
    .filter((y) => y.athlete_id !== riga.athlete_id && y.sostituisce_id === riga.athlete_id)
    .map(ingresso).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
  const uscita = subentrati.length > 0 ? subentrati[0] : null;

  if (libero) {
    const entra = ingresso(riga);
    if (Number.isNaN(entra) || !seq.orari) return { punti: seq.totale, minuti: null, stimata: true };
    const fine = uscita ?? Infinity;
    return calcolaPresenza([[entra, fine]], seq, true);
  }

  if (!haInfoCambi) {
    // Senza le informazioni sui cambi si sa solo chi e' comparsa in formazione: i punti non sono ricostruibili,
    // salvo il caso in cui nessuno sia uscito e la formazione sia di sole 6 giocatrici in campo per tutto il set.
    const tutteInCampo = righeSet.every((r) => r.in_campo);
    if (righeSet.length <= 6 && tutteInCampo) return calcolaPresenza([TUTTO], seq, false);
    return nonDisponibile;
  }

  if (titolare) {
    if (uscita === null) {
      // Mai sostituita. Se risulta fuori campo senza che nessuno sia entrata al suo posto: o l'ha rimpiazzata il Libero
      // (caso normale, resta in gara) oppure e' un cambio vecchio non tracciato.
      if (!riga.in_campo && !setHaLibero) return nonDisponibile;
      return calcolaPresenza([TUTTO], seq, !riga.in_campo);
    }
    if (riga.rientrato) {
      const rientro = ingresso(riga);
      if (Number.isNaN(rientro)) return nonDisponibile;
      return calcolaPresenza([[-Infinity, uscita], [rientro, Infinity]], seq, true);
    }
    if (riga.in_campo) return nonDisponibile; // rientrata senza traccia del rientro
    return calcolaPresenza([[-Infinity, uscita]], seq, true);
  }

  if (riga.sostituisce_id !== null) {
    // Entrata a set in corso.
    const entra = ingresso(riga);
    if (Number.isNaN(entra)) return nonDisponibile;
    let fine: number | null = null;
    if (uscita !== null) fine = uscita; // sostituita a sua volta
    else if (riga.in_campo) fine = Infinity;
    else {
      const originale = righeSet.find((r) => r.athlete_id === riga.sostituisce_id);
      if (originale && originale.rientrato && !Number.isNaN(ingresso(originale))) fine = ingresso(originale);
      else if (setHaLibero) fine = Infinity; // fuori campo per il Libero
    }
    if (fine === null) return nonDisponibile;
    return calcolaPresenza([[entra, fine]], seq, true);
  }

  // Riga senza ne' posizione iniziale ne' sostituzione: set giocato prima che fossero registrati i cambi.
  const nessunaInfo = righeSet.every((r) => r.posizione_iniziale === null && r.sostituisce_id === null);
  if (nessunaInfo && righeSet.length <= 6 && righeSet.every((r) => r.in_campo)) return calcolaPresenza([TUTTO], seq, true);
  return nonDisponibile;
}

/**
 * Calcola il tempo di gioco di tutte le atlete attive a partire dai dati
 * letti. Funzione pura: nessuna chiamata di rete, quindi i filtri si
 * cambiano al volo.
 */
export function calcolaTempoDiGioco(dati: DatiTempoDiGioco, filtro: FiltroTipoGara = "tutte"): TempoDiGiocoSquadra {
  const partite = dati.partite
    .filter((p) => filtro === "tutte" || p.tipo_gara === filtro)
    .sort((a, b) => a.data.localeCompare(b.data));

  const liberiConvocati = new Set(dati.convocati.filter((c) => c.is_libero).map((c) => `${c.match_id}|${c.athlete_id}`));
  const ruoloLibero = new Map(dati.atlete.map((a) => [a.id, a.ruolo_campo === "Libero"] as const));

  const setPerPartita = new Map<string, SetLetto[]>();
  for (const s of dati.set) {
    const l = setPerPartita.get(s.match_id) ?? [];
    l.push(s);
    setPerPartita.set(s.match_id, l);
  }
  const righePerSet = new Map<string, RigaFormazione[]>();
  for (const r of dati.formazioni) {
    const l = righePerSet.get(r.set_id) ?? [];
    l.push(r);
    righePerSet.set(r.set_id, l);
  }
  const puntiPerSet = new Map<string, PuntoLetto[]>();
  for (const p of dati.punti) {
    const l = puntiPerSet.get(p.set_id) ?? [];
    l.push(p);
    puntiPerSet.set(p.set_id, l);
  }
  const convocatiPerPartita = new Map<string, Set<string>>();
  for (const c of dati.convocati) {
    const l = convocatiPerPartita.get(c.match_id) ?? new Set<string>();
    l.add(c.athlete_id);
    convocatiPerPartita.set(c.match_id, l);
  }

  interface Acc {
    atl: Athlete;
    libero: boolean;
    partiteDisp: number; partiteGioc: number;
    setDisp: number; setGioc: number; setSenzaPunti: number;
    punti: number; puntiSq: number;
    conStime: boolean;
    minuti: number; setConMinuti: number;
    partite: DettaglioPartitaAtleta[];
  }
  const acc = new Map<string, Acc>();
  for (const a of dati.atlete) {
    acc.set(a.id, {
      atl: a, libero: a.ruolo_campo === "Libero",
      partiteDisp: 0, partiteGioc: 0, setDisp: 0, setGioc: 0, setSenzaPunti: 0,
      punti: 0, puntiSq: 0, conStime: false, minuti: 0, setConMinuti: 0, partite: [],
    });
  }

  let partiteConsiderate = 0;
  let setConsiderati = 0;
  let setSenzaFormazione = 0;

  for (const partita of partite) {
    const setPartita = (setPerPartita.get(partita.id) ?? []).sort((a, b) => a.numero_set - b.numero_set);
    // Set realmente giocati e con formazione registrata.
    const validi: { s: SetLetto; righe: RigaFormazione[]; seq: SequenzaSet }[] = [];
    for (const s of setPartita) {
      const totale = (s.punti_noi ?? 0) + (s.punti_avversario ?? 0);
      if (totale === 0) continue;
      const righe = righePerSet.get(s.id) ?? [];
      if (righe.length === 0) { setSenzaFormazione += 1; continue; }
      validi.push({ s, righe, seq: costruisciSequenza(s, puntiPerSet.get(s.id) ?? []) });
    }
    if (validi.length === 0) continue;
    partiteConsiderate += 1;
    setConsiderati += validi.length;

    const convocate = convocatiPerPartita.get(partita.id);

    for (const a of acc.values()) {
      const id = a.atl.id;
      const haGiocato = validi.some((v) => v.righe.some((r) => r.athlete_id === id));
      const convocata = !!convocate && convocate.has(id);
      if (!haGiocato && !convocata) continue;

      a.partiteDisp += 1;
      if (haGiocato) a.partiteGioc += 1;

      const eLibero = (athleteId: string) => ruoloLibero.get(athleteId) === true || liberiConvocati.has(`${partita.id}|${athleteId}`);

      const dettaglio: DettaglioPartitaAtleta = {
        matchId: partita.id, avversario: partita.avversario, data: partita.data, tipoGara: partita.tipo_gara,
        setGiocati: 0, setTotali: validi.length, puntiInCampo: null, puntiTotali: 0, convocataSenzaGiocare: !haGiocato,
      };

      for (const v of validi) {
        a.setDisp += 1;
        const riga = v.righe.find((r) => r.athlete_id === id);
        if (!riga) {
          // Non e' scesa in campo in questo set: 0 punti su tutti quelli della squadra.
          a.puntiSq += v.seq.totale;
          dettaglio.puntiTotali += v.seq.totale;
          dettaglio.puntiInCampo = (dettaglio.puntiInCampo ?? 0);
          continue;
        }
        a.setGioc += 1;
        dettaglio.setGiocati += 1;
        const pres = presenzaDaRiga(riga, v.righe, v.seq, eLibero, dati.haInfoFormazioneIniziale);
        if (pres.punti === null) {
          a.setSenzaPunti += 1;
          continue;
        }
        a.punti += pres.punti;
        a.puntiSq += v.seq.totale;
        if (pres.stimata) a.conStime = true;
        dettaglio.puntiTotali += v.seq.totale;
        dettaglio.puntiInCampo = (dettaglio.puntiInCampo ?? 0) + pres.punti;
        if (pres.minuti !== null) { a.minuti += pres.minuti; a.setConMinuti += 1; }
      }
      a.partite.push(dettaglio);
    }
  }

  const atlete: TempoAtleta[] = [...acc.values()]
    .filter((a) => a.partiteDisp > 0)
    .map((a) => ({
      athleteId: a.atl.id, nome: a.atl.nome, cognome: a.atl.cognome, numeroMaglia: a.atl.numero_maglia, ruolo: a.atl.ruolo_campo,
      libero: a.libero,
      partiteDisponibili: a.partiteDisp, partiteGiocate: a.partiteGioc,
      setDisponibili: a.setDisp, setGiocati: a.setGioc, setSenzaPunti: a.setSenzaPunti,
      puntiInCampo: a.punti, puntiSquadra: a.puntiSq,
      percentuale: a.puntiSq > 0 ? a.punti / a.puntiSq : null,
      conStime: a.conStime,
      minutiStimati: a.setConMinuti > 0 ? Math.round(a.minuti) : null,
      setConMinuti: a.setConMinuti,
      sottoSoglia: false,
      partite: a.partite.sort((x, y) => y.data.localeCompare(x.data)),
    }));

  // Media delle atlete di movimento: la Libero e' quasi sempre in campo e alzerebbe la media.
  const base = atlete.filter((a) => !a.libero && a.percentuale !== null);
  const media = base.length > 0 ? base.reduce((s, a) => s + (a.percentuale as number), 0) / base.length : null;
  const soglia = media !== null ? media * FRAZIONE_SOGLIA : null;
  if (soglia !== null) {
    for (const a of atlete) {
      a.sottoSoglia = !a.libero && a.percentuale !== null && a.partiteDisponibili >= MIN_PARTITE_PER_SEGNALAZIONE && a.percentuale < soglia;
    }
  }

  return {
    atlete, partiteConsiderate, setConsiderati, setSenzaFormazione,
    mediaPercentuale: media, soglia,
    infoCambiDisponibili: dati.haInfoFormazioneIniziale,
  };
}

/** Comodo: legge i dati e calcola, in una sola chiamata. */
export async function tempoDiGiocoSquadra(teamId: string, filtro: FiltroTipoGara = "tutte", forza = false): Promise<TempoDiGiocoSquadra> {
  const dati = await leggiDatiTempoDiGioco(teamId, forza);
  return calcolaTempoDiGioco(dati, filtro);
}

/* -------------------------------------------------------------------------- */
/* Testi condivisi                                                             */
/* -------------------------------------------------------------------------- */

export function formattaPercentuale(p: number | null): string {
  return p === null ? "n.d." : `${Math.round(p * 100)}%`;
}

export function nomeCompleto(a: Pick<TempoAtleta, "nome" | "cognome">): string {
  return `${a.nome} ${a.cognome}`.trim();
}

/** Nota da mostrare sempre accanto ai numeri: dice cosa e' misurato e cosa e' stimato. */
export const NOTA_METODO =
  "Il tempo di gioco è misurato in punti giocati in campo e set giocati, ricavati dalle formazioni e dai cambi registrati nello scouting. " +
  "I punti di chi entra o esce a set in corso sono una stima (si contano i punti registrati prima e dopo il cambio): possono differire di qualche punto se il cambio è stato inserito in ritardo. " +
  "Il Libero è contato presente dal primo ingresso. I minuti, quando compaiono, sono una stima dagli orari di registrazione e solo per i set registrati in diretta.";
