import { supabaseClient } from "@/src/lib/supabase";

export type SquadraGlobale = "A" | "B";
export type EsitoGlobale = "punto" | "errore";

export interface Globale {
  id: string;
  team_id: string;
  training_id: string | null;
  nome_a: string;
  nome_b: string;
  punti_a: number;
  punti_b: number;
  squadra_al_servizio: SquadraGlobale;
  stato: "in_corso" | "concluso";
  iniziato_il: string;
  concluso_il: string | null;
}

export interface FormazioneGlobale {
  id: string;
  globale_id: string;
  squadra: SquadraGlobale;
  athlete_id: string;
  posizione: number | null;
  in_campo: boolean;
}

export interface EventoGlobale {
  id: string;
  globale_id: string;
  squadra: SquadraGlobale;
  athlete_id: string | null;
  fondamentale: string;
  esito: EsitoGlobale;
  creato_il: string;
}

export interface RendimentoRotazione {
  squadra: string;
  rotazione_di: string;
  punti_fatti: number;
  errori_commessi: number;
  saldo: number;
}

/** Fondamentali in evidenza (modalità essenziale) e set completo. */
export const FONDAMENTALI_ESSENZIALI = ["Servizio", "Ricezione", "Attacco"] as const;
export const FONDAMENTALI_COMPLETI = ["Servizio", "Ricezione", "Attacco", "Muro", "Difesa"] as const;

export async function creaGlobale(teamId: string, trainingId: string | null, nomeA = "Squadra A", nomeB = "Squadra B"): Promise<Globale> {
  const { data, error } = await supabaseClient
    .from("globali")
    .insert({ team_id: teamId, training_id: trainingId, nome_a: nomeA, nome_b: nomeB })
    .select().single();
  if (error) throw error;
  return data;
}

/** Globale ancora aperto per questa seduta, se c'è: evita di crearne due per errore riaprendo la schermata. */
export async function globaleApertoPerAllenamento(trainingId: string): Promise<Globale | null> {
  const { data, error } = await supabaseClient
    .from("globali").select("*")
    .eq("training_id", trainingId).eq("stato", "in_corso")
    .order("iniziato_il", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function elencaGlobaliAllenamento(trainingId: string): Promise<Globale[]> {
  const { data, error } = await supabaseClient
    .from("globali").select("*").eq("training_id", trainingId).order("iniziato_il", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function leggiGlobale(globaleId: string): Promise<Globale | null> {
  const { data, error } = await supabaseClient.from("globali").select("*").eq("id", globaleId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function elencaFormazioni(globaleId: string): Promise<FormazioneGlobale[]> {
  const { data, error } = await supabaseClient.from("globale_formazioni").select("*").eq("globale_id", globaleId);
  if (error) throw error;
  return data ?? [];
}

/** Sostituisce l'intera formazione di una squadra: posizioni[1..6] -> athleteId. */
export async function impostaFormazioneGlobale(globaleId: string, squadra: SquadraGlobale, posizioni: Record<number, string>): Promise<void> {
  const { error: errDel } = await supabaseClient.from("globale_formazioni").delete().eq("globale_id", globaleId).eq("squadra", squadra);
  if (errDel) throw errDel;

  const righe = Object.entries(posizioni).map(([pos, athleteId]) => ({
    globale_id: globaleId, squadra, athlete_id: athleteId, posizione: Number(pos), in_campo: true,
  }));
  if (righe.length === 0) return;
  const { error } = await supabaseClient.from("globale_formazioni").insert(righe);
  if (error) throw error;
}

export async function registraEventoGlobale(globaleId: string, squadra: SquadraGlobale, athleteId: string, fondamentale: string, esito: EsitoGlobale): Promise<void> {
  const { error } = await supabaseClient.rpc("registra_evento_globale", {
    p_globale_id: globaleId, p_squadra: squadra, p_athlete_id: athleteId, p_fondamentale: fondamentale, p_esito: esito,
  });
  if (error) throw error;
}

export async function annullaUltimoEventoGlobale(globaleId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("annulla_ultimo_evento_globale", { p_globale_id: globaleId });
  if (error) throw error;
}

export async function elencaEventiGlobale(globaleId: string, limite = 15): Promise<EventoGlobale[]> {
  const { data, error } = await supabaseClient
    .from("globale_eventi").select("*").eq("globale_id", globaleId)
    .order("creato_il", { ascending: false }).limit(limite);
  if (error) throw error;
  return data ?? [];
}

export async function rendimentoRotazioni(globaleId: string): Promise<RendimentoRotazione[]> {
  const { data, error } = await supabaseClient.rpc("rendimento_rotazioni_globale", { p_globale_id: globaleId });
  if (error) throw error;
  return data ?? [];
}

/** Chiude il globale e genera le proposte di valutazione (una per atleta/fondamentale con almeno 3 azioni). Restituisce quante ne ha create. */
export async function chiudiGlobale(globaleId: string, generaProposte = true): Promise<number> {
  const { data, error } = await supabaseClient.rpc("chiudi_globale", { p_globale_id: globaleId, p_genera_proposte: generaProposte });
  if (error) throw error;
  return (data as number) ?? 0;
}
