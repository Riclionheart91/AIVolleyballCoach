import { supabaseClient } from "@/src/lib/supabase";
import { assegnazioniValide, chiaveSchema, type Assegnazioni, type FaseSchema } from "@/src/lib/schemiGioco";

/** Tutti gli schemi salvati dalla squadra, con chiave "fase:rotazione". Quelli non salvati usano le posizioni di rotazione. */
export async function elencaSchemiGioco(teamId: string): Promise<Record<string, Assegnazioni>> {
  const { data, error } = await supabaseClient
    .from("schemi_gioco")
    .select("fase, variante, rotazione, assegnazioni")
    .eq("team_id", teamId);
  if (error) throw error;
  const risultato: Record<string, Assegnazioni> = {};
  for (const r of (data ?? []) as { fase: FaseSchema; variante: number; rotazione: number; assegnazioni: unknown }[]) {
    if (assegnazioniValide(r.assegnazioni)) risultato[chiaveSchema(r.fase, r.variante, r.rotazione)] = r.assegnazioni;
  }
  return risultato;
}

export async function salvaSchemaGioco(teamId: string, fase: FaseSchema, variante: number, rotazione: number, assegnazioni: Assegnazioni): Promise<void> {
  const { error } = await supabaseClient.rpc("salva_schema_gioco", {
    p_team_id: teamId, p_fase: fase, p_variante: variante, p_rotazione: rotazione, p_assegnazioni: assegnazioni,
  });
  if (error) throw error;
}

export async function ripristinaSchemaGioco(teamId: string, fase: FaseSchema, variante: number, rotazione: number): Promise<void> {
  const { error } = await supabaseClient.rpc("ripristina_schema_gioco", { p_team_id: teamId, p_fase: fase, p_variante: variante, p_rotazione: rotazione });
  if (error) throw error;
}
