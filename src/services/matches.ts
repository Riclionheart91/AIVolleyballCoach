import { supabaseClient } from "@/src/lib/supabase";
import type { Esito, Match, MatchConvocato, MatchEvent, MatchSet, MatchSetLineup, Skill } from "@/src/types/database";

export async function elencaPartite(teamId: string): Promise<Match[]> {
  const { data, error } = await supabaseClient.from("matches").select("*").eq("team_id", teamId).order("data", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Crea SOLO la riga partita, in stato "programmata" — non avvia più
 * nulla in automatico. Il flusso vero è: crea → avviaPreparazione →
 * impostaConvocati → impostaFormazioneIniziale → avviaMatchConfermato
 * (il "pulsante grande"). Fino a quel momento non si può registrare
 * nessun evento di scouting (registra_evento lo verifica lato server).
 */
export async function creaMatch(
  teamId: string, avversario: string, data: string, luogo: "casa" | "trasferta",
  campionatoId: string | null = null, tipoGara: "campionato" | "amichevole" = "amichevole",
): Promise<string> {
  const { data: matchId, error } = await supabaseClient.rpc("crea_match", {
    p_team_id: teamId, p_avversario: avversario, p_data: data, p_luogo: luogo, p_campionato_id: campionatoId, p_tipo_gara: tipoGara,
  });
  if (error) throw error;
  return matchId as string;
}

/** Crea il set 1 (se non esiste) senza avviare la partita — serve come ancora per convocati/formazione. Idempotente. */
export async function avviaPreparazioneMatch(matchId: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc("avvia_preparazione_match", { p_match_id: matchId });
  if (error) throw error;
  return data as string;
}

export async function impostaConvocati(matchId: string, athleteIds: string[], liberoIds: string[] = []): Promise<void> {
  const { error } = await supabaseClient.rpc("imposta_convocati", { p_match_id: matchId, p_athlete_ids: athleteIds, p_libero_ids: liberoIds });
  if (error) throw error;
}

export async function elencaConvocati(matchId: string): Promise<MatchConvocato[]> {
  const { data, error } = await supabaseClient.from("match_convocati").select("*").eq("match_id", matchId);
  if (error) throw error;
  return data ?? [];
}

/** posizioni: { "1": athleteId, "2": athleteId, ..., "6": athleteId }. chiServe: chi mette a segno il primo servizio del set. */
export async function impostaFormazioneIniziale(setId: string, posizioni: Record<string, string>, chiServe: "noi" | "avversario"): Promise<void> {
  const { error } = await supabaseClient.rpc("imposta_formazione_iniziale", { p_set_id: setId, p_posizioni: posizioni, p_chi_serve: chiServe });
  if (error) throw error;
}

/** Il "pulsante grande": da qui in poi la partita è davvero operativa per lo scouting. */
export async function avviaMatchConfermato(matchId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("avvia_match_confermato", { p_match_id: matchId });
  if (error) throw error;
}

export async function cambiaGiocatore(setId: string, atletaUscente: string, atletaEntrante: string): Promise<void> {
  const { error } = await supabaseClient.rpc("cambia_giocatore", { p_set_id: setId, p_atleta_uscente: atletaUscente, p_atleta_entrante: atletaEntrante });
  if (error) throw error;
}

export async function elencaSet(matchId: string): Promise<MatchSet[]> {
  const { data, error } = await supabaseClient.from("match_sets").select("*").eq("match_id", matchId).order("numero_set");
  if (error) throw error;
  return data ?? [];
}

export async function nuovoSet(matchId: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc("nuovo_set", { p_match_id: matchId });
  if (error) throw error;
  return data as string;
}

/** Un tap sul fondamentale + un tap sull'esito = una sola chiamata: il punteggio E la rotazione si aggiornano da soli lato database (trigger). */
export async function registraEvento(matchId: string, setId: string, skill: Skill, esito: Esito | null, athleteId: string | null): Promise<string> {
  const { data, error } = await supabaseClient.rpc("registra_evento", { p_match_id: matchId, p_set_id: setId, p_skill: skill, p_esito: esito, p_athlete_id: athleteId });
  if (error) throw error;
  return data as string;
}

/** Elimina l'ultimo evento registrato — punteggio E rotazione/servizio si correggono da soli (trigger). */
export async function annullaUltimoEvento(matchId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("annulla_ultimo_evento", { p_match_id: matchId });
  if (error) throw error;
}

export async function chiudiMatch(matchId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("chiudi_match", { p_match_id: matchId });
  if (error) throw error;
}

export async function elencaEventiPartita(matchId: string, limite = 20): Promise<MatchEvent[]> {
  const { data, error } = await supabaseClient.from("match_events").select("*").eq("match_id", matchId).order("creato_il", { ascending: false }).limit(limite);
  if (error) throw error;
  return data ?? [];
}

/** Formazione attuale del set, CON posizione (1-6) — sostituisce la vecchia elencaFormazioneSet che dava solo la lista senza posizione. */
export async function elencaFormazioneConPosizioni(setId: string): Promise<MatchSetLineup[]> {
  const { data, error } = await supabaseClient.from("match_set_lineups").select("*").eq("set_id", setId).eq("in_campo", true).order("posizione");
  if (error) throw error;
  return data ?? [];
}

/** TUTTE le righe del set (anche chi è uscita) — serve per sapere chi è già stata sostituita e non può rientrare, non solo chi è in campo ora. */
export async function elencaStoricoFormazioneSet(setId: string): Promise<MatchSetLineup[]> {
  const { data, error } = await supabaseClient.from("match_set_lineups").select("*").eq("set_id", setId);
  if (error) throw error;
  return data ?? [];
}

/** Chi deve servire per prima nel prossimo set, secondo l'alternanza automatica — null se va richiesto (1° o 5° set). */
export async function chiServeDefaultNuovoSet(matchId: string, numeroSet: number): Promise<"noi" | "avversario" | null> {
  const { data, error } = await supabaseClient.rpc("chi_serve_default_nuovo_set", { p_match_id: matchId, p_numero_nuovo_set: numeroSet });
  if (error) throw error;
  return (data as "noi" | "avversario" | null) ?? null;
}

/** Regole punteggio applicabili a questa partita: quelle del campionato collegato, o i default di regolamento (25 punti/set, 15 al 5°) se la partita non ha un campionato assegnato. */
export async function leggiRegolePunteggio(matchId: string): Promise<{ puntiPerSet: number; puntiSetDecisivo: number }> {
  const { data: m } = await supabaseClient.from("matches").select("campionato_id").eq("id", matchId).single();
  if (!m?.campionato_id) return { puntiPerSet: 25, puntiSetDecisivo: 15 };
  const { data: c } = await supabaseClient.from("campionati").select("punti_per_set, punti_set_decisivo").eq("id", m.campionato_id).single();
  return { puntiPerSet: c?.punti_per_set ?? 25, puntiSetDecisivo: c?.punti_set_decisivo ?? 15 };
}

export interface AndamentoSquadraPartiteVoce {
  fondamentale: Skill;
  partita: string;
  avversario: string;
  punti: number;
  errori: number;
}

/** Aggregato tra partite diverse — visibile a tutti i ruoli, mai scomposto per singola atleta. */
export async function andamentoSquadraPartite(teamId: string): Promise<AndamentoSquadraPartiteVoce[]> {
  const { data, error } = await supabaseClient.rpc("andamento_squadra_partite", { p_team_id: teamId });
  if (error) throw error;
  return data ?? [];
}

/** Correzione manuale opposta: trasforma una partita in allenamento. */
export async function convertiPartitaInAllenamento(matchId: string, titolo?: string): Promise<string> {
  const { data, error } = await supabaseClient.rpc("converti_partita_in_allenamento", { p_match_id: matchId, p_titolo: titolo ?? null });
  if (error) throw error;
  return data as string;
}

export interface RendimentoRotazionePartita {
  rotazione_di: string;
  punti_fatti: number;
  errori_commessi: number;
  saldo: number;
  azioni_totali: number;
}

/** Rendimento per rotazione: quali rotazioni producono e quali perdono. Consultabile anche a partita conclusa. */
export async function rendimentoRotazioniPartita(matchId: string): Promise<RendimentoRotazionePartita[]> {
  const { data, error } = await supabaseClient.rpc("rendimento_rotazioni_partita", { p_match_id: matchId });
  if (error) throw error;
  return data ?? [];
}

export interface RendimentoTurnoServizio {
  al_servizio: string;
  turni_giocati: number;
  punti_nel_turno: number;
  punti_subiti_nel_turno: number;
  media_punti_per_turno: number | null;
}

/** Quanto rende la squadra nel turno di servizio di ciascuna giocatrice: l'unità di misura naturale della pallavolo. */
export async function rendimentoTurniServizio(matchId: string): Promise<RendimentoTurnoServizio[]> {
  const { data, error } = await supabaseClient.rpc("rendimento_turni_servizio", { p_match_id: matchId });
  if (error) throw error;
  return data ?? [];
}

export interface AvvisoFormazione { avviso: string; gravita: string }

/** Controlli sulla formazione dichiarata (per ora: Libero fuori posto). Avvisa senza bloccare. */
export async function verificaFormazione(setId: string): Promise<AvvisoFormazione[]> {
  const { data, error } = await supabaseClient.rpc("verifica_formazione", { p_set_id: setId });
  if (error) return [];
  return data ?? [];
}

export interface LiberoInCampo { libero_id: string; titolare_id: string; posizione: number | null }

/** Chi è il Libero attualmente in campo e chi ha rimpiazzato, se c'è. */
export async function liberoInCampo(setId: string): Promise<LiberoInCampo | null> {
  const { data, error } = await supabaseClient.rpc("libero_in_campo", { p_set_id: setId });
  if (error) return null;
  return (data && data.length > 0) ? data[0] : null;
}

/** Il Libero entra al posto di chi è in seconda linea: non consuma sostituzioni ed è ripetibile. */
export async function rimpiazzaConLibero(setId: string, liberoId: string, titolareId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("rimpiazza_con_libero", { p_set_id: setId, p_libero_id: liberoId, p_titolare_id: titolareId });
  if (error) throw error;
}

export async function faiUscireLibero(setId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("fai_uscire_libero", { p_set_id: setId });
  if (error) throw error;
}
