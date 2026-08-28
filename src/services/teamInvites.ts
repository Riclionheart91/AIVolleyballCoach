import { supabaseClient } from "@/src/lib/supabase";
import type { Ruolo } from "@/src/types/database";

export interface TeamInvite {
  id: string;
  team_id: string;
  email: string;
  ruolo: Ruolo;
  creato_il: string;
  usato_il: string | null;
}

export async function invitaMembro(teamId: string, email: string, ruolo: Ruolo): Promise<void> {
  const { error } = await supabaseClient.rpc("invita_membro", { p_team_id: teamId, p_email: email, p_ruolo: ruolo });
  if (error) throw error;
}

export async function elencaInvitiPendenti(teamId: string): Promise<TeamInvite[]> {
  const { data, error } = await supabaseClient
    .from("team_invites")
    .select("*")
    .eq("team_id", teamId)
    .is("usato_il", null)
    .order("creato_il", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function annullaInvito(inviteId: string): Promise<void> {
  const { error } = await supabaseClient.from("team_invites").delete().eq("id", inviteId);
  if (error) throw error;
}

/** Da chiamare subito dopo il login: se l'email ha un invito pendente, entra automaticamente nel team. Ritorna il team_id se è entrato, altrimenti null. */
export async function accettaInvitiPendenti(): Promise<string | null> {
  const { data, error } = await supabaseClient.rpc("accetta_inviti_pendenti");
  if (error) { console.warn("Errore nell'accettazione inviti:", error.message); return null; }
  return data ?? null;
}
