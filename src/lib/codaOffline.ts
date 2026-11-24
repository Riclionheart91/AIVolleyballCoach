import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { annullaUltimoEvento, impostaBarrieraCoda, impostaCausaEvento, impostaZoneEvento, registraEvento } from "@/src/services/matches";
import type { CausaPunto, Esito, QualitaRicezione, Skill } from "@/src/types/database";

/**
 * Coda offline dello scouting: se durante la partita manca la rete, le azioni (punti, fondamentali,
 * annulla) restano sul telefono e vengono inviate in ordine appena la connessione torna. A schermo
 * si continua a vedere il punteggio aggiornato; un indicatore dice quante azioni sono in attesa.
 *
 * Restano solo online le operazioni che cambiano la struttura della partita (nuovo set, cambi, Libero,
 * time-out, rotazione, chiusura): se ci sono azioni in coda, prima si inviano quelle (vedi impostaBarrieraCoda).
 */
export type OpCoda =
  | {
      id: string; tipo: "evento"; matchId: string; tempId: string; setId: string;
      skill: Skill; esito: Esito | null; athleteId: string | null; qualita: QualitaRicezione | null;
      causa: CausaPunto | null; zonaArrivo: number | null; zonaPartenza: number | null;
    }
  | { id: string; tipo: "annulla"; matchId: string };

const CHIAVE = "coda_offline_scout_v1";

let operazioni: OpCoda[] = [];
let caricatoDaDisco = false;
const ascoltatori = new Set<() => void>();
let inInvio = false;

function notifica() { ascoltatori.forEach((f) => f()); }
function salva() {
  AsyncStorage.setItem(CHIAVE, JSON.stringify(operazioni)).catch(() => { /* resta in memoria finché l'app è aperta */ });
}

/** Legge dal telefono le azioni rimaste in coda (da chiamare all'apertura della partita). */
export async function caricaCodaDaDisco(): Promise<void> {
  if (caricatoDaDisco) return;
  caricatoDaDisco = true;
  try {
    const grezzo = await AsyncStorage.getItem(CHIAVE);
    if (!grezzo) return;
    const salvate = JSON.parse(grezzo) as OpCoda[];
    // Quelle già in memoria (messe prima della lettura) vanno dopo.
    operazioni = [...salvate, ...operazioni.filter((o) => !salvate.some((s) => s.id === o.id))];
    notifica();
  } catch { /* coda illeggibile: si riparte vuoti */ }
}

export function accoda(op: OpCoda): void {
  operazioni = [...operazioni, op];
  salva();
  notifica();
}

/** Toglie dalla coda l'evento ancora non inviato (annulla di un'azione appena fatta, mai arrivata al server). */
export function rimuoviEventoInCoda(tempId: string): boolean {
  const prima = operazioni.length;
  operazioni = operazioni.filter((o) => !(o.tipo === "evento" && o.tempId === tempId));
  if (operazioni.length === prima) return false;
  salva();
  notifica();
  return true;
}

export function inCoda(matchId: string): number {
  return operazioni.filter((o) => o.matchId === matchId).length;
}

export function idCasuale(): string {
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** True se l'errore dipende dalla connessione (si riprova più tardi) e non da un rifiuto del server. */
export function erroreDiRete(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = String((e as { message?: string } | null)?.message ?? e ?? "");
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|timed? ?out|connection (was )?(lost|reset|closed)|offline|nessuna connessione/i.test(msg);
}

async function esegui(op: OpCoda): Promise<void> {
  if (op.tipo === "annulla") { await annullaUltimoEvento(op.matchId); return; }
  const nuovoId = await registraEvento(op.matchId, op.setId, op.skill, op.esito, op.athleteId, op.qualita);
  if (op.causa) {
    try { await impostaCausaEvento(nuovoId, op.causa); } catch (e) { console.warn("Motivo del punto non salvato:", (e as Error).message); }
  }
  if (op.zonaArrivo !== null || op.zonaPartenza !== null) {
    try { await impostaZoneEvento(nuovoId, op.zonaArrivo, op.zonaPartenza); } catch (e) { console.warn("Zone non salvate:", (e as Error).message); }
  }
}

export interface EsitoInvio { inviate: number; scartate: { op: OpCoda; messaggio: string }[]; rimaste: number; }

/**
 * Invia in ordine le azioni in coda di una partita. Si ferma alla prima mancanza di rete (le altre restano in coda);
 * un'azione che il server rifiuta davvero (es. set già chiuso) viene scartata e segnalata.
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

/** Numero di azioni in attesa per la partita (si aggiorna da solo a schermo). */
export function useAzioniInCoda(matchId: string | undefined): number {
  return useSyncExternalStore(
    (cb) => { ascoltatori.add(cb); return () => { ascoltatori.delete(cb); }; },
    () => (matchId ? inCoda(matchId) : 0),
    () => 0,
  );
}

// Prima di un'operazione che cambia la partita le azioni in coda devono essere arrivate al server.
impostaBarrieraCoda(async () => {
  const partite = Array.from(new Set(operazioni.map((o) => o.matchId)));
  for (const m of partite) await inviaCoda(m);
  if (operazioni.length > 0) {
    throw new Error(`Ci sono ${operazioni.length} azioni di scouting non ancora inviate (manca la rete). Si inviano da sole appena la connessione torna: poi ripeti questa operazione.`);
  }
});
