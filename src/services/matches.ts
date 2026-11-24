import { supabaseClient } from "@/src/lib/supabase";
import { messaggioErroreRouter } from "@/src/services/aiProviders";
import { supabase as cfg } from "@/src/config";
import { calcolaVoti } from "@/src/lib/votiPartita";
import type { CausaPunto, Esito, Match, MatchConvocato, MatchEvent, MatchSet, MatchSetLineup, QualitaRicezione, Skill } from "@/src/types/database";
import * as Motore from "@/src/lib/motorePartita";
import { aggiornaDaServer, applica, applicaOmbra, attivaModoLocale, caricaDaDisco, idPartitaDelSet, inModoLocale, leggi } from "@/src/lib/partitaLocale";
import { accoda } from "@/src/lib/codaOffline";
import { erroreDiRete, idOperazione } from "@/src/lib/rete";

/**
 * Operazioni dello scouting. Normalmente vanno al server (funzione applica_operazione_scout, che applica ogni
 * operazione una sola volta). Se manca la rete e la partita è stata aperta con la connessione, l'operazione si applica
 * alla copia sul telefono con il motore locale (src/lib/motorePartita.ts) e finisce in coda (src/lib/codaOffline.ts):
 * da quel momento la partita si legge e si scrive in locale finché la coda non è stata inviata del tutto.
 */
type Args = Record<string, unknown>;
interface OpzioniOperazione<T> {
  matchId?: string | null;
  setId?: string | null;
  tipo: string;
  args: Args;
  /** Come l'operazione cambia la copia locale (stesse regole del database). */
  locale: (s: Motore.StatoPartita) => T;
  /** Cosa restituire quando l'operazione è andata al server (id restituito dal database). */
  daServer: (id: string | null) => T;
  /** Argomenti da mettere in coda, se dipendono dal risultato locale (es. id del set creato offline). */
  argsInCoda?: (risultato: T) => Args;
  /** L'operazione crea righe con id propri: dopo il server si rilegge la partita invece di aggiornare la copia. */
  ricaricaDopo?: boolean;
  /** Senza copia locale (es. scout ospite): in mancanza di rete l'operazione va comunque in coda e si restituisce questo valore. */
  senzaCopia?: { valore: T };
}

async function operaScout<T>(o: OpzioniOperazione<T>): Promise<T> {
  const mid = o.matchId ?? (o.setId ? idPartitaDelSet(o.setId) : null);
  if (mid) await caricaDaDisco(mid);
  const opId = idOperazione();
  const inCodaLocale = (id: string): T => {
    const r = applica(id, o.locale);
    accoda({ id: opId, matchId: id, tipo: o.tipo, args: o.argsInCoda ? o.argsInCoda(r) : o.args });
    return r;
  };
  if (mid && inModoLocale(mid)) return inCodaLocale(mid);
  try {
    const { data, error } = await supabaseClient.rpc("applica_operazione_scout", { p_op_id: opId, p_tipo: o.tipo, p_args: o.args });
    if (error) throw error;
    if (mid && leggi(mid)) {
      if (o.ricaricaDopo) aggiornaDaServer(mid, true).catch(() => undefined);
      else applicaOmbra(mid, o.locale);
    }
    return o.daServer(((data ?? {}) as { id?: string | null }).id ?? null);
  } catch (e) {
    if (!erroreDiRete(e)) throw e;
    // Manca la rete: si prosegue in locale con la stessa operazione (stesso id: il server la applica una volta sola).
    if (mid && leggi(mid)) {
      attivaModoLocale(mid);
      const r = applica(mid, o.locale);
      accoda({ id: opId, matchId: mid, tipo: o.tipo, args: o.argsInCoda ? o.argsInCoda(r) : o.args });
      return r;
    }
    if (o.senzaCopia && o.matchId) {
      accoda({ id: opId, matchId: o.matchId, tipo: o.tipo, args: o.args });
      return o.senzaCopia.valore;
    }
    throw e;
  }
}

/** Copia locale della partita, se in questo momento si lavora in locale (senza rete). */
function locale(matchId: string): Motore.StatoPartita | null { return inModoLocale(matchId) ? leggi(matchId) : null; }
function localeDelSet(setId: string): Motore.StatoPartita | null {
  const m = idPartitaDelSet(setId);
  return m ? locale(m) : null;
}

