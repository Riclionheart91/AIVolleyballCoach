import { supabaseClient } from "@/src/lib/supabase";
import type { Exercise } from "@/src/types/database";

export async function elencaEsercizi(teamId: string): Promise<Exercise[]> {
  const { data, error } = await supabaseClient.from("exercises").select("*").eq("team_id", teamId).order("nome");
  if (error) throw error;
  return data ?? [];
}

export async function creaEsercizio(teamId: string, input: Pick<Exercise, "nome" | "categoria" | "descrizione">): Promise<Exercise> {
  const { data, error } = await supabaseClient.from("exercises").insert({ team_id: teamId, ...input }).select().single();
  if (error) throw error;
  return data;
}

export async function leggiEsercizio(id: string): Promise<Exercise> {
  const { data, error } = await supabaseClient.from("exercises").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function aggiornaEsercizio(id: string, input: Partial<Pick<Exercise, "nome" | "categoria" | "descrizione">>): Promise<Exercise> {
  const { data, error } = await supabaseClient.from("exercises").update(input).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function eliminaEsercizio(id: string): Promise<void> {
  const { error } = await supabaseClient.from("exercises").delete().eq("id", id);
  if (error) throw error;
}
