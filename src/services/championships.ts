import { supabaseClient } from "@/src/lib/supabase";
import type { Campionato } from "@/src/types/database";

export async function elencaCampionati(teamId: string): Promise<Campionato[]> {
  const { data, error } = await supabaseClient.from("campionati").select("*").eq("team_id", teamId).eq("attivo", true).order("nome");
  if (error) throw error;
  return data ?? [];
}

export type InputCampionato = Pick<Campionato, "nome" | "federazione" | "punti_per_set" | "punti_set_decisivo" | "numero_liberi_max" | "numero_sostituzioni_max_per_set" | "numero_maglia_max" | "distinta_min_giocatrici" | "distinta_max_giocatrici">;

export const DEFAULT_CAMPIONATO: InputCampionato = {
  nome: "", federazione: "FIPAV", punti_per_set: 25, punti_set_decisivo: 15,
  numero_liberi_max: 2, numero_sostituzioni_max_per_set: 6, numero_maglia_max: 99,
  distinta_min_giocatrici: 6, distinta_max_giocatrici: 14,
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

export async function disattivaCampionato(id: string): Promise<void> {
  const { error } = await supabaseClient.from("campionati").update({ attivo: false }).eq("id", id);
  if (error) throw error;
}
