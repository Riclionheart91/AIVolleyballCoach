import { supabaseClient } from "@/src/lib/supabase";
import type { Campionato } from "@/src/types/database";

export async function elencaCampionati(teamId: string): Promise<Campionato[]> {
  const { data, error } = await supabaseClient.from("campionati").select("*").eq("team_id", teamId).eq("attivo", true).order("nome");
  if (error) throw error;
  return data ?? [];
}

export type InputCampionato = Pick<Campionato, "nome" | "federazione" | "punti_per_set" | "punti_set_decisivo" | "numero_liberi_max" | "numero_sostituzioni_max_per_set" | "numero_maglia_max" | "distinta_min_giocatrici" | "distinta_max_giocatrici"> & Partial<Pick<Campionato, "data_inizio" | "data_fine">>;

export const DEFAULT_CAMPIONATO: InputCampionato = {
  nome: "", federazione: "FIPAV", punti_per_set: 25, punti_set_decisivo: 15,
  numero_liberi_max: 2, numero_sostituzioni_max_per_set: 6, numero_maglia_max: 99,
  distinta_min_giocatrici: 6, distinta_max_giocatrici: 14, data_inizio: null, data_fine: null,
};

export async function creaCampionato(teamId: string, input: InputCampionato): Promise<Campionato> {
  const { data, error } = await supabaseClient.from("campionati").insert({ team_id: teamId, ...input }).select().single();
  if (error) throw error;
  return data;
}

export async function aggiornaCampionato(id: string, input: Partial<InputCampionato>): Promise<Campionato> {
  const { data, error } = await supabaseClient.from("campionati").update(input).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

/** Riassegna manualmente il campionato di una partita già esistente (sincronizzata o creata a mano) — sempre modificabile, come richiesto. */
export async function riassegnaCampionatoPartita(matchId: string, campionatoId: string | null): Promise<void> {
  const { error } = await supabaseClient.from("matches").update({ campionato_id: campionatoId, tipo_gara: campionatoId ? "campionato" : "amichevole" }).eq("id", matchId);
  if (error) throw error;
}

export async function disattivaCampionato(id: string): Promise<void> {
  const { error } = await supabaseClient.from("campionati").update({ attivo: false }).eq("id", id);
  if (error) throw error;
}
