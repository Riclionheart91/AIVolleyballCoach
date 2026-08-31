import { supabaseClient } from "@/src/lib/supabase";

export interface AiProviderConfig {
  id: string;
  team_id: string | null;
  provider_code: "GEMINI" | "GROQ" | "OPENROUTER";
  enabled: boolean;
  priority: number;
  modello: string | null;
}

export async function elencaProvider(teamId: string | null): Promise<AiProviderConfig[]> {
  let query = supabaseClient.from("ai_providers_config").select("*").order("priority");
  query = teamId ? query.eq("team_id", teamId) : query.is("team_id", null);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/** team_id null = default globale (solo superuser può scriverci, vedi RLS); altrimenti override della squadra (coach). Select-poi-insert/update esplicito invece di upsert: gli indici parziali usati per gestire correttamente i team_id nulli non sono affidabili con l'inferenza automatica del conflitto lato client. */
export async function salvaProvider(config: Pick<AiProviderConfig, "team_id" | "provider_code" | "enabled" | "priority" | "modello">): Promise<void> {
  let query = supabaseClient.from("ai_providers_config").select("id").eq("provider_code", config.provider_code);
  query = config.team_id ? query.eq("team_id", config.team_id) : query.is("team_id", null);
  const { data: esistente, error: erroreLettura } = await query.maybeSingle();
  if (erroreLettura) throw erroreLettura;

  if (esistente) {
    const { error } = await supabaseClient.from("ai_providers_config").update(config).eq("id", esistente.id);
    if (error) throw error;
  } else {
    const { error } = await supabaseClient.from("ai_providers_config").insert(config);
    if (error) throw error;
  }
}
