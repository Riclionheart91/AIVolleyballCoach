import { supabaseClient } from "@/src/lib/supabase";
import type { StatoPartitaOspite } from "@/src/services/scoutOspiti";

/** Una partita in corso che chi chiama puo' guardare (tutte le squadre della propria societa'). */
export interface PartitaLive {
  match_id: string;
  team_id: string;
  team_nome: string;
  societa_nome: string | null;
  avversario: string;
  set_corrente: number;
  punti_noi: number;
  punti_avversario: number;
  set_vinti_noi: number;
  set_vinti_avversario: number;
}

/** Le partite in corso della propria societa'. In caso di errore lancia: chi chiama deve distinguere "nessuna live" da "non sono riuscito a leggere". */
export async function elencaPartiteLive(): Promise<PartitaLive[]> {
  const { data, error } = await supabaseClient.rpc("live_partite_in_corso");
  if (error) { console.warn("Errore nel leggere le live:", error.message); throw new Error(error.message); }
  return (data ?? []) as PartitaLive[];
}

/** Stato della partita per chi la guarda soltanto. Fallisce (Permesso negato) quando la partita non e' piu' in corso. */
export async function statoPartitaLive(matchId: string): Promise<StatoPartitaOspite> {
  const { data, error } = await supabaseClient.rpc("live_stato_partita", { p_match_id: matchId });
  if (error) throw error;
  return data as unknown as StatoPartitaOspite;
}
