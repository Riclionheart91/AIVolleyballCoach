import { supabaseClient } from "@/src/lib/supabase";
import type { Esito, Match, MatchEvent, MatchSet, Skill } from "@/src/types/database";

export async function elencaPartite(teamId: string): Promise<Match[]> {
  const { data, error } = await supabaseClient.from("matches").select("*").eq("team_id", teamId).order("data", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Crea la partita + il primo set, e la porta subito in stato "in_corso". Ritorna l'id della partita. */
export async function creaMatch(teamId: string, avversario: string, data: string, luogo: "casa" | "trasferta"): Promise<string> {
  const { data: matchId, error } = await supabaseClient.rpc("crea_match", { p_team_id: teamId, p_avversario: avversario, p_data: data, p_luogo: luogo });
  if (error) throw error;
  return matchId as string;
}

/** Per una partita "programmata" (es. arrivata da SportEasy): crea il set 1 e la porta "in_corso". Per una partita già in corso non fa nulla di distruttivo (idempotente). */
export async function avviaMatch(matchId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("avvia_match", { p_match_id: matchId });
  if (error) throw error;
}

export async function elencaSet(matchId: string): Promise<MatchSet[]> {
  const { data, error } = await supabaseClient.from("match_sets").select("*").eq("match_id", matchId).order("numero_set");
  if (error) throw error;
  return data ?? [];
}

export async function nuovoSet(matchId: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc("nuovo_set", { p_match_id: matchId });
  if (error) throw error;
  return data as string;
}

/** Un tap sul fondamentale + un tap sull'esito = una sola chiamata: il punteggio si aggiorna da solo lato database (trigger). */
export async function registraEvento(matchId: string, setId: string, skill: Skill, esito: Esito | null, athleteId: string | null): Promise<string> {
  const { data, error } = await supabaseClient.rpc("registra_evento", { p_match_id: matchId, p_set_id: setId, p_skill: skill, p_esito: esito, p_athlete_id: athleteId });
  if (error) throw error;
  return data as string;
}

/** Elimina l'ultimo evento registrato — il punteggio si corregge da solo (trigger). */
export async function annullaUltimoEvento(matchId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("annulla_ultimo_evento", { p_match_id: matchId });
  if (error) throw error;
}

export async function chiudiMatch(matchId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("chiudi_match", { p_match_id: matchId });
  if (error) throw error;
}

export async function elencaEventiPartita(matchId: string, limite = 20): Promise<MatchEvent[]> {
  const { data, error } = await supabaseClient.from("match_events").select("*").eq("match_id", matchId).order("creato_il", { ascending: false }).limit(limite);
  if (error) throw error;
  return data ?? [];
}

export interface AndamentoSquadraPartiteVoce {
  fondamentale: Skill;
  partita: string;
  avversario: string;
  punti: number;
  errori: number;
}

/** Aggregato tra partite diverse — visibile a tutti i ruoli, mai scomposto per singola atleta. */
export async function andamentoSquadraPartite(teamId: string): Promise<AndamentoSquadraPartiteVoce[]> {
  const { data, error } = await supabaseClient.rpc("andamento_squadra_partite", { p_team_id: teamId });
  if (error) throw error;
  return data ?? [];
}
