import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabaseClient } from "./supabase";
import { erroreDiRete, idOperazione } from "./rete";
import { caricaDaDisco, disattivaModoLocale, inModoLocale, partiteInModoLocale, tornaOnline } from "./partitaLocale";
import { impostaControlloAzioniInAttesa } from "./aggiornamentoApp";
import { eIdLocale } from "./motorePartita";

/**
 * Coda delle operazioni dello scouting fatte senza rete (punti, annulla, cambi, Libero, time-out, rotazioni, set,
 * correzioni, chiusura). Restano sul telefono e vengono inviate in ordine appena la connessione torna.
 * Ogni operazione ha un id e il database la applica una sola volta (funzione applica_operazione_scout):
 * se la risposta si perde e l'operazione viene reinviata, non si segna due volte.
 * I set creati offline hanno un id locale ("loc-set-N"): al momento dell'invio si sostituisce con quello vero.
 */
export interface OpCoda {
  id: string;
  matchId: string;
  tipo: string;
  args: Record<string, unknown>;
}
export { erroreDiRete, idOperazione };

const CHIAVE = "coda_offline_scout_v2";
const CHIAVE_V1 = "coda_offline_scout_v1";

let operazioni: OpCoda[] = [];
let mappaSet: Record<string, string> = {};
let caricatoDaDisco = false;
const ascoltatori = new Set<() => void>();
let inInvio = false;
let timer: ReturnType<typeof setInterval> | null = null;

function notifica() { ascoltatori.forEach((f) => f()); }
function salva() {
  AsyncStorage.setItem(CHIAVE, JSON.stringify({ operazioni, mappaSet })).catch(() => { /* resta in memoria finché l'app è aperta */ });
}

/** Legge dal telefono le operazioni rimaste in coda (da chiamare all'avvio dell'app). */
export async function caricaCodaDaDisco(): Promise<void> {
  if (caricatoDaDisco) return;
  caricatoDaDisco = true;
  try {
    const grezzo = await AsyncStorage.getItem(CHIAVE);
    if (grezzo) {
      const s = JSON.parse(grezzo) as { operazioni?: OpCoda[]; mappaSet?: Record<string, string> };
      const salvate = s.operazioni ?? [];
      operazioni = [...salvate, ...operazioni.filter((o) => !salvate.some((x) => x.id === o.id))];
      mappaSet = { ...(s.mappaSet ?? {}), ...mappaSet };
    }
    // Coda della versione precedente (solo punti e annulla): si converte e si elimina.
    const v1 = await AsyncStorage.getItem(CHIAVE_V1);
    if (v1) {
      try {
        const vecchie = JSON.parse(v1) as Array<Record<string, unknown>>;
        for (const o of vecchie) {
          if (o.tipo === "annulla") operazioni.push({ id: idOperazione(), matchId: String(o.matchId), tipo: "annulla", args: { match_id: o.matchId } });
          else if (o.tipo === "evento") {
            operazioni.push({
              id: idOperazione(), matchId: String(o.matchId), tipo: "evento",
              args: { set_id: o.setId, skill: o.skill, esito: o.esito, athlete_id: o.athleteId, qualita: o.qualita, causa: o.causa, zona_arrivo: o.zonaArrivo, zona_partenza: o.zonaPartenza },
            });
          }
        }
      } catch { /* illeggibile */ }
      await AsyncStorage.removeItem(CHIAVE_V1).catch(() => undefined);
      salva();
    }
    notifica();
    if (operazioni.length > 0) avviaTimer();
  } catch { /* coda illeggibile: si riparte vuoti */ }
}

export function accoda(op: OpCoda): void {
  operazioni = [...operazioni, op];
  salva();
  notifica();
  avviaTimer();
}

export function inCoda(matchId: string): number {
  return operazioni.filter((o) => o.matchId === matchId).length;
}
export function inCodaTotale(): number { return operazioni.length; }
export function idCasuale(): string { return idOperazione(); }

function risolviSet(valore: unknown): string | null {
  if (typeof valore !== "string" || !eIdLocale(valore)) return typeof valore === "string" ? valore : null;
  return mappaSet[valore] ?? null;
}

interface RispostaOperazione { gia_applicata?: boolean; id?: string | null }

