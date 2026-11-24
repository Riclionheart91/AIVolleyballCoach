import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabaseClient } from "./supabase";
import type { StatoPartita, SetLoc, EventoLoc } from "./motorePartita";
import type { Athlete, Match, MatchConvocato, MatchSetLineup } from "../types/database";

/**
 * Copia della partita sul telefono. Serve a continuare a registrare quando manca la rete: le operazioni
 * (punti, cambi, Libero, time-out, set, chiusura) si applicano a questa copia con il motore locale
 * (motorePartita.ts) e intanto finiscono in coda per essere rimandate al server (codaOffline.ts).
 *
 * "Modalità locale" di una partita = da quel momento si legge e si scrive su questa copia invece che sul server.
 * Resta attiva finché la coda non è stata inviata del tutto e la partita è stata riletta dal server.
 * La copia si aggiorna da sola mentre c'è rete (aggiornaDaServer) e a ogni operazione riuscita (applicaOmbra).
 */
const PREFISSO = "partita_locale_v1_";

const memoria = new Map<string, StatoPartita>();
const attive = new Set<string>();
const caricate = new Set<string>();
const contatori = new Map<string, number>();
const ascoltatori = new Set<() => void>();
const timerSalvataggio = new Map<string, ReturnType<typeof setTimeout>>();
const ultimoAggiornamento = new Map<string, number>();
let versioneGlobale = 0;

function notifica() { versioneGlobale += 1; ascoltatori.forEach((f) => f()); }
function copia<T>(x: T): T { return JSON.parse(JSON.stringify(x)) as T; }

function salvaOra(matchId: string): void {
  const stato = memoria.get(matchId);
  if (!stato) return;
  AsyncStorage.setItem(PREFISSO + matchId, JSON.stringify({ stato, attiva: attive.has(matchId) })).catch(() => { /* resta in memoria finché l'app è aperta */ });
}
function salvaConRitardo(matchId: string): void {
  if (timerSalvataggio.has(matchId)) return;
  timerSalvataggio.set(matchId, setTimeout(() => { timerSalvataggio.delete(matchId); salvaOra(matchId); }, 3000));
}

/** Legge dal telefono la copia della partita (se c'è). Da chiamare prima di leggere o scrivere. */
export async function caricaDaDisco(matchId: string): Promise<void> {
  if (caricate.has(matchId)) return;
  caricate.add(matchId);
  try {
    const grezzo = await AsyncStorage.getItem(PREFISSO + matchId);
    if (!grezzo || memoria.has(matchId)) return;
    const { stato, attiva } = JSON.parse(grezzo) as { stato: StatoPartita; attiva: boolean };
    if (stato?.v !== 1) return;
    memoria.set(matchId, stato);
    if (attiva) attive.add(matchId);
    notifica();
  } catch { /* copia illeggibile: si riparte dal server */ }
}

export function leggi(matchId: string): StatoPartita | null { return memoria.get(matchId) ?? null; }
export function inModoLocale(matchId: string | null | undefined): boolean { return !!matchId && attive.has(matchId); }
export function partiteInModoLocale(): string[] { return Array.from(attive); }

export function attivaModoLocale(matchId: string): void {
  if (!memoria.has(matchId)) return;
  attive.add(matchId);
  salvaOra(matchId);
  notifica();
}
export function disattivaModoLocale(matchId: string): void {
  if (!attive.delete(matchId)) return;
  salvaOra(matchId);
  notifica();
}

/** Id della partita a cui appartiene un set (cercando tra le copie in memoria). */
export function idPartitaDelSet(setId: string): string | null {
  for (const [id, s] of memoria) if (s.sets.some((q) => q.id === setId)) return id;
  return null;
}

/**
 * Applica un'operazione alla copia locale. Lavora su una copia e la tiene solo se l'operazione riesce:
 * se il motore rifiuta (come farebbe il server) la partita resta com'era e l'errore arriva a chi ha chiamato.
 */
export function applica<T>(matchId: string, f: (s: StatoPartita) => T): T {
  const base = memoria.get(matchId);
  if (!base) throw new Error("Partita non disponibile senza rete: aprila una volta con la connessione.");
  const c = copia(base);
  const r = f(c);
  memoria.set(matchId, c);
  contatori.set(matchId, (contatori.get(matchId) ?? 0) + 1);
  salvaOra(matchId);
  notifica();
  return r;
}

/** Come applica, ma per tenere allineata la copia mentre il server ha già fatto l'operazione: se il motore non riesce si rilegge dal server. */
export function applicaOmbra(matchId: string, f: (s: StatoPartita) => unknown): void {
  const base = memoria.get(matchId);
  if (!base) return;
  try {
    const c = copia(base);
    f(c);
    memoria.set(matchId, c);
    contatori.set(matchId, (contatori.get(matchId) ?? 0) + 1);
    salvaConRitardo(matchId);
    notifica();
  } catch {
    aggiornaDaServer(matchId, true).catch(() => undefined);
  }
}

