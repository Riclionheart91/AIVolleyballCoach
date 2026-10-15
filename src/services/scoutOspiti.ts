import { supabaseClient } from "@/src/lib/supabase";
import type { Athlete, Match, MatchEvent, MatchSet, MatchSetLineup } from "@/src/types/database";
import type { LiberoInCampo } from "@/src/services/matches";

/**
 * Scout OSPITE: persona esterna alla squadra, invitata per email su una
 * sola partita. Vede e scouta solo quella partita finche' e' in corso.
 */

export interface ScoutOspite {
  id: string;
  match_id: string;
  email: string;
  creato_il: string;
}

export interface PartitaOspite {
  match_id: string;
  team_nome: string;
  avversario: string;
  data: string | null;
  stato: "programmata" | "in_corso";
}

/** Tutto cio' che l'ospite vede della partita (nessun dato anagrafico oltre a nome, cognome, maglia, ruolo). */
export interface StatoPartitaOspite {
  match: Match;
  team_nome: string;
  set_attivo_id: string | null;
  sets: MatchSet[];
  eventi: MatchEvent[];
  atlete: Athlete[];
  convocati: { athlete_id: string; is_libero: boolean }[];
  formazione: MatchSetLineup[];
  libero: LiberoInCampo | null;
  regole: { puntiPerSet: number; puntiSetDecisivo: number };
}

export async function invitaScoutOspite(matchId: string, email: string): Promise<void> {
  const { error } = await supabaseClient.rpc("invita_scout_ospite", { p_match_id: matchId, p_email: email });
  if (error) throw error;
}

export async function rimuoviScoutOspite(id: string): Promise<void> {
  const { error } = await supabaseClient.rpc("rimuovi_scout_ospite", { p_id: id });
  if (error) throw error;
}

/** Per lo staff: chi e' stato invitato come ospite su questa partita. */
export async function elencaScoutOspiti(matchId: string): Promise<ScoutOspite[]> {
  const { data, error } = await supabaseClient
    .from("scout_ospiti_partita")
    .select("id, match_id, email, creato_il")
    .eq("match_id", matchId)
    .order("creato_il");
  if (error) throw error;
  return (data ?? []) as ScoutOspite[];
}

/** Le partite a cui chi e' collegato e' stato invitato come ospite. In caso di errore: lista vuota (non deve bloccare l'ingresso). */
export async function miePartiteScoutOspite(): Promise<PartitaOspite[]> {
  const { data, error } = await supabaseClient.rpc("mie_partite_scout_ospite");
  if (error) { console.warn("Errore nel leggere le partite da ospite:", error.message); return []; }
  return (data ?? []) as PartitaOspite[];
}

export async function statoPartitaOspite(matchId: string): Promise<StatoPartitaOspite> {
  const { data, error } = await supabaseClient.rpc("scout_ospite_stato_partita", { p_match_id: matchId });
  if (error) throw error;
  return data as unknown as StatoPartitaOspite;
}
