import { supabaseClient } from "@/src/lib/supabase";
import { normalizzaAssegnazioni, chiaveSchema, type Assegnazioni, type FaseSchema } from "@/src/lib/schemiGioco";

/**
 * Schemi in vigore per la squadra: i suoi, piu' quelli STANDARD dove la squadra non ha
 * il proprio. `standard` dice quali chiavi vengono dallo standard (non personalizzate).
 */
export async function elencaSchemiGiocoConOrigine(teamId: string): Promise<{ schemi: Record<string, Assegnazioni>; standard: Record<string, boolean> }> {
  const { data, error } = await supabaseClient.rpc("schemi_gioco_efficaci", { p_team_id: teamId });
  if (error) throw error;
  const schemi: Record<string, Assegnazioni> = {};
  const standard: Record<string, boolean> = {};
  for (const r of (data ?? []) as { fase: FaseSchema; variante: number; rotazione: number; assegnazioni: unknown; standard: boolean }[]) {
    const a = normalizzaAssegnazioni(r.assegnazioni);
    if (!a) continue;
    const k = chiaveSchema(r.fase, r.variante, r.rotazione);
    schemi[k] = a;
    if (r.standard) standard[k] = true;
  }
  return { schemi, standard };
}

/** Tutti gli schemi in vigore (della squadra o standard), con chiave "fase:variante:rotazione". */
export async function elencaSchemiGioco(teamId: string): Promise<Record<string, Assegnazioni>> {
  return (await elencaSchemiGiocoConOrigine(teamId)).schemi;
}

/** Solo superuser: gli schemi di questa squadra diventano lo standard per tutte. Ritorna quanti schemi sono stati copiati. */
export async function impostaSchemiStandardDaSquadra(teamId: string): Promise<number> {
  const { data, error } = await supabaseClient.rpc("imposta_schemi_standard_da_squadra", { p_team_id: teamId });
  if (error) throw error;
  return Number(data ?? 0);
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
