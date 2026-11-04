import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";

/**
 * Diretta per i genitori: link/QR "sola visione", senza account, che mostra SOLO il punteggio.
 * Migrazione 0099_diretta_genitori.sql. Se la migrazione non e' ancora applicata le funzioni qui sotto non
 * crashano: chi legge riceve lo stato "non_attiva", chi gestisce riceve un errore con testo leggibile.
 */

export interface SetGenitori {
  numero: number;
  noi: number;
  avv: number;
}

/** Cosa vede il genitore: niente nomi di atlete, niente azioni, niente statistiche. */
export type DirettaGenitori =
  | { stato: "in_corso"; squadra: string; avversario: string; set_vinti_noi: number; set_vinti_avv: number; set_in_corso: SetGenitori | null; set_conclusi: SetGenitori[] }
  | { stato: "non_iniziata"; squadra: string; avversario: string }
  /** Link scaduto, revocato, sbagliato oppure partita conclusa (il server non distingue, di proposito). */
  | { stato: "non_disponibile" }
  /** Troppi tentativi con codici non validi da questo indirizzo. */
  | { stato: "riprova" }
  /** La funzione non esiste ancora sul database (migrazione non applicata). */
  | { stato: "non_attiva" };

export interface LinkGenitori {
  token: string;
  scade_il: string;
}

/** Indirizzo da aprire (e da mettere nel QR) per un codice. */
export function linkGenitori(token: string): string {
  const base = (cfg.authRedirectUrl || "").replace(/\/+$/, "");
  return `${base}/genitori/${token}`;
}

/** True se l'errore dice che la funzione/tabella non esiste ancora sul database. */
export function funzioneGenitoriAssente(e: unknown): boolean {
  const x = e as { code?: string; message?: string } | null;
  if (!x) return false;
  const msg = (x.message ?? "").toLowerCase();
  return x.code === "PGRST202" || x.code === "42883" || x.code === "42P01" || x.code === "PGRST205"
    || msg.includes("could not find the function") || msg.includes("does not exist");
}

const MSG_NON_ATTIVA = "La condivisione con i genitori non è ancora attiva. Riprova più tardi.";

function messaggio(e: unknown): string {
  if (funzioneGenitoriAssente(e)) return MSG_NON_ATTIVA;
  const m = (e as { message?: string } | null)?.message;
  return m || "Operazione non riuscita";
}

const STATI_VALIDI = ["in_corso", "non_iniziata", "non_disponibile", "riprova"];

/**
 * Legge il punteggio dal link (pubblico, nessun accesso richiesto). In caso di problemi di rete lancia:
 * chi chiama deve tenere l'ultimo punteggio mostrato e riprovare.
 */
export async function leggiDirettaGenitori(token: string): Promise<DirettaGenitori> {
  const { data, error } = await supabaseClient.rpc("diretta_genitori", { p_token: token });
  if (error) {
    if (funzioneGenitoriAssente(error)) return { stato: "non_attiva" };
    throw new Error(error.message);
  }
  const d = data as unknown as { stato?: string } | null;
  if (!d || typeof d.stato !== "string" || !STATI_VALIDI.includes(d.stato)) return { stato: "non_disponibile" };
  return d as DirettaGenitori;
}

/** Per lo staff: il link attivo della partita (lo crea se manca o se e' scaduto). */
export async function ottieniLinkGenitori(matchId: string): Promise<LinkGenitori> {
  const { data, error } = await supabaseClient.rpc("genitori_link_ottieni", { p_match_id: matchId });
  if (error) throw new Error(messaggio(error));
  return data as unknown as LinkGenitori;
}

/** Per lo staff: nuovo link; il precedente smette subito di funzionare. */
export async function cambiaLinkGenitori(matchId: string): Promise<LinkGenitori> {
  const { data, error } = await supabaseClient.rpc("genitori_link_ruota", { p_match_id: matchId });
  if (error) throw new Error(messaggio(error));
  return data as unknown as LinkGenitori;
}

/** Per lo staff: il link smette di funzionare finche' non se ne crea uno nuovo. */
export async function revocaLinkGenitori(matchId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("genitori_link_revoca", { p_match_id: matchId });
  if (error) throw new Error(messaggio(error));
}

/** Testo del messaggio da mandare ai genitori (WhatsApp o altro). */
export function messaggioGenitori(squadra: string | null | undefined, avversario: string | null | undefined, link: string): string {
  const partita = squadra && avversario ? `${squadra} – ${avversario}` : squadra || avversario || "la partita";
  return `Segui il punteggio in diretta di ${partita}: ${link}\n(Si apre dal telefono, senza account. Mostra solo il punteggio.)`;
}
