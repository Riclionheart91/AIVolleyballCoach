import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";
import type { Ruolo } from "@/src/types/database";

export interface TeamInvite {
  id: string;
  team_id: string;
  email: string;
  ruolo: Ruolo;
  atleta_id: string | null;
  creato_il: string;
  usato_il: string | null;
}

export async function invitaMembro(teamId: string, email: string, ruolo: Ruolo, atletaId: string | null = null): Promise<void> {
  const { error } = await supabaseClient.rpc("invita_membro", { p_team_id: teamId, p_email: email, p_ruolo: ruolo, p_atleta_id: atletaId });
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

/**
 * Inviti dello staff (allenatore, vice) con un link personale: monouso, valido 7 giorni.
 * Chi lo apre accede con il suo account Google (qualunque email) ed entra in squadra con quel ruolo.
 */
export type RuoloStaff = "allenatore" | "vice_allenatore";

export interface InvitoLink {
  id: string;
  team_id: string;
  ruolo: RuoloStaff;
  token: string;
  creato_il: string;
  scade_il: string;
}

/** Dove l'app ricorda il link aperto mentre la persona fa il giro dell'accesso con Google. */
export const CHIAVE_INVITO_LINK = "aivolleyballcoach:invito_link_token";

export function linkInvito(token: string): string {
  const base = (cfg.authRedirectUrl || "").replace(/\/+$/, "");
  return `${base}/invito/${token}`;
}

export async function creaInvitoLink(teamId: string, ruolo: RuoloStaff): Promise<string> {
  const { data, error } = await supabaseClient.rpc("crea_invito_link", { p_team_id: teamId, p_ruolo: ruolo });
  if (error) throw error;
  return data as string;
}

export async function elencaInvitiLink(teamId: string): Promise<InvitoLink[]> {
  const { data, error } = await supabaseClient
    .from("team_invite_links")
    .select("id, team_id, ruolo, token, creato_il, scade_il")
    .eq("team_id", teamId)
    .is("usato_il", null)
    .gt("scade_il", new Date().toISOString())
    .order("creato_il", { ascending: false });
  if (error) throw error;
  return (data ?? []) as InvitoLink[];
}

export async function annullaInvitoLink(id: string): Promise<void> {
  const { error } = await supabaseClient.rpc("annulla_invito_link", { p_id: id });
  if (error) throw error;
}

/** Per la pagina d'ingresso, anche prima di accedere: squadra e ruolo, solo se il link e' ancora valido. */
export async function anteprimaInvitoLink(token: string): Promise<{ team_nome: string; ruolo: RuoloStaff } | null> {
  const { data, error } = await supabaseClient.rpc("anteprima_invito_link", { p_token: token });
  if (error) throw error;
  const riga = (data as { team_nome: string; ruolo: RuoloStaff }[] | null)?.[0];
  return riga ?? null;
}

/** Ritorna la squadra in cui si e' entrati; lancia un errore leggibile se il link non e' valido, e' scaduto o gia' usato. */
export async function accettaInvitoLink(token: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc("accetta_invito_link", { p_token: token });
  if (error) throw error;
  return data as string;
}
