import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";

/** Scout senza account: si entra aprendo un QR/link con un codice segreto per partita. */

export interface ScoutAnonimo {
  id: string;
  nome: string;
  escluso: boolean;
  creato_il: string;
  ha_turno: boolean;
}

export interface TurnoScout {
  occupato: boolean;
  nome: string | null;
  mio: boolean;
}

/** Indirizzo da aprire (e da mettere nel QR) per un codice. */
export function linkScout(token: string): string {
  const base = (cfg.authRedirectUrl || "").replace(/\/+$/, "");
  return `${base}/scout/${token}`;
}

export async function ottieniCodiceScout(matchId: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc("scout_qr_ottieni", { p_match_id: matchId });
  if (error) throw error;
  return data as string;
}

export async function cambiaCodiceScout(matchId: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc("scout_qr_ruota", { p_match_id: matchId });
  if (error) throw error;
  return data as string;
}

/** Chi ha aperto il QR (con accesso anonimo) si aggancia alla partita con il suo nome; ritorna la partita. */
export async function agganciaScoutQr(token: string, nome: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc("scout_qr_aggancia", { p_token: token, p_nome: nome });
  if (error) throw error;
  return data as string;
}

export async function elencaScoutAnonimi(matchId: string): Promise<ScoutAnonimo[]> {
  const { data, error } = await supabaseClient.rpc("scout_anonimi_elenco", { p_match_id: matchId });
  if (error) throw error;
  return (data ?? []) as ScoutAnonimo[];
}

export async function escludiScoutAnonimo(id: string, escluso: boolean): Promise<void> {
  const { error } = await supabaseClient.rpc("scout_anonimo_escludi", { p_id: id, p_escluso: escluso });
  if (error) throw error;
}

export async function statoTurnoScout(matchId: string): Promise<TurnoScout> {
  const { data, error } = await supabaseClient.rpc("scout_turno_stato", { p_match_id: matchId });
  if (error) throw error;
  return data as TurnoScout;
}

/** Prende il turno di scouting; con `forza` subentra a chi lo ha adesso. Errore "Turno occupato" se non si forza. */
export async function prendiTurnoScout(matchId: string, forza = false): Promise<void> {
  const { error } = await supabaseClient.rpc("scout_turno_prendi", { p_match_id: matchId, p_forza: forza });
  if (error) throw error;
}

/** Segnale di presenza: true = hai ancora il turno. */
export async function battitoTurnoScout(matchId: string): Promise<boolean> {
  const { data, error } = await supabaseClient.rpc("scout_turno_battito", { p_match_id: matchId });
  if (error) throw error;
  return !!data;
}

/** Chi ha il turno lo lascia; lo staff libera il turno di chiunque. */
export async function rilasciaTurnoScout(matchId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("scout_turno_rilascia", { p_match_id: matchId });
  if (error) throw error;
}
