import { supabaseClient } from "@/src/lib/supabase";
import type { Esito, Match, MatchConvocato, MatchEvent, MatchSet, MatchSetLineup, QualitaRicezione, Skill } from "@/src/types/database";

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
export async function registraEvento(matchId: string, setId: string, skill: Skill, esito: Esito | null, athleteId: string | null, qualita: QualitaRicezione | null = null): Promise<string> {
  const { data, error } = await supabaseClient.rpc("registra_evento", { p_match_id: matchId, p_set_id: setId, p_skill: skill, p_esito: esito, p_athlete_id: athleteId, p_qualita: qualita });
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

/** Evento con la rotazione (chi era al servizio) in cui e' avvenuto: serve a dire dove siamo deboli in ogni rotazione. */
export interface EventoPerRotazione {
  skill: Skill;
  esito: Esito | null;
  athlete_id: string | null;
  rotazione_al_servizio: string | null;
}

/** TUTTI gli eventi della partita con la rotazione, per l'analisi della rotazione piu' debole. */
export async function elencaEventiPerRotazione(matchId: string): Promise<EventoPerRotazione[]> {
  const { data, error } = await supabaseClient
    .from("match_events")
    .select("skill, esito, athlete_id, rotazione_al_servizio")
    .eq("match_id", matchId)
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as EventoPerRotazione[];
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

/**
 * Formazione di PARTENZA di un set ({ posizione: athleteId }), prima di
 * rotazioni e cambi. Vuota se non disponibile (set giocato prima che
 * venisse registrata, o colonna non ancora presente nel database).
 */
export async function formazioneInizialeSet(setId: string): Promise<Record<number, string>> {
  const { data, error } = await supabaseClient
    .from("match_set_lineups")
    .select("athlete_id, posizione_iniziale")
    .eq("set_id", setId)
    .not("posizione_iniziale", "is", null);
  if (error) return {};
  const risultato: Record<number, string> = {};
  for (const r of data ?? []) if (r.posizione_iniziale) risultato[r.posizione_iniziale] = r.athlete_id;
  return risultato;
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

/**
 * Elimina definitivamente una partita con tutti i dati collegati (set,
 * eventi di scouting, convocati, formazioni). Permessi verificati dal
 * database: solo allenatore/vice della squadra o superuser.
 */
export async function eliminaPartita(matchId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("elimina_partita", { p_match_id: matchId });
  if (error) throw error;
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

/**
 * Side-out% (punti vinti ricevendo) e break-point% (punti vinti
 * servendo): le due metriche-cardine dell'analisi pallavolistica
 * professionale (DataVolley/VolleyStation), più il dettaglio qualità
 * delle ricezioni. Un rapporto basso in ricezione con tante ricezioni
 * "scarse" indica da dove viene il problema, non solo che c'è.
 */
export interface RendimentoServizioRicezione {
  punti_in_battuta: number;
  punti_vinti_in_battuta: number;
  break_point_pct: number | null;
  punti_in_ricezione: number;
  punti_vinti_in_ricezione: number;
  side_out_pct: number | null;
  ricezioni_ottime: number;
  ricezioni_buone: number;
  ricezioni_scarse: number;
  ricezioni_errori: number;
}

export async function rendimentoServizioRicezionePartita(matchId: string): Promise<RendimentoServizioRicezione | null> {
  const { data, error } = await supabaseClient.rpc("rendimento_servizio_ricezione_partita", { p_match_id: matchId });
  if (error) throw error;
  return (data ?? [])[0] ?? null;
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

export interface AnalisiFondamentale {
  fondamentale: string;
  azioni: number;
  punti: number;
  errori: number;
  efficienza: number | null;
  quota_sul_totale: number | null;
}

export interface AnalisiPersona {
  athlete_id: string;
  nome_completo: string;
  azioni: number;
  punti: number;
  errori: number;
  saldo: number;
  fondamentale_migliore: string | null;
  fondamentale_peggiore: string | null;
}

/** Una riga per giocatore e fondamentale: i numeri dietro al riepilogo di ciascuno. */
export interface AnalisiPersonaFondamentale {
  athlete_id: string;
  fondamentale: string;
  azioni: number;
  punti: number;
  neutri: number;
  errori: number;
  ricezioni_ottime: number;
  ricezioni_buone: number;
  ricezioni_scarse: number;
}

export interface AndamentoPartita {
  match_id: string;
  avversario: string;
  data: string;
  set_vinti_noi: number;
  set_vinti_avversario: number;
  azioni: number;
  punti: number;
  errori: number;
  efficienza: number | null;
}

/** Efficienza (punti-errori/azioni) per fondamentale in una partita: quanto RENDE ciascuno, non solo quante volte è stato usato. */
export async function analisiFondamentaliPartita(matchId: string): Promise<AnalisiFondamentale[]> {
  const { data, error } = await supabaseClient.rpc("analisi_fondamentali_partita", { p_match_id: matchId });
  if (error) throw error;
  return data ?? [];
}

/** Contributo di ciascuna persona in una partita. Chi non è staff vede solo le proprie righe (applicato dal database). */
export async function analisiPersonePartita(matchId: string): Promise<AnalisiPersona[]> {
  const { data, error } = await supabaseClient.rpc("analisi_persone_partita", { p_match_id: matchId });
  if (error) throw error;
  return data ?? [];
}

/** Dettaglio per fondamentale di ciascun giocatore (stessa visibilità di analisiPersonePartita). */
export async function analisiPersoneDettaglioPartita(matchId: string): Promise<AnalisiPersonaFondamentale[]> {
  const { data, error } = await supabaseClient.rpc("analisi_persone_dettaglio_partita", { p_match_id: matchId });
  if (error) throw error;
  return data ?? [];
}

/** Andamento della squadra nelle ultime N partite concluse: una riga per partita, per vedere la tendenza. */
export async function andamentoTraPartite(teamId: string, quante = 10): Promise<AndamentoPartita[]> {
  const { data, error } = await supabaseClient.rpc("andamento_tra_partite", { p_team_id: teamId, p_quante: quante });
  if (error) throw error;
  return data ?? [];
}

/** Un evento di scouting ridotto all'essenziale, quanto basta per ricostruire l'andamento dei punti. */
export interface EventoAndamento {
  id: string;
  set_id: string;
  skill: Skill;
  esito: Esito | null;
  creato_il: string;
}

/** TUTTI gli eventi della partita, dal primo all'ultimo: serve al grafico punto a punto. */
export async function elencaEventiPerAndamento(matchId: string): Promise<EventoAndamento[]> {
  const { data, error } = await supabaseClient
    .from("match_events")
    .select("id, set_id, skill, esito, creato_il")
    .eq("match_id", matchId)
    .order("creato_il", { ascending: true })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as EventoAndamento[];
}

/** Time-out chiamato durante un set, col punteggio del momento. */
export interface MatchTimeout {
  id: string;
  match_id: string;
  set_id: string;
  squadra: "noi" | "avversario";
  punti_noi: number;
  punti_avversario: number;
  creato_il: string;
}

export async function elencaTimeout(matchId: string): Promise<MatchTimeout[]> {
  const { data, error } = await supabaseClient.from("match_timeouts").select("*").eq("match_id", matchId).order("creato_il");
  if (error) return [];
  return (data ?? []) as MatchTimeout[];
}

export async function registraTimeout(setId: string, squadra: "noi" | "avversario"): Promise<void> {
  const { error } = await supabaseClient.rpc("registra_timeout", { p_set_id: setId, p_squadra: squadra });
  if (error) throw error;
}

export async function annullaUltimoTimeout(setId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("annulla_ultimo_timeout", { p_set_id: setId });
  if (error) throw error;
}

/** Una riga = un giocatore, in una partita, per un fondamentale. */
export interface AndamentoPersonaPartita {
  athlete_id: string;
  match_id: string;
  data: string;
  avversario: string;
  fondamentale: string;
  azioni: number;
  punti: number;
  errori: number;
}

/** Come ha giocato ciascuna persona nelle ultime partite (le atlete vedono solo se stesse: lo applica il database). */
export async function andamentoPersonePartite(teamId: string, ultime = 5): Promise<AndamentoPersonaPartita[]> {
  const { data, error } = await supabaseClient.rpc("andamento_persone_partite", { p_team_id: teamId, p_ultime: ultime });
  if (error) throw error;
  return (data ?? []) as AndamentoPersonaPartita[];
}

/** Aggiunge zona di arrivo (e di partenza) a un evento di battuta o attacco appena registrato. */
export async function impostaZoneEvento(eventId: string, zonaArrivo: number | null, zonaPartenza: number | null = null): Promise<void> {
  const { error } = await supabaseClient.rpc("imposta_zone_evento", { p_event_id: eventId, p_zona_arrivo: zonaArrivo, p_zona_partenza: zonaPartenza });
  if (error) throw error;
}

/** Una riga = giocatore, fondamentale (Servizio/Attacco), zona di partenza e di arrivo. */
export interface AnalisiZona {
  athlete_id: string;
  fondamentale: string;
  zona_partenza: number | null;
  zona_arrivo: number | null;
  azioni: number;
  punti: number;
  errori: number;
}

export async function analisiZonePartita(matchId: string): Promise<AnalisiZona[]> {
  const { data, error } = await supabaseClient.rpc("analisi_zone_partita", { p_match_id: matchId });
  if (error) throw error;
  return (data ?? []) as AnalisiZona[];
}
