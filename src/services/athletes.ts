import { supabaseClient } from "@/src/lib/supabase";
import type { Athlete } from "@/src/types/database";

export async function elencaAtlete(teamId: string): Promise<Athlete[]> {
  const { data, error } = await supabaseClient
    .from("athletes")
    .select("*")
    .eq("team_id", teamId)
    .eq("status", "attiva")
    .order("cognome");
  if (error) throw error;
  return data ?? [];
}

export async function creaAtleta(teamId: string, input: Pick<Athlete, "nome" | "cognome" | "ruolo_campo" | "numero_maglia" | "data_nascita">): Promise<Athlete> {
  const { data, error } = await supabaseClient
    .from("athletes")
    .insert({ team_id: teamId, ...input })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function archiviaAtleta(atletaId: string): Promise<void> {
  const { error } = await supabaseClient.from("athletes").update({ status: "archiviata" }).eq("id", atletaId);
  if (error) throw error;
}
