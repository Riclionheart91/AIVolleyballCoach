import { supabaseClient } from "@/src/lib/supabase";

export interface MiaSocieta { societa_id: string; nome: string }

/** Se si è presidente di una società, la restituisce — anche prima di avere una squadra. */
export async function miaSocietaPresidenza(): Promise<MiaSocieta | null> {
  const { data, error } = await supabaseClient.rpc("mia_societa_presidenza");
  if (error) throw error;
  return (data && data.length > 0) ? data[0] : null;
}

export interface SquadraSocieta {
  team_id: string;
  nome: string;
  numero_membri: number;
  allenatore_email: string | null;
  stagione_attiva: string | null;
  /** Questa squadra è stata confermata dal presidente per la stagione attiva della società. */
  squadra_attivata: boolean;
}

export async function elencaSquadreSocieta(societaId: string): Promise<SquadraSocieta[]> {
  const { data, error } = await supabaseClient.rpc("elenca_squadre_societa", { p_societa_id: societaId });
  if (error) throw error;
  return data ?? [];
}

/** Crea una nuova squadra nella società: chi la crea ne diventa allenatore di default, riassegnabile subito dopo. */
export async function creaSquadraInSocieta(nome: string, societaId: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc("crea_squadra_in_societa", { p_nome: nome, p_societa_id: societaId });
  if (error) throw error;
  return data as string;
}

/** Invita per email chi diventerà allenatore di questa squadra della società. */
export async function assegnaAllenatoreSquadra(teamId: string, email: string): Promise<void> {
  const { error } = await supabaseClient.rpc("assegna_allenatore_squadra", { p_team_id: teamId, p_email: email });
  if (error) throw error;
}

export interface Societa { id: string; nome: string; creato_il: string }

/** Solo per l'amministratore della piattaforma: elenca tutte le società esistenti. */
export async function elencaSocieta(): Promise<Societa[]> {
  const { data, error } = await supabaseClient.from("societa").select("id, nome, creato_il").order("creato_il", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Solo per l'amministratore della piattaforma: fonda una nuova società e
 * ne nomina il presidente indicandone l'email. Se la persona ha già un
 * account diventa presidente subito, altrimenti l'invito resta in
 * sospeso e si applica da solo al suo primo accesso.
 */
export async function creaSocieta(nome: string, emailPresidente: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc("crea_societa_con_presidente", { p_nome: nome, p_email_presidente: emailPresidente });
  if (error) throw error;
  return data as string;
}
