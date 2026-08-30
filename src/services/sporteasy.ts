import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";
import type { TeamIntegration } from "@/src/types/database";

export async function leggiIntegrazione(teamId: string): Promise<TeamIntegration | null> {
  const { data, error } = await supabaseClient.from("team_integrations").select("*").eq("team_id", teamId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function impostaLinkSporteasy(teamId: string, url: string): Promise<void> {
  const { error } = await supabaseClient.rpc("imposta_integrazione_sporteasy", { p_team_id: teamId, p_ical_url: url });
  if (error) throw error;
}

export interface RisultatoSincronizzazione {
  errore: boolean;
  messaggio?: string;
  allenamentiCreati?: number;
  allenamentiAggiornati?: number;
  partiteCreate?: number;
  partiteAggiornate?: number;
  totaleEventiNelCalendario?: number;
}

export async function sincronizzaSporteasy(teamId: string): Promise<RisultatoSincronizzazione> {
  const { data, error } = await supabaseClient.functions.invoke(cfg.sporteasySyncFunction, { body: { team_id: teamId } });
  if (error) return { errore: true, messaggio: error.message };
  return data as RisultatoSincronizzazione;
}