export async function elencaPartite(teamId: string): Promise<Match[]> {
  const { data, error } = await supabaseClient.from("matches").select("*").eq("team_id", teamId).order("data", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Cambia dopo la creazione se la partita e' in casa o in trasferta (la sincronizzazione SportEasy non lo sovrascrive). */
export async function impostaLuogoPartita(matchId: string, luogo: "casa" | "trasferta"): Promise<void> {
  const { error } = await supabaseClient.from("matches").update({ luogo }).eq("id", matchId);
  if (error) throw error;
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
  await caricaDaDisco(matchId);
  const l = locale(matchId);
  if (l) {
    const aperto = l.sets.filter((q) => !q.concluso).sort((a, b) => b.numero_set - a.numero_set)[0];
    if (!aperto) throw new Error("Nessun set aperto");
    return aperto.id;
  }
  const { data, error } = await supabaseClient.rpc("avvia_preparazione_match", { p_match_id: matchId });
  if (error) throw error;
  return data as string;
}

export async function impostaConvocati(matchId: string, athleteIds: string[], liberoIds: string[] = []): Promise<void> {
  const { error } = await supabaseClient.rpc("imposta_convocati", { p_match_id: matchId, p_athlete_ids: athleteIds, p_libero_ids: liberoIds });
  if (error) throw error;
}

export async function elencaConvocati(matchId: string): Promise<MatchConvocato[]> {
  const l = locale(matchId);
  if (l) return l.convocati;
  const { data, error } = await supabaseClient.from("match_convocati").select("*").eq("match_id", matchId);
  if (error) throw error;
  return data ?? [];
}

/** posizioni: { "1": athleteId, "2": athleteId, ..., "6": athleteId }. chiServe: chi mette a segno il primo servizio del set. */
export async function impostaFormazioneIniziale(setId: string, posizioni: Record<string, string>, chiServe: "noi" | "avversario"): Promise<void> {
  await operaScout<void>({
    setId, tipo: "formazione_iniziale", args: { set_id: setId, posizioni, chi_serve: chiServe },
    locale: (s) => Motore.formazioneIniziale(s, setId, posizioni, chiServe), daServer: () => undefined,
  });
}

/** Il "pulsante grande": da qui in poi la partita è davvero operativa per lo scouting. */
export async function avviaMatchConfermato(matchId: string): Promise<void> {
  await operaScout<void>({ matchId, tipo: "avvia", args: { match_id: matchId }, locale: (s) => Motore.avviaMatch(s), daServer: () => undefined });
}

/** Libero scelto per la partita e i due centrali su cui entra. */
export interface RegolaLibero { libero_id: string | null; titolare_1: string | null; titolare_2: string | null }

export async function leggiRegolaLibero(matchId: string): Promise<RegolaLibero | null> {
  const l = locale(matchId);
  if (l) return l.regolaLibero;
  const { data, error } = await supabaseClient.rpc("leggi_regola_libero", { p_match_id: matchId });
  if (error) throw error;
  const r = (data ?? [])[0] as RegolaLibero | undefined;
  return r ?? null;
}

export async function impostaRegolaLibero(matchId: string, liberoId: string | null, titolare1: string | null, titolare2: string | null): Promise<void> {
  await operaScout<void>({
    matchId, tipo: "regola_libero", args: { match_id: matchId, libero: liberoId, titolare_1: titolare1, titolare_2: titolare2 },
    locale: (s) => Motore.impostaRegolaLibero(s, liberoId, titolare1, titolare2), daServer: () => undefined,
  });
}

export async function cambiaGiocatore(setId: string, atletaUscente: string, atletaEntrante: string): Promise<void> {
  await operaScout<void>({
    setId, tipo: "cambio", args: { set_id: setId, uscente: atletaUscente, entrante: atletaEntrante },
    locale: (s) => Motore.cambio(s, setId, atletaUscente, atletaEntrante), daServer: () => undefined,
  });
}

export async function elencaSet(matchId: string): Promise<MatchSet[]> {
  const l = locale(matchId);
  if (l) return [...l.sets].sort((a, b) => a.numero_set - b.numero_set);
  const { data, error } = await supabaseClient.from("match_sets").select("*").eq("match_id", matchId).order("numero_set");
  if (error) throw error;
  return data ?? [];
}

export async function nuovoSet(matchId: string): Promise<string> {
  return operaScout<string>({
    matchId, tipo: "nuovo_set", args: { match_id: matchId },
    locale: (s) => Motore.nuovoSet(s), argsInCoda: (id) => ({ match_id: matchId, set_locale_id: id }),
    daServer: (id) => id ?? "", ricaricaDopo: true,
  });
}

/** Annulla un nuovo set aperto per errore: se è ancora vuoto lo elimina e riapre il precedente. Restituisce l'id del set riaperto. */
export async function tornaAlSetPrecedente(matchId: string): Promise<string> {
  return operaScout<string>({
    matchId, tipo: "torna_set", args: { match_id: matchId },
    locale: (s) => Motore.tornaAlSetPrecedente(s), daServer: (id) => id ?? "", ricaricaDopo: true,
  });
}

/**
 * Corregge chi sta in campo e dove (e, se indicato, chi sta battendo) senza toccare punti e azioni gia' registrati.
 * posizioni: { "1": athleteId, ..., "6": athleteId }. Possibile per tutta la partita.
 */
export async function correggiFormazione(setId: string, posizioni: Record<string, string>, chiServe: "noi" | "avversario" | null): Promise<void> {
  await operaScout<void>({
    setId, tipo: "correggi", args: { set_id: setId, posizioni, chi_serve: chiServe },
    locale: (s) => Motore.correggiFormazione(s, setId, posizioni, chiServe), daServer: () => undefined,
  });
}

/** Aggiunge una persona alla distinta della partita in corso: come Libero per tutta la partita, come convocata solo nel primo set. */
export async function aggiungiConvocato(matchId: string, athleteId: string, isLibero = false): Promise<void> {
  await operaScout<void>({
    matchId, tipo: "convocato", args: { match_id: matchId, athlete_id: athleteId, is_libero: isLibero },
    locale: (s) => Motore.aggiungiConvocato(s, athleteId, isLibero), daServer: () => undefined,
  });
}

/** Riporta una partita in corso (solo durante il primo set) a "da preparare", come appena sincronizzata: cancella set, azioni, formazioni e convocati. */
export async function ricominciaPartita(matchId: string): Promise<void> {
  const { error } = await supabaseClient.rpc("ricomincia_partita", { p_match_id: matchId });
  if (error) throw error;
}

/** Ruota a mano la formazione del set di una posizione (in avanti come a ogni cambio palla, o indietro per correggere un giro di troppo). */
export async function ruotaFormazioneManuale(setId: string, indietro = false): Promise<void> {
  await operaScout<void>({
    setId, tipo: "ruota", args: { set_id: setId, indietro },
    locale: (s) => Motore.ruotaManuale(s, setId, indietro), daServer: () => undefined,
  });
}

/** Un tap sul fondamentale + un tap sull'esito = una sola chiamata: il punteggio E la rotazione si aggiornano da soli lato database (trigger). */
export async function registraEvento(matchId: string, setId: string, skill: Skill, esito: Esito | null, athleteId: string | null, qualita: QualitaRicezione | null = null): Promise<string> {
  const { data, error } = await supabaseClient.rpc("registra_evento", { p_match_id: matchId, p_set_id: setId, p_skill: skill, p_esito: esito, p_athlete_id: athleteId, p_qualita: qualita });
  if (error) throw error;
  return data as string;
}

/** Parametri di un'azione registrata durante la partita. */
export interface AzioneScout {
  matchId: string; setId: string; skill: Skill; esito: Esito | null; athleteId: string | null; qualita: QualitaRicezione | null;
  causa?: CausaPunto | null; zonaArrivo?: number | null; zonaPartenza?: number | null;
}

/**
 * Un tap sul fondamentale + un tap sull'esito = una sola operazione: punteggio, rotazione, servizio, motivo del punto
 * e zone si aggiornano insieme (lato database con i trigger; senza rete con il motore locale).
 */
export async function registraAzione(a: AzioneScout): Promise<void> {
  await operaScout<void>({
    matchId: a.matchId, tipo: "evento",
    args: {
      match_id: a.matchId, set_id: a.setId, skill: a.skill, esito: a.esito, athlete_id: a.athleteId, qualita: a.qualita,
      causa: a.causa ?? null, zona_arrivo: a.zonaArrivo ?? null, zona_partenza: a.zonaPartenza ?? null,
    },
    locale: (s) => { Motore.registraEvento(s, { setId: a.setId, skill: a.skill, esito: a.esito, athleteId: a.athleteId, qualita: a.qualita, causa: a.causa ?? null, zonaArrivo: a.zonaArrivo ?? null, zonaPartenza: a.zonaPartenza ?? null }); },
    daServer: () => undefined, senzaCopia: { valore: undefined },
  });
}

/** Partita e set letti dal telefono quando si lavora senza rete, altrimenti dal server. */
export async function leggiPartita(matchId: string): Promise<Match | null> {
  await caricaDaDisco(matchId);
  const l = locale(matchId);
  if (l) return l.match;
  const { data } = await supabaseClient.from("matches").select("*").eq("id", matchId).single();
  return (data as Match | null) ?? null;
}
export async function leggiNumeroSet(setId: string): Promise<number | null> {
  const l = localeDelSet(setId);
  if (l) return l.sets.find((q) => q.id === setId)?.numero_set ?? null;
  const { data } = await supabaseClient.from("match_sets").select("numero_set").eq("id", setId).single();
  return (data as { numero_set: number } | null)?.numero_set ?? null;
}
export async function leggiIdSetNumero(matchId: string, numero: number): Promise<string | null> {
  const l = locale(matchId);
  if (l) return l.sets.find((q) => q.numero_set === numero)?.id ?? null;
  const { data } = await supabaseClient.from("match_sets").select("id").eq("match_id", matchId).eq("numero_set", numero).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Elimina l'ultimo evento registrato — punteggio E rotazione/servizio si correggono da soli (trigger). */
export async function annullaUltimoEvento(matchId: string): Promise<void> {
  await operaScout<void>({
    matchId, tipo: "annulla", args: { match_id: matchId },
    locale: (s) => Motore.annullaUltimoEvento(s), daServer: () => undefined, senzaCopia: { valore: undefined },
  });
}

export async function chiudiMatch(matchId: string): Promise<void> {
  await operaScout<void>({ matchId, tipo: "chiudi", args: { match_id: matchId }, locale: (s) => Motore.chiudiMatch(s), daServer: () => undefined });
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
  const l = locale(matchId);
  if (l) return [...l.eventi].reverse().slice(0, limite);
  const { data, error } = await supabaseClient.from("match_events").select("*").eq("match_id", matchId).order("creato_il", { ascending: false }).limit(limite);
  if (error) throw error;
  return data ?? [];
}

/** TUTTE le azioni della partita, dalla piu' vecchia alla piu' recente (per la cronaca di chi guarda). Legge a pagine da 1000. */
export async function elencaTutteLeAzioniPartita(matchId: string): Promise<MatchEvent[]> {
  const l = locale(matchId);
  if (l) return [...l.eventi];
  const tutte: MatchEvent[] = [];
  const DIMENSIONE = 1000;
  for (let da = 0; da < 20000; da += DIMENSIONE) {
    const { data, error } = await supabaseClient.from("match_events").select("*").eq("match_id", matchId)
      .order("creato_il", { ascending: true }).order("id", { ascending: true }).range(da, da + DIMENSIONE - 1);
    if (error) throw error;
    tutte.push(...(data ?? []));
    if (!data || data.length < DIMENSIONE) break;
  }
  return tutte;
}

/** Formazione attuale del set, CON posizione (1-6) — sostituisce la vecchia elencaFormazioneSet che dava solo la lista senza posizione. */
export async function elencaFormazioneConPosizioni(setId: string): Promise<MatchSetLineup[]> {
  const l = localeDelSet(setId);
  if (l) return l.formazioni.filter((r) => r.set_id === setId && r.in_campo).sort((a, b) => (a.posizione ?? 0) - (b.posizione ?? 0));
  const { data, error } = await supabaseClient.from("match_set_lineups").select("*").eq("set_id", setId).eq("in_campo", true).order("posizione");
  if (error) throw error;
  return data ?? [];
}

/** TUTTE le righe del set (anche chi è uscita) — serve per sapere chi è già stata sostituita e non può rientrare, non solo chi è in campo ora. */
export async function elencaStoricoFormazioneSet(setId: string): Promise<MatchSetLineup[]> {
  const l = localeDelSet(setId);
  if (l) return l.formazioni.filter((r) => r.set_id === setId);
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
  const l = localeDelSet(setId);
  if (l) {
    const out: Record<number, string> = {};
    for (const r of l.formazioni) if (r.set_id === setId && r.posizione_iniziale) out[r.posizione_iniziale] = r.athlete_id;
    return out;
  }
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
  const l = locale(matchId);
  if (l) return Motore.chiServeDefault(l, numeroSet);
  const { data, error } = await supabaseClient.rpc("chi_serve_default_nuovo_set", { p_match_id: matchId, p_numero_nuovo_set: numeroSet });
  if (error) throw error;
  return (data as "noi" | "avversario" | null) ?? null;
}

/** Regole punteggio applicabili a questa partita: quelle del campionato collegato, o i default di regolamento (25 punti/set, 15 al 5°) se la partita non ha un campionato assegnato. */
export async function leggiRegolePunteggio(matchId: string): Promise<{ puntiPerSet: number; puntiSetDecisivo: number }> {
  const l = locale(matchId);
  if (l) return { puntiPerSet: l.regole.puntiPerSet, puntiSetDecisivo: l.regole.puntiSetDecisivo };
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
  const l = localeDelSet(setId);
  if (l) return Motore.verificaFormazioneDi(l, setId) as AvvisoFormazione[];
  const { data, error } = await supabaseClient.rpc("verifica_formazione", { p_set_id: setId });
  if (error) return [];
  return data ?? [];
}

export interface LiberoInCampo { libero_id: string; titolare_id: string; posizione: number | null }

/** Chi è il Libero attualmente in campo e chi ha rimpiazzato, se c'è. */
export async function liberoInCampo(setId: string): Promise<LiberoInCampo | null> {
  const l = localeDelSet(setId);
  if (l) return Motore.liberoInCampoDi(l, setId);
  const { data, error } = await supabaseClient.rpc("libero_in_campo", { p_set_id: setId });
  if (error) return null;
  return (data && data.length > 0) ? data[0] : null;
}

/** Il Libero entra al posto di chi è in seconda linea: non consuma sostituzioni ed è ripetibile. */
export async function rimpiazzaConLibero(setId: string, liberoId: string, titolareId: string): Promise<void> {
  await operaScout<void>({
    setId, tipo: "libero_entra", args: { set_id: setId, libero: liberoId, titolare: titolareId },
    locale: (s) => Motore.liberoEntra(s, setId, liberoId, titolareId), daServer: () => undefined,
  });
}

export async function faiUscireLibero(setId: string): Promise<void> {
  await operaScout<void>({ setId, tipo: "libero_esce", args: { set_id: setId }, locale: (s) => Motore.liberoEsce(s, setId), daServer: () => undefined });
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
  athlete_id: string | null;
  qualita: string | null;
  causa?: string | null;
  creato_il: string;
}

/** TUTTI gli eventi della partita, dal primo all'ultimo: serve al grafico punto a punto. */
export async function elencaEventiPerAndamento(matchId: string): Promise<EventoAndamento[]> {
  const { data, error } = await supabaseClient
    .from("match_events")
    .select("id, set_id, skill, esito, athlete_id, qualita, causa, creato_il")
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
  const l = locale(matchId);
  if (l) return [...l.timeouts];
  const { data, error } = await supabaseClient.from("match_timeouts").select("*").eq("match_id", matchId).order("creato_il");
  if (error) return [];
  return (data ?? []) as MatchTimeout[];
}

export async function registraTimeout(setId: string, squadra: "noi" | "avversario"): Promise<void> {
  await operaScout<void>({
    setId, tipo: "timeout", args: { set_id: setId, squadra },
    locale: (s) => Motore.timeoutRegistra(s, setId, squadra), daServer: () => undefined,
  });
}

export async function annullaUltimoTimeout(setId: string): Promise<void> {
  await operaScout<void>({ setId, tipo: "timeout_annulla", args: { set_id: setId }, locale: (s) => Motore.timeoutAnnulla(s, setId), daServer: () => undefined });
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
/** Indica il motivo di un punto diretto (+1 NOI / +1 LORO) appena registrato. */
export async function impostaCausaEvento(eventId: string, causa: CausaPunto): Promise<void> {
  const { error } = await supabaseClient.rpc("imposta_causa_evento", { p_event_id: eventId, p_causa: causa });
  if (error) throw error;
}

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

/**
 * Commento per il gruppo WhatsApp della squadra, scritto dall'AI sui numeri della partita
 * (risultato, parziali, rendimento per fondamentale, chi ha fatto meglio). Riconosce chi ha giocato bene
 * e non critica nessuna per nome. Ritorna solo il testo del commento: l'intestazione e la firma le mette l'app.
 */
export async function generaCommentoPartitaAI(teamId: string, match: Match, sets: MatchSet[], nomiAtlete: Map<string, string>): Promise<{ errore: boolean; messaggio?: string; testo?: string }> {
  const [fondamentali, eventi] = await Promise.all([
    analisiFondamentaliPartita(match.id).catch(() => []),
    elencaEventiPerAndamento(match.id).catch(() => []),
  ]);
  const voti = Object.values(calcolaVoti(eventi))
    .filter((v) => v.voto !== null)
    .sort((a, b) => (b.voto ?? 0) - (a.voto ?? 0))
    .slice(0, 3)
    .map((v) => `${(nomiAtlete.get(v.athlete_id) ?? "").split(" ")[0]} (voto ${v.voto!.toFixed(1)}, ${v.azioni} azioni)`)
    .filter((x) => !x.startsWith(" "));
  const righeFond = fondamentali
    .filter((f) => f.azioni > 0)
    .map((f) => `- ${f.fondamentale}: ${f.azioni} azioni, ${f.punti} punti, ${f.errori} errori${f.efficienza !== null ? `, efficienza ${Math.round(f.efficienza * 100)}%` : ""}`)
    .join("\n");
  const esito = match.set_vinti_noi > match.set_vinti_avversario ? "vittoria" : match.set_vinti_noi < match.set_vinti_avversario ? "sconfitta" : "pareggio";
  const riassunto =
    `Partita ${match.tipo_gara === "campionato" ? "di campionato" : "amichevole"} contro ${match.avversario}, ${match.luogo === "trasferta" ? "in trasferta" : "in casa"}.\n` +
    `Esito: ${esito} ${match.set_vinti_noi}-${match.set_vinti_avversario}. Parziali: ${sets.map((x) => `${x.punti_noi}-${x.punti_avversario}`).join(", ") || "non disponibili"}.\n` +
    (righeFond ? `Rendimento per fondamentale:\n${righeFond}\n` : "") +
    (voti.length ? `Migliori della partita: ${voti.join("; ")}.\n` : "");

  const prompt =
    `Scrivi il commento sulla partita da mandare nel gruppo WhatsApp della squadra. Ecco i dati:\n\n${riassunto}\n` +
    `Rispondi con il solo testo del messaggio.`;

  const { data: sessione } = await supabaseClient.auth.getSession();
  if (!sessione.session) return { errore: true, messaggio: "Sessione scaduta, effettua di nuovo l'accesso." };
  const { data, error } = await supabaseClient.functions.invoke(cfg.aiRouterFunction, { body: { team_id: teamId, prompt, funzione: "commento_partita" } });
  if (error) return { errore: true, messaggio: await messaggioErroreRouter(error) };
  if (data?.errore) return { errore: true, messaggio: [data.messaggio, data.dettagli].filter(Boolean).join("\n\n") };
  const testo = String(data?.testo ?? "").trim();
  return testo ? { errore: false, testo } : { errore: true, messaggio: "L'AI non ha restituito nessun testo." };
}
