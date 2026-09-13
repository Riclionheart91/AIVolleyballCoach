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

export async function aggiornaAllenamento(id: string, input: Partial<Pick<Training, "data" | "titolo" | "note">>): Promise<Training> {
  const { data, error } = await supabaseClient.from("trainings").update(input).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function eliminaAllenamento(id: string): Promise<void> {
  const { error } = await supabaseClient.from("trainings").delete().eq("id", id);
  if (error) throw error;
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

export interface StoricoPresenzaRiga {
  training_id: string;
  titolo: string;
  data: string;
  presente: boolean | null;
  rpe: number | null;
}

/** Storico personale (per l'atleta): la RLS restituisce solo le proprie righe, mai quelle delle compagne — nessun filtro aggiuntivo necessario qui. */
export async function elencaMioStoricoPresenze(athleteId: string, limite = 20): Promise<StoricoPresenzaRiga[]> {
  const [{ data: presenze, error: e1 }, { data: rpeRighe, error: e2 }] = await Promise.all([
    supabaseClient.from("attendance").select("training_id, presente, trainings(titolo, data)").eq("athlete_id", athleteId).order("registrato_il", { ascending: false }).limit(limite),
    supabaseClient.from("rpe").select("training_id, valore").eq("athlete_id", athleteId),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const mappaRpe = Object.fromEntries((rpeRighe ?? []).map((r) => [r.training_id, r.valore]));
  return (presenze ?? []).map((p) => ({
    training_id: p.training_id,
    titolo: (p.trainings as unknown as { titolo: string; data: string })?.titolo ?? "Allenamento",
    data: (p.trainings as unknown as { titolo: string; data: string })?.data ?? "",
    presente: p.presente,
    rpe: mappaRpe[p.training_id] ?? null,
  }));
}

export type { Athlete };

/** Correzione manuale quando la classificazione automatica da SportEasy sbaglia: trasforma un allenamento in partita, portandosi dietro l'identificativo SportEasy. */
export async function convertiAllenamentoInPartita(trainingId: string, avversario?: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc("converti_allenamento_in_partita", { p_training_id: trainingId, p_avversario: avversario ?? null });
  if (error) throw error;
  return data as string;
}