async function esegui(op: OpCoda): Promise<void> {
  const args: Record<string, unknown> = { ...op.args };
  if ("set_id" in args && args.set_id) {
    const reale = risolviSet(args.set_id);
    if (!reale) throw new Error("Il set a cui si riferisce questa azione non risulta creato");
    args.set_id = reale;
  }
  delete args.set_locale_id;
  const { data, error } = await supabaseClient.rpc("applica_operazione_scout", { p_op_id: op.id, p_tipo: op.tipo, p_args: args });
  if (error) throw error;
  const risposta = (data ?? {}) as RispostaOperazione;
  const locale = op.args.set_locale_id;
  if (op.tipo === "nuovo_set" && typeof locale === "string" && eIdLocale(locale)) {
    let reale = risposta.id ?? null;
    if (!reale) {
      // Operazione già applicata in un invio precedente (risposta persa): il set creato è l'ultimo della partita.
      const { data: s } = await supabaseClient.from("match_sets").select("id").eq("match_id", op.matchId).order("numero_set", { ascending: false }).limit(1);
      reale = (s?.[0] as { id: string } | undefined)?.id ?? null;
    }
    if (reale) mappaSet[locale] = reale;
  }
}

export interface EsitoInvio { inviate: number; scartate: { op: OpCoda; messaggio: string }[]; rimaste: number }

/**
 * Invia in ordine le operazioni in coda di una partita. Si ferma alla prima mancanza di rete (le altre restano in coda);
 * un'operazione che il server rifiuta davvero (es. set già chiuso) viene scartata e segnalata.
 */
export async function inviaCoda(matchId: string): Promise<EsitoInvio> {
  const esito: EsitoInvio = { inviate: 0, scartate: [], rimaste: 0 };
  if (inInvio) { esito.rimaste = inCoda(matchId); return esito; }
  inInvio = true;
  try {
    for (;;) {
      const prossima = operazioni.find((o) => o.matchId === matchId);
      if (!prossima) break;
      try {
        await esegui(prossima);
        esito.inviate += 1;
      } catch (e) {
        if (erroreDiRete(e)) break;
        esito.scartate.push({ op: prossima, messaggio: (e as Error).message });
      }
      operazioni = operazioni.filter((o) => o.id !== prossima.id);
      salva();
      notifica();
    }
  } finally {
    inInvio = false;
  }
  esito.rimaste = inCoda(matchId);
  return esito;
}

// Operazioni scartate dal server: le schermate le mostrano una volta sola.
let scartateDaMostrare: { op: OpCoda; messaggio: string }[] = [];
export function prendiScartate(): { op: OpCoda; messaggio: string }[] {
  const r = scartateDaMostrare;
  scartateDaMostrare = [];
  return r;
}

/** Un giro di sincronizzazione: invia le code e, finite, torna a leggere la partita dal server. */
export async function sincronizza(): Promise<void> {
  const partite = Array.from(new Set([...operazioni.map((o) => o.matchId), ...partiteInModoLocale()]));
  for (const m of partite) {
    await caricaDaDisco(m);
    if (inCoda(m) > 0) {
      const r = await inviaCoda(m);
      if (r.scartate.length > 0) scartateDaMostrare = [...scartateDaMostrare, ...r.scartate];
    }
    if (inCoda(m) === 0 && inModoLocale(m)) {
      const ok = await tornaOnline(m);
      if (ok) disattivaModoLocale(m);
    }
  }
  if (operazioni.length === 0 && partiteInModoLocale().length === 0) fermaTimer();
}

function avviaTimer() {
  if (timer) return;
  timer = setInterval(() => { sincronizza().catch(() => undefined); }, 5000);
}
function fermaTimer() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

let avviata = false;
/** Da chiamare una volta all'avvio dell'app: riprende dal telefono le operazioni rimaste e le invia appena c'è rete. */
export function avviaSincronizzazione(): void {
  if (avviata) return;
  avviata = true;
  impostaControlloAzioniInAttesa(() => operazioni.length + partiteInModoLocale().length);
  caricaCodaDaDisco().then(() => sincronizza()).catch(() => undefined);
  const g = globalThis as { addEventListener?: (n: string, f: () => void) => void };
  g.addEventListener?.("online", () => { sincronizza().catch(() => undefined); });
}

/** Numero di azioni in attesa per la partita (si aggiorna da solo a schermo). */
export function useAzioniInCoda(matchId: string | undefined): number {
  return useSyncExternalStore(
    (cb) => { ascoltatori.add(cb); return () => { ascoltatori.delete(cb); }; },
    () => (matchId ? inCoda(matchId) : 0),
    () => 0,
  );
}

/** Per ridisegnare quando la coda cambia. */
export function useCodaVersione(): number {
  return useSyncExternalStore(
    (cb) => { ascoltatori.add(cb); return () => { ascoltatori.delete(cb); }; },
    () => operazioni.length,
    () => 0,
  );
}
