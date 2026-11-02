import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";

/**
 * Accesso con email e password, con link personale mandato su WhatsApp.
 * L'email di accesso e' quella dell'anagrafica: viene dal link, non dalla persona.
 * Le funzioni del database sono nella migrazione 0093; l'attivazione e' la edge function `attiva-accesso`.
 */

export type MetodoAccesso = "google" | "password";
export type RuoloAccesso = "atleta" | "allenatore" | "vice_allenatore";
export type TipoLinkAccesso = "invito" | "reset";

export interface LinkAccessoCreato {
  /** Nullo se il metodo e' Google: in quel caso non serve nessun link. */
  token: string | null;
  metodo: MetodoAccesso;
  email: string;
}

export interface AnteprimaLinkAccesso {
  team_nome: string;
  ruolo: RuoloAccesso;
  /** Vuota solo per lo staff invitato senza email: in quel caso la sceglie la persona. */
  email: string | null;
  nome: string | null;
  tipo: TipoLinkAccesso;
  email_libera: boolean;
}

export interface RichiestaReset {
  id: string;
  ambito: "atleta" | "staff";
  nome: string;
  email: string;
  atleta_id: string | null;
  creata_il: string;
  telefono: string | null;
}

export interface ResetConfermato {
  token: string | null;
  metodo: MetodoAccesso;
  email: string;
  nome: string;
  telefono: string | null;
  squadra: string;
}

export interface EsitoAttivazione {
  ok: true;
  email: string;
  team_id: string;
}

/** Messaggio che la edge function manda quando l'email e' di un account Google. */
export const ERRORE_USA_GOOGLE = "usa_google";

/** Le funzioni "returns table" arrivano come elenco, quelle "returns json" come oggetto: qui si legge in entrambi i casi. */
function prima<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return (data as T | null) ?? null;
}

export function linkAccesso(token: string): string {
  const base = (cfg.authRedirectUrl || "").replace(/\/+$/, "");
  return `${base}/accesso/${token}`;
}

export async function metodoAccessoPerEmail(email: string): Promise<MetodoAccesso> {
  const { data, error } = await supabaseClient.rpc("metodo_accesso_per_email", { p_email: email.trim().toLowerCase() });
  if (error) throw error;
  return (data as string) === "google" ? "google" : "password";
}

/** Con `metodo` si forza la scelta fatta a mano; senza, decide il database (account esistente, poi dominio). */
export async function creaLinkAccessoAtleta(atletaId: string, metodo?: MetodoAccesso): Promise<LinkAccessoCreato> {
  const { data, error } = await supabaseClient.rpc("crea_link_accesso_atleta", { p_atleta_id: atletaId, p_metodo: metodo ?? null });
  if (error) throw error;
  const riga = prima<LinkAccessoCreato>(data);
  if (!riga) throw new Error("Link non creato");
  return riga;
}

/** Con email vuota la sceglie la persona quando attiva l'accesso. */
export async function creaLinkAccessoStaff(teamId: string, ruolo: "allenatore" | "vice_allenatore", email?: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc("crea_link_accesso_staff", {
    p_team_id: teamId,
    p_ruolo: ruolo,
    p_email: email?.trim() ? email.trim().toLowerCase() : null,
  });
  if (error) throw error;
  return data as string;
}

/** Per la pagina del link, anche prima di accedere: solo se il link e' ancora valido. */
export async function anteprimaLinkAccesso(token: string): Promise<AnteprimaLinkAccesso | null> {
  const { data, error } = await supabaseClient.rpc("anteprima_link_accesso", { p_token: token });
  if (error) throw error;
  return prima<AnteprimaLinkAccesso>(data);
}

/** Chiede alla edge function di creare o aggiornare l'account e di collegarlo alla squadra. Lancia un errore leggibile. */
export async function attivaAccesso(token: string, password: string, email?: string): Promise<EsitoAttivazione> {
  const { data, error } = await supabaseClient.functions.invoke("attiva-accesso", {
    body: { token, password, ...(email ? { email: email.trim().toLowerCase() } : {}) },
  });
  if (error) {
    let messaggio = error.message;
    const risposta = (error as { context?: Response }).context;
    if (risposta && typeof risposta.json === "function") {
      try {
        const corpo = (await risposta.json()) as { errore?: string; messaggio?: string };
        messaggio = corpo.messaggio ?? corpo.errore ?? messaggio;
      } catch { /* resta il messaggio generico */ }
    }
    throw new Error(messaggio);
  }
  const esito = data as { ok?: boolean; email?: string; team_id?: string; errore?: string; messaggio?: string } | null;
  if (!esito?.ok || !esito.email || !esito.team_id) throw new Error(esito?.messaggio ?? esito?.errore ?? "Attivazione non riuscita");
  return { ok: true, email: esito.email, team_id: esito.team_id };
}

/** Chiamabile senza accesso. Non dice mai se l'email esiste: chi la chiama mostra sempre lo stesso messaggio. */
export async function richiediResetAccesso(email: string): Promise<void> {
  const { error } = await supabaseClient.rpc("richiedi_reset_accesso", { p_email: email.trim().toLowerCase() });
  if (error) throw error;
}

export async function elencaRichiesteReset(teamId: string): Promise<RichiestaReset[]> {
  const { data, error } = await supabaseClient.rpc("elenca_richieste_reset", { p_team_id: teamId });
  if (error) throw error;
  return (data ?? []) as RichiestaReset[];
}

/** Conferma la richiesta e crea il nuovo link (se l'account e' Google non c'e' nessun link: `token` e' nullo). */
export async function confermaResetAccesso(richiestaId: string): Promise<ResetConfermato> {
  const { data, error } = await supabaseClient.rpc("conferma_reset_accesso", { p_richiesta_id: richiestaId });
  if (error) throw error;
  const riga = prima<ResetConfermato>(data);
  if (!riga) throw new Error("Richiesta non trovata");
  return riga;
}

export async function rifiutaResetAccesso(richiestaId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("rifiuta_reset_accesso", { p_richiesta_id: richiestaId });
  if (error) throw error;
}
