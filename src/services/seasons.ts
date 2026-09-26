import { supabaseClient } from "@/src/lib/supabase";
import type { Season, SeasonBaseline } from "@/src/types/database";

/** Elenca le stagioni della società (oggi normalmente una sola attiva + eventuali concluse). */
export async function elencaStagioniSocieta(societaId: string): Promise<Season[]> {
  const { data, error } = await supabaseClient.from("seasons").select("*").eq("societa_id", societaId).order("data_apertura", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Prima stagione mai aperta da una società (nessuna precedente da chiudere). */
export async function apriPrimaStagioneSocieta(societaId: string, nome: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc("apri_prima_stagione_societa", {
    p_societa_id: societaId,
    p_nome: nome,
    p_data_apertura: new Date().toISOString().slice(0, 10),
  });
  if (error) throw error;
  return data as string;
}

/**
 * Chiude la stagione attiva della società e ne apre subito una nuova
 * (nome generato automaticamente se non indicato, es. "2026/2027" ->
 * "2027/2028"). Nessuna squadra resta attivata nella nuova stagione:
 * il presidente le riattiva una per una da Gestione società.
 */
export async function chiudiEApriNuovaStagioneSocieta(societaId: string, nomeNuova?: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc("chiudi_e_apri_nuova_stagione_societa", {
    p_societa_id: societaId,
    p_nome_nuova: nomeNuova ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Il presidente conferma una squadra per la stagione corrente: da qui in poi allenatore/vice/atleti possono operare. */
export async function attivaSquadraInStagione(teamId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("attiva_squadra_in_stagione", { p_team_id: teamId });
  if (error) throw error;
}

/** Annulla l'attivazione di una squadra per la stagione corrente (correggere un tap dato per errore). */
export async function disattivaSquadraInStagione(teamId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("disattiva_squadra_in_stagione", { p_team_id: teamId });
  if (error) throw error;
}

/** Sposta un atleta (con tutto il suo storico) in un'altra squadra della stessa società — solo nella finestra di passaggio tra stagioni. */
export async function spostaAtletaSquadra(athleteId: string, teamIdNuovo: string): Promise<void> {
  const { error } = await supabaseClient.rpc("sposta_atleta_squadra", { p_athlete_id: athleteId, p_team_id_nuovo: teamIdNuovo });
  if (error) throw error;
}

/** Genera la baseline per una squadra in una stagione; ritorna quante righe ha creato. */
export async function generaBaselineStagione(teamId: string, seasonId: string): Promise<number> {
  const { data, error } = await supabaseClient.rpc("genera_baseline_stagione", { p_team_id: teamId, p_season_id: seasonId });
  if (error) throw error;
  return data ?? 0;
}

export async function elencaBaselineStagione(seasonId: string): Promise<SeasonBaseline[]> {
  const { data, error } = await supabaseClient.from("season_baselines").select("*").eq("season_id", seasonId);
  if (error) throw error;
  return data ?? [];
}
