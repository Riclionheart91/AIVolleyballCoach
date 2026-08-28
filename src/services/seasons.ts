import { supabaseClient } from "@/src/lib/supabase";
import type { Season, SeasonBaseline } from "@/src/types/database";

export async function elencaStagioni(teamId: string): Promise<Season[]> {
  const { data, error } = await supabaseClient.from("seasons").select("*").eq("team_id", teamId).order("data_apertura", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function creaStagione(teamId: string, input: Pick<Season, "nome" | "data_apertura">): Promise<Season> {
  const { data, error } = await supabaseClient.from("seasons").insert({ team_id: teamId, ...input }).select().single();
  if (error) throw error;
  return data;
}

/** Attiva una stagione e disattiva automaticamente le altre — RPC transazionale (vedi migrazione F2). */
export async function attivaStagione(seasonId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("attiva_stagione", { p_season_id: seasonId });
  if (error) throw error;
}

/** Genera la baseline per tutte le atlete attive; ritorna quante righe ha creato. */
export async function generaBaselineStagione(seasonId: string): Promise<number> {
  const { data, error } = await supabaseClient.rpc("genera_baseline_stagione", { p_season_id: seasonId });
  if (error) throw error;
  return data ?? 0;
}

export async function elencaBaselineStagione(seasonId: string): Promise<SeasonBaseline[]> {
  const { data, error } = await supabaseClient.from("season_baselines").select("*").eq("season_id", seasonId);
  if (error) throw error;
  return data ?? [];
}