async function tutti<T>(leggiPagina: (da: number, a: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const DIM = 1000;
  for (let da = 0; da < 20000; da += DIM) {
    const { data, error } = await leggiPagina(da, da + DIM - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < DIM) break;
  }
  return out;
}

/** Scarica dal server tutto ciò che serve per giocare la partita senza rete. */
export async function scarica(matchId: string): Promise<StatoPartita> {
  const q = supabaseClient;
  const { data: m, error: em } = await q.from("matches").select("*").eq("id", matchId).single();
  if (em) throw new Error(em.message);
  if (!m) throw new Error("Partita non trovata");
  const match = m as Match;
  const [sets, eventi, timeouts, convocati, atlete, campionato, regola] = await Promise.all([
    q.from("match_sets").select("*").eq("match_id", matchId).order("numero_set"),
    tutti<EventoLoc>((da, a) => q.from("match_events").select("*").eq("match_id", matchId).order("creato_il", { ascending: true }).order("id", { ascending: true }).range(da, a)),
    q.from("match_timeouts").select("*").eq("match_id", matchId).order("creato_il"),
    q.from("match_convocati").select("*").eq("match_id", matchId),
    q.from("athletes").select("*").eq("team_id", match.team_id).eq("status", "attiva").order("cognome"),
    match.campionato_id ? q.from("campionati").select("punti_per_set, punti_set_decisivo, numero_liberi_max, distinta_max_giocatrici").eq("id", match.campionato_id).single() : Promise.resolve({ data: null, error: null }),
    q.rpc("leggi_regola_libero", { p_match_id: matchId }),
  ]);
  for (const r of [sets, timeouts, convocati, atlete]) if (r.error) throw new Error(r.error.message);
  if (regola.error) throw new Error(regola.error.message);
  const setList = (sets.data ?? []) as SetLoc[];
  const setIds = setList.map((s) => s.id);
  let formazioni: MatchSetLineup[] = [];
  let rimpiazzi: StatoPartita["rimpiazzi"] = [];
  if (setIds.length > 0) {
    const [f, r] = await Promise.all([
      q.from("match_set_lineups").select("*").in("set_id", setIds),
      q.from("rimpiazzi_libero").select("*").in("set_id", setIds),
    ]);
    if (f.error) throw new Error(f.error.message);
    if (r.error) throw new Error(r.error.message);
    formazioni = (f.data ?? []) as MatchSetLineup[];
    rimpiazzi = (r.data ?? []) as StatoPartita["rimpiazzi"];
  }
  const camp = campionato.data as { punti_per_set: number | null; punti_set_decisivo: number | null; numero_liberi_max: number | null; distinta_max_giocatrici: number | null } | null;
  const r0 = ((regola.data ?? []) as { libero_id: string | null; titolare_1: string | null; titolare_2: string | null }[])[0] ?? null;
  return {
    v: 1, match, sets: setList, eventi, formazioni, timeouts: (timeouts.data ?? []) as StatoPartita["timeouts"], rimpiazzi,
    convocati: (convocati.data ?? []) as MatchConvocato[], atlete: (atlete.data ?? []) as Athlete[],
    regole: {
      puntiPerSet: camp?.punti_per_set ?? 25, puntiSetDecisivo: camp?.punti_set_decisivo ?? 15,
      numeroLiberiMax: camp?.numero_liberi_max ?? 2, distintaMax: camp?.distinta_max_giocatrici ?? null,
    },
    regolaLibero: r0, seq: 0,
  };
}

/**
 * Rilegge la partita dal server e la tiene come copia locale. Se nel frattempo la copia è cambiata (un'operazione
 * riuscita mentre si scaricava) il risultato viene scartato, per non tornare indietro. Con `forza` si salta l'attesa fra due letture.
 * Ritorna true se la copia è stata aggiornata. Non fa nulla finché la partita è in modalità locale (si usa tornaOnline).
 */
export async function aggiornaDaServer(matchId: string, forza = false): Promise<boolean> {
  if (attive.has(matchId)) return false;
  const adesso = Date.now();
  if (!forza && adesso - (ultimoAggiornamento.get(matchId) ?? 0) < 8000) return false;
  ultimoAggiornamento.set(matchId, adesso);
  const prima = contatori.get(matchId) ?? 0;
  const stato = await scarica(matchId);
  if (attive.has(matchId) || (contatori.get(matchId) ?? 0) !== prima) return false;
  memoria.set(matchId, stato);
  caricate.add(matchId);
  salvaConRitardo(matchId);
  notifica();
  return true;
}

/**
 * Fine della modalità locale: la coda è stata inviata, si rilegge la partita dal server (che ora è la verità)
 * e si torna a lavorare online. Ritorna false se la rete non c'è ancora.
 */
export async function tornaOnline(matchId: string): Promise<boolean> {
  if (!attive.has(matchId)) return true;
  try {
    const prima = contatori.get(matchId) ?? 0;
    const stato = await scarica(matchId);
    // Mentre si scaricava è stata fatta un'altra operazione (resta in coda): non si torna online, si riprova al prossimo giro.
    if ((contatori.get(matchId) ?? 0) !== prima) return false;
    memoria.set(matchId, stato);
    contatori.set(matchId, prima + 1);
    attive.delete(matchId);
    salvaOra(matchId);
    notifica();
    return true;
  } catch {
    return false;
  }
}

/** Per ridisegnare le schermate quando la copia locale cambia. */
export function useVersionePartitaLocale(): number {
  return useSyncExternalStore(
    (cb) => { ascoltatori.add(cb); return () => { ascoltatori.delete(cb); }; },
    () => versioneGlobale,
    () => 0,
  );
}
