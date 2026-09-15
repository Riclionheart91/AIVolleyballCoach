import { supabaseClient } from "@/src/lib/supabase";
import type { Fondamentale } from "@/src/types/database";

export interface RigaScheda {
  fondamentale: Fondamentale;
  valore_attuale: number | null;
  data_attuale: string | null;
  valore_precedente: number | null;
  variazione: number | null;
  record_personale: number | null;
  data_record: string | null;
  e_record_adesso: boolean;
  obiettivo: number | null;
  entro_data: string | null;
  progresso_percentuale: number | null;
  numero_valutazioni: number;
}

export async function leggiSchedaAtleta(athleteId: string): Promise<RigaScheda[]> {
  const { data, error } = await supabaseClient.rpc("scheda_atleta", { p_athlete_id: athleteId });
  if (error) throw error;
  return data ?? [];
}

export async function impostaObiettivo(athleteId: string, fondamentale: Fondamentale, valore: number, entro?: string | null, note = ""): Promise<void> {
  const { error } = await supabaseClient.rpc("imposta_obiettivo_atleta", {
    p_athlete_id: athleteId, p_fondamentale: fondamentale, p_valore: valore, p_entro: entro ?? null, p_note: note,
  });
  if (error) throw error;
}

export async function rimuoviObiettivo(athleteId: string, fondamentale: Fondamentale): Promise<void> {
  const { error } = await supabaseClient.rpc("rimuovi_obiettivo_atleta", { p_athlete_id: athleteId, p_fondamentale: fondamentale });
  if (error) throw error;
}
