import { supabaseClient } from "@/src/lib/supabase";
import type { Ruolo } from "@/src/types/database";

export interface MembroTeam {
  user_id: string;
  email: string;
  ruolo: Ruolo;
  atleta_id: string | null;
  atleta_nome: string | null;
  puo_scoutare: boolean;
}

/** Ruoli a cui si può aggiungere il permesso scout: chi registra le azioni sta in panchina con l'allenatore. */
export const RUOLI_CON_SCOUT: Ruolo[] = ["allenatore", "vice_allenatore"];

export async function elencaMembri(teamId: string): Promise<MembroTeam[]> {
  const { data, error } = await supabaseClient.rpc("elenca_membri_team", { p_team_id: teamId });
  if (error) throw error;
  return data ?? [];
}

/** Cambia il profilo di un membro già iscritto: serve soprattutto per assegnare o revocare "scout" senza rimuoverlo e reinvitarlo. */
export async function cambiaRuoloMembro(teamId: string, userId: string, nuovoRuolo: Ruolo, atletaId?: string | null): Promise<void> {
  const { error } = await supabaseClient.rpc("cambia_ruolo_membro", {
    p_team_id: teamId, p_user_id: userId, p_nuovo_ruolo: nuovoRuolo, p_atleta_id: atletaId ?? null,
  });
  if (error) throw error;
}

export async function rimuoviMembro(teamId: string, userId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("rimuovi_membro", { p_team_id: teamId, p_user_id: userId });
  if (error) throw error;
}

/** Concede o revoca il permesso di registrare lo scouting. Non assegnabile ad atleti né al presidente. */
export async function impostaPermessoScout(teamId: string, userId: string, abilitato: boolean): Promise<void> {
  const { error } = await supabaseClient.rpc("imposta_permesso_scout", {
    p_team_id: teamId, p_user_id: userId, p_abilitato: abilitato,
  });
  if (error) throw error;
}
