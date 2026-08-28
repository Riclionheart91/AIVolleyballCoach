import { supabaseClient } from "@/src/lib/supabase";
import type { Athlete, Attendance, Rpe, Training, TrainingExercise } from "@/src/types/database";

export async function elencaAllenamenti(teamId: string): Promise<Training[]> {
  const { data, error } = await supabaseClient.from("trainings").select("*").eq("team_id", teamId).order("data", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function creaAllenamento(teamId: string, input: Pick<Training, "data" | "titolo" | "note">): Promise<Training> {
  const { data, error } = await supabaseClient.from("trainings").insert({ team_id: teamId, ...input }).select().single();
  if (error) throw error;
  return data;
}

export async function elencaEserciziAllenamento(trainingId: string): Promise<TrainingExercise[]> {
  const { data, error } = await supabaseClient
    .from("training_exercises")
    .select("*")
    .eq("training_id", trainingId)
    .order("ordine");
  if (error) throw error;
  return data ?? [];
}

export async function aggiungiEsercizioAllenamento(input: Omit<TrainingExercise, "id">): Promise<TrainingExercise> {
  const { data, error } = await supabaseClient.from("training_exercises").insert(input).select().single();
  if (error) throw error;
  return data;
}

/** Presenze: una riga per atleta per allenamento (upsert, come nel foglio Presenze originale). */
export async function registraPresenza(trainingId: string, athleteId: string, presente: boolean, motivoAssenza = ""): Promise<void> {
  const { error } = await supabaseClient
    .from("attendance")
    .upsert({ training_id: trainingId, athlete_id: athleteId, presente, motivo_assenza: motivoAssenza }, { onConflict: "training_id,athlete_id" });
  if (error) throw error;
}

export async function elencaPresenzeAllenamento(trainingId: string): Promise<Attendance[]> {
  const { data, error } = await supabaseClient.from("attendance").select("*").eq("training_id", trainingId);
  if (error) throw error;
  return data ?? [];
}

export async function registraRpe(trainingId: string, athleteId: string, valore: number): Promise<void> {
  const { error } = await supabaseClient
    .from("rpe")
    .upsert({ training_id: trainingId, athlete_id: athleteId, valore }, { onConflict: "training_id,athlete_id" });
  if (error) throw error;
}

export async function elencaRpeAllenamento(trainingId: string): Promise<Rpe[]> {
  const { data, error } = await supabaseClient.from("rpe").select("*").eq("training_id", trainingId);
  if (error) throw error;
  return data ?? [];
}

export type { Athlete };
