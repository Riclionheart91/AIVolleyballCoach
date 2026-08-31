import { supabaseClient } from "@/src/lib/supabase";
import type { Athlete, RuoloCampo } from "@/src/types/database";

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

export interface InputAtleta {
  nome: string;
  cognome: string;
  numero_maglia: number | null;
  data_nascita: string | null;
  ruolo_campo: RuoloCampo | null;
  codice_fiscale?: string | null;
}

export async function creaAtleta(teamId: string, input: InputAtleta): Promise<Athlete> {
  const { data, error } = await supabaseClient.from("athletes").insert({ team_id: teamId, ...input }).select().single();
  if (error) throw error;
  return data;
}

/** Solo allenatore/vice: modifica i campi "assegnati dalla società" (mai i contatti, quelli li tocca solo l'atleta con aggiornaMioContatto). */
export async function aggiornaAtleta(atletaId: string, input: Partial<InputAtleta>): Promise<Athlete> {
  const { data, error } = await supabaseClient.from("athletes").update(input).eq("id", atletaId).select().single();
  if (error) throw error;
  return data;
}

export async function archiviaAtleta(atletaId: string): Promise<void> {
  const { error } = await supabaseClient.from("athletes").update({ status: "archiviata" }).eq("id", atletaId);
  if (error) throw error;
}

/** L'atleta aggiorna solo i propri dati di contatto — mai ruolo_campo/numero_maglia/status, che restano decisioni dell'allenatore (RPC lato server lo impone comunque, questo è solo il wrapper client). */
export async function aggiornaMioContatto(teamId: string, telefono: string, emailContatto: string, notePersonali: string): Promise<void> {
  const { error } = await supabaseClient.rpc("aggiorna_mio_contatto", {
    p_team_id: teamId,
    p_telefono: telefono,
    p_email_contatto: emailContatto,
    p_note_personali: notePersonali,
  });
  if (error) throw error;
}
