import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Switch, Modal, ActivityIndicator, FlatList, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaAtlete } from "@/src/services/athletes";
import {
  annullaUltimoEvento,
  annullaUltimoTimeout,
  cambiaGiocatore,
  chiudiMatch,
  elencaConvocati,
  elencaEventiPartita,
  elencaFormazioneConPosizioni,
  elencaSet,
  elencaStoricoFormazioneSet,
  elencaTimeout,
  impostaZoneEvento,
  leggiRegolePunteggio,
  nuovoSet,
  registraEvento,
  registraTimeout,
  faiUscireLibero,
  liberoInCampo,
  rendimentoRotazioniPartita,
  rimpiazzaConLibero,
  type LiberoInCampo,
  type MatchTimeout,
  type RendimentoRotazionePartita,
} from "@/src/services/matches";
import { chiediParerePartitaAI } from "@/src/services/evaluations";
import { rendimentoTurniServizio, type RendimentoTurnoServizio } from "@/src/services/matches";
import { rendimentoServizioRicezionePartita, type RendimentoServizioRicezione } from "@/src/services/matches";
import { analizzaSituazione, riassuntoPerAI, type SegnalazioneSituazione } from "@/src/lib/situazione";
import { brand, skillsScouting, skillsScoutingEssenziali } from "@/src/config";
import type { Athlete, Esito, Match, MatchEvent, MatchSet, MatchSetLineup, QualitaRicezione, Skill } from "@/src/types/database";
import { supabaseClient } from "@/src/lib/supabase";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { CampoPallini, type Pallino } from "@/src/components/CampoPallini";
import { useSincronizzazioneLive } from "@/src/hooks/useSincronizzazioneLive";
import { statoPartitaOspite } from "@/src/services/scoutOspiti";
import { SelettoreZona } from "@/src/components/ZoneCampo";
import { FASI_SCHEMA, VARIANTI_SCHEMA, ZONA_PREDEFINITA, chiaveSchema, faseConZona, faseDelloScambio, indiceSchema, puntoDiPosizione, puntoRuoloLinea, rotazioneDaFormazione, type Assegnazioni, type FaseSchema } from "@/src/lib/schemiGioco";
import { elencaSchemiGioco } from "@/src/services/schemiGioco";
import { SOGLIA_SERIE_AVVERSARIA, chiHaSegnato, serieAvversariaInCorso } from "@/src/lib/andamentoPunti";

type Passo = "giocatrice" | "fondamentale" | "esito" | "zona";

/** La modalita' "zone" (dove e' caduta la palla) si ricorda tra una partita e l'altra su questo dispositivo. */
const CHIAVE_ZONE_ATTIVE = "scout_zone_attive";
function leggiZoneAttive(): boolean {
  try {
    const ls = (globalThis as any).localStorage;
    return !!ls && ls.getItem(CHIAVE_ZONE_ATTIVE) === "1";
  } catch { return false; }
}
const CHIAVE_VARIANTI_SCHEMA = "scout_varianti_schema";
const VARIANTI_INIZIALI: Record<FaseSchema, number> = { ricezione: 1, difesa: 1, copertura: 1 };

/** Variante di schema scelta per ciascuna fase (es. difesa: muro diagonale o lungo linea), ricordata fra una partita e l'altra. */
function leggiVarianti(): Record<FaseSchema, number> {
  try {
    const ls = (globalThis as any).localStorage;
    const g = ls ? JSON.parse(ls.getItem(CHIAVE_VARIANTI_SCHEMA) ?? "null") : null;
    if (g && typeof g === "object") {
      const ok = (v: unknown) => (v === 2 ? 2 : 1);
      return { ricezione: ok(g.ricezione), difesa: ok(g.difesa), copertura: ok(g.copertura) };
    }
  } catch { /* si riparte dalla variante 1 */ }
  return { ...VARIANTI_INIZIALI };
}

function salvaVarianti(v: Record<FaseSchema, number>) {
  try {
    const ls = (globalThis as any).localStorage;
    if (ls) ls.setItem(CHIAVE_VARIANTI_SCHEMA, JSON.stringify(v));
  } catch { /* la scelta non si salva, nessun danno */ }
}

function salvaZoneAttive(valore: boolean) {
  try {
    const ls = (globalThis as any).localStorage;
    if (ls) ls.setItem(CHIAVE_ZONE_ATTIVE, valore ? "1" : "0");
  } catch { /* la preferenza non si salva, nessun danno */ }
}

/**
 * Quante azioni recenti mostra l'elenco "Ultime azioni". Se ne caricano
 * comunque di più (servono a "Situazione" e al parere dell'assistente,
 * che leggono la storia recente): qui si limita solo ciò che si vede.
 */
const AZIONI_RECENTI_MOSTRATE = 5;

/** Ogni quanto lo scout OSPITE rilegge la partita (non riceve la trasmissione in tempo reale: non ha accesso diretto alle tabelle). */
const INTERVALLO_AGGIORNAMENTO_OSPITE_MS = 4000;

/**
 * Scouting live. Due scelte di impostazione volute:
 *
 * 1. SEMPRE IN ORIZZONTALE, anche a telefono bloccato in verticale: il
 *    contenuto è disposto in riga (campo quadrato a sinistra, comandi a
 *    destra) invece di affidarsi alla rotazione dello schermo, che su
 *    molti telefoni è disattivata proprio per non ruotare per sbaglio.
 *
 * 2. FLUSSO A TRE PASSI: giocatrice → fondamentale → esito. Ricalca
 *    l'ordine con cui si osserva l'azione ("ha sbagliato LEI, in
 *    RICEZIONE") e rende impossibile registrare un evento senza
 *    attribuzione, che era il difetto del flusso precedente.
 */
export default function PartitaLive() {
  const { id, ospite } = useLocalSearchParams<{ id: string; ospite?: string }>();
  const { team, puoScrivere, puoScoutare: puoScoutareDaRuolo } = useAuth();
  // Scout OSPITE: persona esterna alla squadra, invitata solo su questa partita.
  // Legge tutto da una funzione dedicata del database e non puo' avviare/chiudere set o partita.
  const modoOspite = ospite === "1";
  const puoScoutare = modoOspite || puoScoutareDaRuolo;
  const [nomeSquadraOspite, setNomeSquadraOspite] = useState<string | null>(null);
  const [erroreOspite, setErroreOspite] = useState<string | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [setCorrente, setSetCorrente] = useState<MatchSet | null>(null);
  const [eventi, setEventi] = useState<MatchEvent[]>([]);
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [convocateIds, setConvocateIds] = useState<string[]>([]);
  const [liberiIds, setLiberiIds] = useState<Set<string>>(new Set());
  const [libero, setLibero] = useState<LiberoInCampo | null>(null);
  const [popupLibero, setPopupLibero] = useState(false);
  // Secondo tocco sul Libero in campo: si sceglie solo tra far rientrare la titolare o far entrare l'altro Libero.
  const [popupCambioLibero, setPopupCambioLibero] = useState(false);
  // Chi esce, già scelto, in attesa di sapere quale Libero entra (solo se i Liberi sono più d'uno).
  const [titolareLiberoScelto, setTitolareLiberoScelto] = useState<string | null>(null);
  const [formazione, setFormazione] = useState<MatchSetLineup[]>([]);
  const [storicoFormazione, setStoricoFormazione] = useState<MatchSetLineup[]>([]);

  const [atletaSelId, setAtletaSelId] = useState<string | null>(null);
  const [skillSel, setSkillSel] = useState<Skill | null>(null);
  // Se vero, il passo "fondamentale" mostra tutti i fondamentali e non solo quelli possibili in questo momento dello scambio.
  const [mostraTuttiFondamentali, setMostraTuttiFondamentali] = useState(false);
  const [modalitaEssenziale, setModalitaEssenziale] = useState(true);
  const [popupCambio, setPopupCambio] = useState(false);
  const [erroreVisibile, setErroreVisibile] = useState<string | null>(null);
  const [regolePunteggio, setRegolePunteggio] = useState({ puntiPerSet: 25, puntiSetDecisivo: 15 });
  const ultimoPunteggioSegnalato = useRef("");

  const [popupSituazione, setPopupSituazione] = useState(false);
  const [rotazioni, setRotazioni] = useState<RendimentoRotazionePartita[]>([]);
  const [turni, setTurni] = useState<RendimentoTurnoServizio[]>([]);
  const [servizioRicezione, setServizioRicezione] = useState<RendimentoServizioRicezione | null>(null);
  const [parereAI, setParereAI] = useState<string | null>(null);
  const [chiedendoAI, setChiedendoAI] = useState(false);
  const [popupEventi, setPopupEventi] = useState(false);
  const [timeouts, setTimeouts] = useState<MatchTimeout[]>([]);
  const [popupTimeout, setPopupTimeout] = useState(false);
  // Modalita' facoltativa: dopo l'esito di battuta/attacco si indica dove e' caduta la palla (zone 1-6).
  const [zoneAttive, setZoneAttive] = useState<boolean>(() => leggiZoneAttive());
  const [varianti, setVarianti] = useState<Record<FaseSchema, number>>(() => leggiVarianti());
  const [zonaInAttesa, setZonaInAttesa] = useState<{ skill: Skill; esito: Esito; athleteId: string } | null>(null);

  // Adatta la disposizione alla forma dello schermo: in orizzontale il
  // campo sta a sinistra alto quanto lo schermo, in verticale sta in
  // alto largo quanto lo schermo e i comandi vanno sotto. In entrambi i
  // casi il campo resta quadrato e occupa il lato corto per intero,
  // così è sempre il più grande possibile senza uscire dallo schermo.
  const { width: larghezzaSchermo, height: altezzaSchermo } = useWindowDimensions();
  const orizzontale = larghezzaSchermo >= altezzaSchermo;
  // Il lato del quadrato è il minore tra lo spazio disponibile in
  // altezza e quello in larghezza, così il campo entra sempre per
  // intero senza tagliare i comandi. Ridotto del 20% (0.52->0.42,
  // 0.40->0.32) perché su schermo da telefono il campo pieno lasciava
  // troppo poco spazio ai pulsanti sottostanti.
  // Il pulsante Libero sta a sinistra della formazione, in una colonna
  // stretta. In verticale il tabellone sta a destra del campo: cosi'
  // campo, Libero e punteggio occupano una sola fascia in alto e tutto
  // il resto entra in una schermata senza scorrere.
  const LARGHEZZA_TASTO_LIBERO = 52;
  const latoCampo = orizzontale
    ? Math.min(altezzaSchermo - 32, (larghezzaSchermo - LARGHEZZA_TASTO_LIBERO) * 0.42)
    : Math.min(altezzaSchermo * 0.30, (larghezzaSchermo - 16 - LARGHEZZA_TASTO_LIBERO - 12) * 0.68);
  // I comandi si ridimensionano con lo spazio disponibile invece di
  // avere misure fisse che su schermi piccoli escono e su grandi
  // sprecano spazio. Scala ridotta del 20% rispetto a prima, per lo
  // stesso motivo del campo: tutto deve stare in una sola schermata.
  const spazioComandi = orizzontale ? larghezzaSchermo - latoCampo - LARGHEZZA_TASTO_LIBERO - 30 : larghezzaSchermo - 16;
  const scala = Math.max(0.68, Math.min(1.08, spazioComandi / 340)) * 0.8;
  const d = (valore: number) => Math.round(valore * scala);

  const carica = useCallback(async () => {
    if (!id) return;
    if (modoOspite) {
      try {
        const st = await statoPartitaOspite(id);
        setErroreOspite(null);
        setMatch(st.match);
        setNomeSquadraOspite(st.team_nome);
        setSetCorrente(st.sets.find((s) => s.id === st.set_attivo_id) ?? null);
        setEventi(st.eventi);
        setAtlete(st.atlete);
        setConvocateIds(st.convocati.map((c) => c.athlete_id));
        setLiberiIds(new Set(st.convocati.filter((c) => c.is_libero).map((c) => c.athlete_id)));
        setRegolePunteggio(st.regole);
        setFormazione(st.formazione.filter((f) => f.in_campo).sort((a, b) => (a.posizione ?? 0) - (b.posizione ?? 0)));
        setStoricoFormazione(st.formazione);
        setLibero(st.libero ?? null);
        setTimeouts(st.timeouts ?? []);
      } catch (e) {
        setErroreOspite((e as Error).message);
      }
      return;
    }
    const { data: m } = await supabaseClient.from("matches").select("*").eq("id", id).single();
    setMatch(m ?? null);
    const set = await elencaSet(id);
    const attivo = set.find((s) => !s.concluso) ?? set[set.length - 1] ?? null;
    setSetCorrente(attivo);
    setEventi(await elencaEventiPartita(id));
    if (m) {
      const [lista, convocati] = await Promise.all([elencaAtlete(m.team_id), elencaConvocati(id)]);
      setAtlete(lista);
      setConvocateIds(convocati.map((c) => c.athlete_id));
      setLiberiIds(new Set(convocati.filter((c) => c.is_libero).map((c) => c.athlete_id)));
      setRegolePunteggio(await leggiRegolePunteggio(id));
      setTimeouts(await elencaTimeout(id));
    }
    if (attivo) {
      const [inCampo, storico] = await Promise.all([elencaFormazioneConPosizioni(attivo.id), elencaStoricoFormazioneSet(attivo.id)]);
      setFormazione(inCampo);
      setStoricoFormazione(storico);
      setLibero(await liberoInCampo(attivo.id));
    }
    if (attivo && m && !modoOspite) verificaFineSet(attivo, m, set);
  }, [id, modoOspite]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  // Schemi di gioco della squadra (ricezione, difesa, copertura): se non
  // ci sono o non si riesce a leggerli si resta sulle posizioni di rotazione.
  const [schemi, setSchemi] = useState<Record<string, Assegnazioni>>({});
  const teamIdPartita = match?.team_id;
  useEffect(() => {
    if (modoOspite || !teamIdPartita) return;
    elencaSchemiGioco(teamIdPartita).then(setSchemi).catch(() => setSchemi({}));
  }, [modoOspite, teamIdPartita]);

  // L'ospite non puo' leggere le tabelle direttamente, quindi niente
  // trasmissione in tempo reale: si rilegge a intervalli brevi.
  useEffect(() => {
    if (!modoOspite) return;
    const timer = setInterval(() => { carica(); }, INTERVALLO_AGGIORNAMENTO_OSPITE_MS);
    return () => clearInterval(timer);
  }, [modoOspite, carica]);

  // Se un'altra persona (vice, scout) registra da un altro
  // dispositivo, questa schermata si aggiorna da sola invece di
  // restare ferma finché non la si ricarica a mano.
  useSincronizzazioneLive(
    [
      { nome: "match_events", colonnaFiltro: "match_id", valoreFiltro: match?.id },
      { nome: "match_sets", colonnaFiltro: "match_id", valoreFiltro: match?.id },
      { nome: "match_set_lineups", colonnaFiltro: "set_id", valoreFiltro: setCorrente?.id },
    ],
    carica,
  );
  // Canale a parte: se la tabella dei time-out non fosse nella trasmissione live,
  // non deve disturbare l'aggiornamento di punti e formazione.
  useSincronizzazioneLive([{ nome: "match_timeouts", colonnaFiltro: "match_id", valoreFiltro: match?.id }], carica);

  function nomeAtleta(athleteId: string): Athlete | undefined {
    return atlete.find((a) => a.id === athleteId);
  }
  function etichettaAtleta(athleteId: string): string {
    const a = nomeAtleta(athleteId);
    return a ? `#${a.numero_maglia ?? "-"} ${a.cognome}` : "—";
  }

  function verificaFineSet(set: MatchSet, m: Match, tuttiISet: MatchSet[]) {
    if (set.concluso) return;
    const soglia = set.numero_set === 5 ? regolePunteggio.puntiSetDecisivo : regolePunteggio.puntiPerSet;
    const noi = set.punti_noi >= soglia && set.punti_noi - set.punti_avversario >= 2;
    const loro = set.punti_avversario >= soglia && set.punti_avversario - set.punti_noi >= 2;
    if (!noi && !loro) return;

    const chiave = `${set.id}-${set.punti_noi}-${set.punti_avversario}`;
    if (ultimoPunteggioSegnalato.current === chiave) return;
    ultimoPunteggioSegnalato.current = chiave;

    const vintiNoi = tuttiISet.filter((s) => s.concluso && s.punti_noi > s.punti_avversario).length + (noi ? 1 : 0);
    const vintiLoro = tuttiISet.filter((s) => s.concluso && s.punti_avversario > s.punti_noi).length + (loro ? 1 : 0);
    const finita = vintiNoi >= 3 || vintiLoro >= 3;

    confermaAzione(
      finita ? "Partita conclusa!" : "Set concluso!",
      `${set.punti_noi} - ${set.punti_avversario} (set ${vintiNoi}-${vintiLoro}). ${finita ? "Chiudere la partita?" : "Passare al prossimo set?"}`,
      finita ? "Chiudi partita" : "Prossimo set",
      async () => {
        try {
          if (finita) { await chiudiMatch(m.id); router.back(); }
          else { await nuovoSet(m.id); router.replace(`/partita/${m.id}/prepara`); }
        } catch (e) { avvisa("Errore", (e as Error).message); }
      },
    );
  }

  const idGiaUscite = new Set(storicoFormazione.filter((r) => !r.in_campo).map((r) => r.athlete_id));
  const inPanchina = atlete.filter((a) => convocateIds.includes(a.id) && !formazione.some((f) => f.athlete_id === a.id) && !idGiaUscite.has(a.id));


  function applicaDelta(skill: Skill, esito: Esito | null, segno: 1 | -1) {
    setSetCorrente((prev) => {
      if (!prev) return prev;
      const avv = skill === "Punto_avversario" || esito === "errore";
      const nostro = skill === "Punto_nostro" || esito === "punto";
      return {
        ...prev,
        punti_avversario: avv ? Math.max(0, prev.punti_avversario + segno) : prev.punti_avversario,
        punti_noi: nostro ? Math.max(0, prev.punti_noi + segno) : prev.punti_noi,
      };
    });
  }

  /** Un tocco passa all'altra variante dello schema (es. da muro diagonale a muro lungo linea). */
  function alternaVariante(fase: FaseSchema) {
    setVarianti((prev) => {
      const nuovo = { ...prev, [fase]: prev[fase] === 1 ? 2 : 1 };
      salvaVarianti(nuovo);
      return nuovo;
    });
  }

  function alternaZone() {
    const nuovo = !zoneAttive;
    setZoneAttive(nuovo);
    salvaZoneAttive(nuovo);
    setZonaInAttesa(null);
  }

  /** Esito scelto: con le zone attive, per battuta e attacco si chiede prima dove e' caduta la palla. */
  function scegliEsito(esito: Esito) {
    if (!skillEff || !atletaEff) return;
    if (zoneAttive && (skillEff === "Servizio" || skillEff === "Attacco")) {
      setZonaInAttesa({ skill: skillEff, esito, athleteId: atletaEff });
      return;
    }
    registra(skillEff, esito, atletaEff);
  }

  function confermaZona(zona: number | null) {
    if (!zonaInAttesa) return;
    const z = zonaInAttesa;
    setZonaInAttesa(null);
    registra(z.skill, z.esito, z.athleteId, null, zona);
  }

  async function registra(skill: Skill, esito: Esito | null, athleteId: string | null, qualita: QualitaRicezione | null = null, zonaArrivo: number | null = null) {
    if (!match || !setCorrente) return;
    setErroreVisibile(null);
    const provvisorio: MatchEvent = {
      id: `temp-${Date.now()}`, match_id: match.id, set_id: setCorrente.id, skill, esito,
      athlete_id: athleteId, creato_il: new Date().toISOString(), creato_da: null, qualita, zona_arrivo: zonaArrivo,
    };
    setEventi((prev) => [provvisorio, ...prev]);
    applicaDelta(skill, esito, 1);
    setSkillSel(null);
    setAtletaSelId(null);
    setMostraTuttiFondamentali(false);

    try {
      const nuovoId = await registraEvento(match.id, setCorrente.id, skill, esito, athleteId, qualita);
      // Zone (solo con la modalita' attiva): l'arrivo e' quello toccato, la partenza dell'attacco e' la posizione di rotazione di chi attacca.
      if (zoneAttive && (skill === "Servizio" || skill === "Attacco")) {
        const partenza = skill === "Attacco" ? (formazione.find((f) => f.athlete_id === athleteId)?.posizione ?? null) : null;
        if (zonaArrivo !== null || partenza !== null) {
          try { await impostaZoneEvento(nuovoId, zonaArrivo, partenza); }
          catch (errZone) { console.warn("Zone non salvate:", (errZone as Error).message); }
        }
      }
      carica();
    } catch (e) {
      const msg = (e as Error).message;
      setEventi((prev) => prev.filter((ev) => ev.id !== provvisorio.id));
      applicaDelta(skill, esito, -1);
      setErroreVisibile(msg);
      avvisa("Evento non salvato", msg);
    }
  }

  async function onAnnulla() {
    if (!match || eventi.length === 0) return;
    const ultimo = eventi[0];
    setEventi((prev) => prev.slice(1));
    applicaDelta(ultimo.skill, ultimo.esito, -1);
    try { await annullaUltimoEvento(match.id); carica(); }
    catch (e) { carica(); avvisa("Errore", (e as Error).message); }
  }

  async function apriSituazione() {
    setPopupSituazione(true);
    setParereAI(null);
    if (match) {
      try { setRotazioni(await rendimentoRotazioniPartita(match.id)); } catch { setRotazioni([]); }
      try { setTurni(await rendimentoTurniServizio(match.id)); } catch { setTurni([]); }
      try { setServizioRicezione(await rendimentoServizioRicezionePartita(match.id)); } catch { setServizioRicezione(null); }
    }
  }

  async function onChiediAI() {
    if (!match || !team || !setCorrente) return;
    setChiedendoAI(true);
    try {
      const riassunto = riassuntoPerAI(eventi, (aid) => etichettaAtleta(aid), `${setCorrente.punti_noi}-${setCorrente.punti_avversario}`);
      const r = await chiediParerePartitaAI(team.id, riassunto);
      if (r.errore) { avvisa("Parere non disponibile", r.messaggio ?? "Errore"); return; }
      setParereAI(r.testo ?? null);
    } finally {
      setChiedendoAI(false);
    }
  }

  function onChiudiPartita() {
    if (!match) return;
    confermaAzione("Chiudere la partita?", "Non potrai più registrare eventi.", "Chiudi", async () => {
      try { await chiudiMatch(match.id); router.back(); } catch (e) { avvisa("Errore", (e as Error).message); }
    }, true);
  }

  /** Un solo passo: si sceglie chi entra e il cambio parte subito, senza una fase intermedia da confermare a parte. */
  async function onSceglieCambio(entrante: Athlete) {
    if (!setCorrente || !atletaSelId) return;
    setPopupCambio(false);
    try {
      await cambiaGiocatore(setCorrente.id, atletaSelId, entrante.id);
      setAtletaSelId(null);
      carica();
    } catch (e) { avvisa("Cambio non riuscito", (e as Error).message); }
  }

  // Liberi indicati nella distinta di questa partita (possono essere più di uno).
  const liberiDisponibili = atlete.filter((a) => liberiIds.has(a.id) && convocateIds.includes(a.id));

  /** Da browser ricarica proprio la pagina (utile per prendere la versione nuova dell'app); da app rilegge i dati della partita. */
  function ricaricaPagina() {
    const g = globalThis as any;
    if (g.location && typeof g.location.reload === "function") { g.location.reload(); return; }
    carica();
  }

  function chiudiPopupLibero() {
    setPopupLibero(false);
    setTitolareLiberoScelto(null);
  }

  async function faiEntrareLibero(liberoId: string, titolareId: string) {
    if (!setCorrente) return;
    try {
      await rimpiazzaConLibero(setCorrente.id, liberoId, titolareId);
      chiudiPopupLibero();
      carica();
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  /** Il Libero in campo esce e rientra la giocatrice che aveva rimpiazzato. */
  async function liberoLasciaIlCampo() {
    if (!setCorrente) return;
    try {
      await faiUscireLibero(setCorrente.id);
      setPopupCambioLibero(false);
      setAtletaSelId(null);
      carica();
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  /** Cambio fra Liberi: esce quello in campo (rientra la titolare) ed entra l'altro nella stessa posizione. */
  async function cambiaLiberoInCampo(nuovoLiberoId: string) {
    if (!setCorrente || !libero) return;
    const titolareId = libero.titolare_id;
    try {
      await faiUscireLibero(setCorrente.id);
      await rimpiazzaConLibero(setCorrente.id, nuovoLiberoId, titolareId);
      setPopupCambioLibero(false);
      setAtletaSelId(null);
      carica();
    } catch (e) {
      carica();
      avvisa("Cambio del Libero non riuscito", (e as Error).message);
    }
  }

  /** Con un solo Libero in distinta entra subito; con due o più si chiede quale, invece di sceglierne uno a caso. */
  function onSceglieUscenteLibero(titolareId: string) {
    if (liberiDisponibili.length === 0) { avvisa("Nessun Libero", "Nessuno è indicato come Libero nella distinta di questa partita."); return; }
    if (liberiDisponibili.length === 1) { faiEntrareLibero(liberiDisponibili[0].id, titolareId); return; }
    setTitolareLiberoScelto(titolareId);
  }

  if (modoOspite && erroreOspite && (!match || match.stato !== "in_corso" || erroreOspite === "Permesso negato")) {
    return (
      <View style={[styles.contenitore, { alignItems: "center", justifyContent: "center", gap: 16 }]}>
        <Text style={styles.vuoto}>
          {erroreOspite === "Permesso negato"
            ? "Accesso terminato: la partita non è più in corso oppure non sei più abilitato."
            : `Impossibile aggiornare la partita: ${erroreOspite}`}
        </Text>
        <Pressable style={styles.bottoneSecondario} onPress={() => router.replace("/ospite")}>
          <Text style={styles.bottoneSecondarioTesto}>Torna alle tue partite</Text>
        </Pressable>
      </View>
    );
  }

  if (!match) return <View style={styles.contenitore}><Text style={styles.vuoto}>Caricamento…</Text></View>;

  if (match.stato !== "in_corso") {
    return (
      <View style={[styles.contenitore, { alignItems: "center", justifyContent: "center", gap: 16 }]}>
        <Text style={styles.vuoto}>{match.stato === "conclusa" ? "Partita conclusa." : "Partita non ancora iniziata."}</Text>
        {puoScrivere && match.stato === "programmata" && (
          <Pressable style={styles.bottoneSecondario} onPress={() => router.push(`/partita/${match.id}/prepara`)}>
            <Text style={styles.bottoneSecondarioTesto}>Vai alla preparazione</Text>
          </Pressable>
        )}
        {modoOspite && (
          <Pressable style={styles.bottoneSecondario} onPress={() => router.replace("/ospite")}>
            <Text style={styles.bottoneSecondarioTesto}>Torna alle tue partite</Text>
          </Pressable>
        )}
        {match.stato === "conclusa" && !modoOspite && (
          <Pressable style={styles.bottoneSecondario} onPress={apriSituazione}>
            <Text style={styles.bottoneSecondarioTesto}>Vedi analisi rotazioni</Text>
          </Pressable>
        )}
        <ModaleSituazione />
      </View>
    );
  }

  if (!setCorrente) return <View style={styles.contenitore}><Text style={styles.vuoto}>Caricamento set…</Text></View>;

  const skills = modalitaEssenziale ? skillsScoutingEssenziali : skillsScouting;
  const selezionata = atletaSelId ? nomeAtleta(atletaSelId) : null;
  const noiAlServizio = setCorrente.squadra_al_servizio === "noi";
  const alServizio = noiAlServizio ? formazione.find((f) => f.posizione === 1) : null;
  const timeoutSet = timeouts.filter((t) => t.set_id === setCorrente.id);
  const timeoutNoi = timeoutSet.filter((t) => t.squadra === "noi").length;
  const timeoutLoro = timeoutSet.filter((t) => t.squadra === "avversario").length;
  // Serie avversaria in corso: avviso se non abbiamo gia' chiamato time-out durante la serie.
  const serieAvversaria = serieAvversariaInCorso(eventi, setCorrente.id);
  const inizioSerieAvv = setCorrente.punti_avversario - serieAvversaria;
  const timeoutDuranteSerie = timeoutSet.some((t) => t.squadra === "noi" && t.punti_avversario > inizioSerieAvv);
  const avvisoSerie = serieAvversaria >= SOGLIA_SERIE_AVVERSARIA && !timeoutDuranteSerie;

  // --- Scambio in corso: cosa puo' succedere adesso -------------------
  // L'ultima azione di gioco dopo l'ultimo punto dice cosa viene dopo:
  // a inizio scambio, se serviamo noi la prima azione e' il nostro
  // servizio (di chi e' in posizione 1), altrimenti e' la nostra
  // ricezione. Durante lo scambio un servizio o una ricezione non
  // possono ripetersi: si propongono solo i fondamentali plausibili.
  const FONDAMENTALI_DI_GIOCO: string[] = ["Servizio", "Ricezione", "Attacco", "Muro", "Difesa"];
  let ultimaAzioneScambio: MatchEvent | null = null;
  for (const e of eventi) {
    if (e.set_id !== setCorrente.id) continue;
    if (chiHaSegnato(e.skill, e.esito) !== null) break;
    if (FONDAMENTALI_DI_GIOCO.includes(e.skill)) { ultimaAzioneScambio = e; break; }
  }
  const inizioScambio = ultimaAzioneScambio === null;
  const possibili: string[] = inizioScambio
    ? [noiAlServizio ? "Servizio" : "Ricezione"]
    : ultimaAzioneScambio!.skill === "Servizio" ? ["Muro", "Difesa", "Attacco"]
    : ultimaAzioneScambio!.skill === "Ricezione" ? ["Attacco"]
    : ultimaAzioneScambio!.skill === "Attacco" ? ["Difesa", "Muro", "Attacco"]
    : ultimaAzioneScambio!.skill === "Muro" ? ["Difesa", "Attacco"]
    : ["Attacco", "Difesa"];
  // Con la modalita' essenziale alcuni fondamentali non ci sono: restano quelli disponibili, nell'ordine di probabilita'.
  const skillsPossibili = possibili.map((n) => skills.find((x) => x.skill === n)).filter((x): x is (typeof skills)[number] => !!x);
  const skillsDaMostrare = mostraTuttiFondamentali || skillsPossibili.length === 0 ? skills : skillsPossibili;
  const skillAuto = !mostraTuttiFondamentali && skillsPossibili.length === 1 ? skillsPossibili[0].skill : null;
  // A inizio scambio, se serviamo noi, a battere e' per forza chi e' in posizione 1.
  const atletaAuto = inizioScambio && noiAlServizio && alServizio ? alServizio.athlete_id : null;
  const atletaEff = atletaSelId ?? atletaAuto;
  const skillEff: Skill | null = skillSel ?? skillAuto;
  const passo: Passo = !atletaEff ? "giocatrice" : !skillEff ? "fondamentale" : zonaInAttesa ? "zona" : "esito";
  const nomeEff = atletaEff ? etichettaAtleta(atletaEff) : "";

  // --- Schema di gioco della fase ------------------------------------
  // Le giocatrici sono disegnate nella ZONA in cui stanno davvero in
  // questa fase (ricezione, difesa, copertura) secondo lo schema della
  // squadra; "posizione" resta quella di rotazione, usata dal database.
  const rotazioneAttuale = rotazioneDaFormazione(formazione, (id) => nomeAtleta(id)?.ruolo_campo ?? null);
  const faseSchema = faseDelloScambio(ultimaAzioneScambio ? ultimaAzioneScambio.skill : null, noiAlServizio);
  // Il tocco sull'etichetta alterna le due varianti dello schema (ricezione e copertura); la difesa ha un solo schema.
  const faseCambiabile: FaseSchema | null = faseSchema && faseSchema !== "difesa" ? faseSchema : null;
  const varianteDi = (f: FaseSchema) => (f === "difesa" ? 1 : varianti[f]);
  const nomeVariante = faseCambiabile ? VARIANTI_SCHEMA[faseCambiabile][varianteDi(faseCambiabile) - 1] : "";
  // Difesa e copertura: un solo schema per variante, per ruolo e linea (nessuna scelta da fare durante lo scambio).
  const zonaSchema = ZONA_PREDEFINITA;
  const perZona = faseConZona(faseSchema);
  const indiceFase = faseSchema ? indiceSchema(faseSchema, rotazioneAttuale, zonaSchema) : null;
  const schemaFase = faseSchema && indiceFase ? schemi[chiaveSchema(faseSchema, varianteDi(faseSchema), indiceFase)] : undefined;
  const nomeFase = faseSchema ? FASI_SCHEMA.find((x) => x.fase === faseSchema)?.etichetta : null;
  const testoFase = faseSchema
    ? `${nomeFase}${faseCambiabile ? ` · ${nomeVariante}` : ""}${!perZona && rotazioneAttuale ? ` · rot. ${rotazioneAttuale}` : ""}${schemaFase ? "" : " (base)"}${faseCambiabile ? " ⇄" : ""}`
    : null;
  const etichettaFase = testoFase ? (
    faseCambiabile ? (
      <Pressable onPress={() => alternaVariante(faseCambiabile)} style={styles.tastoFase}>
        <Text style={styles.etichettaFase} numberOfLines={1}>{testoFase}</Text>
      </Pressable>
    ) : (
      <View style={styles.tastoFase}><Text style={styles.etichettaFase} numberOfLines={1}>{testoFase}</Text></View>
    )
  ) : null;

  // Un pallino per giocatrice, nel punto dello schema scelto per questa fase.
  const pallini: Pallino[] = formazione.filter((f) => (f.posizione ?? 0) > 0).map((f) => {
    const a = nomeAtleta(f.athlete_id);
    // In difesa e copertura il punto dipende dal ruolo e dalla linea; in ricezione dalla posizione di rotazione.
    const slotSchema = perZona && rotazioneAttuale ? puntoRuoloLinea(f.posizione ?? 0, rotazioneAttuale) : f.posizione ?? 0;
    const pt = puntoDiPosizione(schemaFase, slotSchema);
    return {
      chiave: f.athlete_id,
      x: pt.x,
      y: pt.y,
      etichetta: a?.numero_maglia != null ? String(a.numero_maglia) : "–",
      sotto: a?.cognome ?? "?",
      attivo: atletaEff === f.athlete_id,
      accento: a?.ruolo_campo === "Libero",
    };
  });

  function ModaleSituazione() {
    const segnalazioni: SegnalazioneSituazione[] = analizzaSituazione(eventi, (aid) => etichettaAtleta(aid));
    return (
      <Modal visible={popupSituazione} animationType="slide" transparent onRequestClose={() => setPopupSituazione(false)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <View style={styles.intestazionePopup}>
              <Text style={styles.titoloPopup}>Come stiamo andando</Text>
              <Pressable onPress={() => setPopupSituazione(false)} hitSlop={12}><Text style={styles.chiudiPopup}>✕</Text></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ gap: 10 }}>
              {segnalazioni.map((s, i) => (
                <Text key={i} style={[styles.segnalazione, s.gravita === "attenzione" && styles.segnalazioneAttenzione]}>
                  {s.gravita === "attenzione" ? "⚠ " : "• "}{s.testo}
                </Text>
              ))}

              <Text style={styles.titoloSezionePopup}>Rendimento per rotazione</Text>
              {rotazioni.length === 0 ? (
                <Text style={styles.nota}>Nessun dato per rotazione ancora.</Text>
              ) : (
                rotazioni.map((r, i) => (
                  <View key={i} style={styles.rigaRotazione}>
                    <Text style={styles.rigaRotazioneNome}>al servizio {r.rotazione_di}</Text>
                    <Text style={[styles.rigaRotazioneSaldo, r.saldo < 0 && styles.saldoNegativo]}>
                      {r.saldo >= 0 ? "+" : ""}{r.saldo}  ({r.punti_fatti}/{r.errori_commessi})
                    </Text>
                  </View>
                ))
              )}

              <Text style={styles.titoloSezionePopup}>Turni di servizio</Text>
              {turni.length === 0 ? (
                <Text style={styles.nota}>Nessun turno nostro registrato ancora.</Text>
              ) : (
                turni.map((t, i) => (
                  <View key={i} style={styles.rigaRotazione}>
                    <Text style={styles.rigaRotazioneNome}>{t.al_servizio} · {t.turni_giocati} turni</Text>
                    <Text style={styles.rigaRotazioneSaldo}>
                      {t.media_punti_per_turno != null ? Number(t.media_punti_per_turno).toFixed(2) : "—"} pt/turno
                    </Text>
                  </View>
                ))
              )}

              <Text style={styles.titoloSezionePopup}>Side-out % / Break-point %</Text>
              {!servizioRicezione || (servizioRicezione.punti_in_battuta === 0 && servizioRicezione.punti_in_ricezione === 0) ? (
                <Text style={styles.nota}>Nessun dato ancora.</Text>
              ) : (
                <>
                  <View style={styles.rigaRotazione}>
                    <Text style={styles.rigaRotazioneNome}>Break-point (punti vinti in battuta)</Text>
                    <Text style={styles.rigaRotazioneSaldo}>
                      {servizioRicezione.break_point_pct != null ? `${servizioRicezione.break_point_pct}%` : "—"} ({servizioRicezione.punti_vinti_in_battuta}/{servizioRicezione.punti_in_battuta})
                    </Text>
                  </View>
                  <View style={styles.rigaRotazione}>
                    <Text style={styles.rigaRotazioneNome}>Side-out (punti vinti in ricezione)</Text>
                    <Text style={styles.rigaRotazioneSaldo}>
                      {servizioRicezione.side_out_pct != null ? `${servizioRicezione.side_out_pct}%` : "—"} ({servizioRicezione.punti_vinti_in_ricezione}/{servizioRicezione.punti_in_ricezione})
                    </Text>
                  </View>
                  <Text style={styles.nota}>
                    Ricezioni: {servizioRicezione.ricezioni_ottime} perfette, {servizioRicezione.ricezioni_buone} buone, {servizioRicezione.ricezioni_scarse} scarse, {servizioRicezione.ricezioni_errori} errori.
                  </Text>
                </>
              )}

              <Text style={styles.titoloSezionePopup}>Parere dell'assistente</Text>
              {parereAI ? (
                <Text style={styles.parere}>{parereAI}</Text>
              ) : (
                <Pressable style={styles.bottoneAI} onPress={onChiediAI} disabled={chiedendoAI}>
                  {chiedendoAI ? <ActivityIndicator color={brand.colors.brandSecondary} /> : <Text style={styles.bottoneAITesto}>✨ Chiedi un parere</Text>}
                </Pressable>
              )}
              <Text style={styles.nota}>Le letture qui sopra sono calcolate in locale e non consumano nulla. Il parere discorsivo parte solo se lo chiedi.</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  }

  const tabelloneJsx = (
    <View style={[styles.tabellone, !orizzontale && styles.tabelloneCompatto]}>
      {/* Le due squadre una sopra l'altra: la palla indica chi serve. */}
      <View style={{ flex: orizzontale ? 1 : undefined, gap: 3 }}>
        <View style={styles.rigaSquadra}>
          <Text style={styles.indicatoreServizio}>{noiAlServizio ? "🏐" : ""}</Text>
          <Text style={[styles.nomeSquadra, noiAlServizio && styles.nomeSquadraAlServizio]} numberOfLines={1}>{(modoOspite ? nomeSquadraOspite : team?.nome) ?? "Noi"}</Text>
        </View>
        <View style={styles.rigaSquadra}>
          <Text style={styles.indicatoreServizio}>{noiAlServizio ? "" : "🏐"}</Text>
          <Text style={[styles.nomeSquadra, !noiAlServizio && styles.nomeSquadraAlServizio]} numberOfLines={1}>{match.avversario}</Text>
        </View>
      </View>
      <View style={{ alignItems: orizzontale ? "flex-end" : "center" }}>
        <Text style={styles.setNumero}>Set {setCorrente.numero_set} · TO {timeoutNoi}-{timeoutLoro}</Text>
        <Text style={[styles.punteggio, { fontSize: orizzontale ? d(26) : 24 }]}>{setCorrente.punti_noi}-{setCorrente.punti_avversario}</Text>
        {!orizzontale && etichettaFase}
        {!orizzontale && (
          <Text style={styles.nota} numberOfLines={1}>
            🏐 {setCorrente.squadra_al_servizio === "noi" ? (alServizio ? etichettaAtleta(alServizio.athlete_id) : "noi") : "loro"}
          </Text>
        )}
      </View>
    </View>
  );

  return (
    <View style={[styles.contenitore, { flexDirection: orizzontale ? "row" : "column" }]}>
      <View style={[styles.colonnaCampo, orizzontale ? { width: latoCampo + LARGHEZZA_TASTO_LIBERO + 6 } : { width: "100%", alignItems: "center" }]}>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "stretch", width: orizzontale ? undefined : "100%" }}>
        {puoScoutare && (
          <Pressable onPress={() => setPopupLibero(true)} style={[styles.tastoLibero, { width: LARGHEZZA_TASTO_LIBERO }, libero && styles.tastoPiccoloAttivo]}>
            <Text style={[styles.tastoPiccoloTesto, libero && styles.tastoPiccoloTestoAttivo]}>{libero ? "L ✓" : "Libero"}</Text>
          </Pressable>
        )}
        <View style={{ width: latoCampo, height: latoCampo }}>
          <CampoPallini
            pallini={pallini}
            onTapPallino={(athleteId) => {
              const riga = formazione.find((f) => f.athlete_id === athleteId);
              if (!riga) return;
              // Secondo tocco sulla stessa persona: apre il cambio.
              // Evita un pulsante dedicato e ricalca il gesto naturale.
              if (atletaSelId === riga.athlete_id) {
                if (libero && libero.libero_id === riga.athlete_id) setPopupCambioLibero(true);
                else setPopupCambio(true);
                return;
              }
              setZonaInAttesa(null);
              setAtletaSelId(riga.athlete_id);
              setSkillSel(null);
            }}
          />
        </View>
        {!orizzontale && <View style={{ flex: 1 }}>{tabelloneJsx}</View>}
        </View>
        {orizzontale && etichettaFase}
        {orizzontale && (
          <Text style={styles.nota} numberOfLines={1}>
            servizio: {setCorrente.squadra_al_servizio === "noi" ? (alServizio ? etichettaAtleta(alServizio.athlete_id) : "noi") : "loro"}
          </Text>
        )}
      </View>

      <View style={[styles.colonnaComandi, orizzontale ? { flex: 1 } : { flex: 1, width: "100%" }]}>
        {orizzontale && tabelloneJsx}

        {puoScoutare && avvisoSerie && (
          <Pressable style={styles.bannerSerie} onPress={() => setPopupTimeout(true)}>
            <Text style={styles.bannerSerieTesto}>⚠ Serie avversaria: {serieAvversaria} punti di fila — valuta un time-out (tocca per chiamarlo)</Text>
          </Pressable>
        )}

        {erroreVisibile && (
          <Pressable style={styles.bannerErrore} onPress={() => setErroreVisibile(null)}>
            <Text style={styles.bannerErroreTesto}>⚠ {erroreVisibile}</Text>
          </Pressable>
        )}

  
        {puoScoutare ? (
          <>
          <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
            <Text style={styles.indicazionePasso}>
              {passo === "giocatrice" && (skillAuto === "Ricezione" ? "Chi ha ricevuto? Tocca la giocatrice" : skillAuto === "Attacco" ? "Chi ha attaccato? Tocca la giocatrice" : skillAuto === "Servizio" ? "Chi ha servito? Tocca la giocatrice" : "1. Tocca chi è in campo")}
              {passo === "fondamentale" && `2. ${nomeEff} — quale fondamentale?`}
              {passo === "esito" && `${skillEff} · ${nomeEff} — com'è andata?`}
              {passo === "zona" && "4. Dove è caduta la palla? (campo avversario)"}
            </Text>



            {passo === "fondamentale" && (
              <View style={styles.griglia}>
                {skillsDaMostrare.map((s) => (
                  <Pressable key={s.skill} onPress={() => setSkillSel(s.skill)} style={[styles.tastoGriglia, { paddingVertical: d(12) }]}>
                    <Text style={[styles.tastoGrigliaTesto, { fontSize: d(13) }]}>{s.etichetta}</Text>
                  </Pressable>
                ))}
                {!mostraTuttiFondamentali && skillsPossibili.length > 0 && skillsPossibili.length < skills.length && (
                  <Pressable onPress={() => setMostraTuttiFondamentali(true)} style={styles.tastoAnnullaPasso}>
                    <Text style={styles.nota}>Altro fondamentale…</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => { setAtletaSelId(null); setSkillSel(null); }} style={styles.tastoAnnullaPasso}>
                  <Text style={styles.nota}>← cambia giocatrice</Text>
                </Pressable>
              </View>
            )}

            {passo === "esito" && skillEff && (skillEff === "Ricezione" || skillEff === "Difesa") && (
              // Griglia 2x2 invece dei 3 pulsanti impilati: ricezione e difesa
              // non possono mai valere "punto" con le regole standard, quindi
              // il bucket "neutro" si apre in una scala di qualità
              // (standard di scouting pro: quante opzioni d'attacco resi
              // disponibili). 4 pulsanti in griglia sono più bassi dei 3
              // impilati di prima: resta tutto in una sola schermata.
              <>
                <View style={styles.griglia}>
                  <Pressable style={[styles.tastoEsitoGriglia, styles.esitoOttima, { paddingVertical: d(12) }]} onPress={() => registra(skillEff, "neutro", atletaEff, "ottima")}>
                    <Text style={[styles.tastoEsitoTesto, { fontSize: d(13) }]}>Perfetta</Text>
                  </Pressable>
                  <Pressable style={[styles.tastoEsitoGriglia, styles.esitoBuona, { paddingVertical: d(12) }]} onPress={() => registra(skillEff, "neutro", atletaEff, "buona")}>
                    <Text style={[styles.tastoEsitoTesto, { fontSize: d(13) }]}>Buona</Text>
                  </Pressable>
                  <Pressable style={[styles.tastoEsitoGriglia, styles.esitoScarsaRic, { paddingVertical: d(12) }]} onPress={() => registra(skillEff, "neutro", atletaEff, "scarsa")}>
                    <Text style={[styles.tastoEsitoTesto, { fontSize: d(13) }]}>Scarsa</Text>
                  </Pressable>
                  <Pressable style={[styles.tastoEsitoGriglia, styles.esitoErrore, { paddingVertical: d(12) }]} onPress={() => registra(skillEff, "errore", atletaEff)}>
                    <Text style={[styles.tastoEsitoTesto, { fontSize: d(13) }]}>Errore</Text>
                  </Pressable>
                </View>
                <Pressable onPress={() => { setSkillSel(null); setMostraTuttiFondamentali(true); }} style={styles.tastoAnnullaPasso}>
                  <Text style={styles.nota}>← altro fondamentale</Text>
                </Pressable>
              </>
            )}

            {passo === "esito" && skillEff && skillEff !== "Ricezione" && skillEff !== "Difesa" && (
              <>
                <View style={{ flexDirection: "row", gap: 6 }}>
                {/* Una difesa non puo' essere "punto": il punto lo fa l'attacco che segue. */}
                {skillEff !== "Difesa" && (
                  <Pressable style={[styles.tastoEsito, { flex: 1 }, styles.esitoPunto, { paddingVertical: d(14) }]} onPress={() => scegliEsito("punto")}>
                    <Text style={[styles.tastoEsitoTesto, { fontSize: d(15) }]}>Punto</Text>
                  </Pressable>
                )}
                <Pressable style={[styles.tastoEsito, { flex: 1 }, styles.esitoNeutro, { paddingVertical: d(14) }]} onPress={() => scegliEsito("neutro")}>
                  <Text style={[styles.tastoEsitoTesto, { fontSize: d(15) }]}>Neutro</Text>
                </Pressable>
                <Pressable style={[styles.tastoEsito, { flex: 1 }, styles.esitoErrore, { paddingVertical: d(14) }]} onPress={() => scegliEsito("errore")}>
                  <Text style={[styles.tastoEsitoTesto, { fontSize: d(15) }]}>Errore</Text>
                </Pressable>
                </View>
                <Pressable onPress={() => { setSkillSel(null); setMostraTuttiFondamentali(true); }} style={styles.tastoAnnullaPasso}>
                  <Text style={styles.nota}>← altro fondamentale</Text>
                </Pressable>
              </>
            )}

            {passo === "zona" && zonaInAttesa && (
              <>
                <SelettoreZona altezzaRiga={d(38)} onScegli={(z) => confermaZona(z)} />
                <Pressable onPress={() => confermaZona(null)} style={styles.tastoAnnullaPasso}>
                  <Text style={styles.nota}>Salta (non so la zona)</Text>
                </Pressable>
                <Pressable onPress={() => setZonaInAttesa(null)} style={styles.tastoAnnullaPasso}>
                  <Text style={styles.nota}>← cambia esito</Text>
                </Pressable>
              </>
            )}

          </ScrollView>

          {/* Barra fissa: questi comandi devono restare sempre
              raggiungibili, qualunque passo sia attivo e qualunque sia
              l'orientamento. */}
          <View style={styles.zonaFissa}>
            <View style={styles.rigaPuntiDiretti}>
              <Pressable style={[styles.bottonePuntoNostro, { paddingVertical: d(8) }]} onPress={() => registra("Punto_nostro", null, null)}>
                <Text style={styles.bottonePuntoNostroTesto}>+1 NOI</Text>
                <Text style={styles.sottoPulsante}>errore loro</Text>
              </Pressable>
              <Pressable style={[styles.bottonePuntoAvversario, { paddingVertical: d(8) }]} onPress={() => registra("Punto_avversario", null, null)}>
                <Text style={styles.bottonePuntoAvversarioTesto}>+1 LORO</Text>
                <Text style={styles.sottoPulsante}>errore nostro</Text>
              </Pressable>
            </View>

            <View style={styles.rigaComandiFissi}>
              {!modoOspite && (
                <Pressable onPress={apriSituazione} style={styles.tastoPiccolo}>
                  <Text style={styles.tastoPiccoloTesto}>📊 Situazione</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setPopupEventi(true)} style={styles.tastoPiccolo}>
                <Text style={styles.tastoPiccoloTesto}>🕑 Ultime {Math.min(eventi.length, AZIONI_RECENTI_MOSTRATE)}</Text>
              </Pressable>
              <Pressable onPress={() => setPopupTimeout(true)} style={styles.tastoPiccolo}>
                <Text style={styles.tastoPiccoloTesto}>⏱ TO</Text>
              </Pressable>
              <Pressable onPress={ricaricaPagina} style={styles.tastoPiccolo} accessibilityLabel="Ricarica la pagina">
                <Text style={styles.tastoPiccoloTesto}>🔄</Text>
              </Pressable>
              <Pressable onPress={alternaZone} style={[styles.tastoPiccolo, zoneAttive && styles.tastoPiccoloAttivo]}>
                <Text style={[styles.tastoPiccoloTesto, zoneAttive && styles.tastoPiccoloTestoAttivo]}>🎯 Zone {zoneAttive ? "ON" : "off"}</Text>
              </Pressable>
              <Pressable onPress={() => setModalitaEssenziale((v) => !v)} style={[styles.tastoPiccolo, modalitaEssenziale && styles.tastoPiccoloAttivo]}>
                <Text style={[styles.tastoPiccoloTesto, modalitaEssenziale && styles.tastoPiccoloTestoAttivo]}>⚡ Essenziale {modalitaEssenziale ? "ON" : "off"}</Text>
              </Pressable>
            </View>

            {puoScrivere && (
              <View style={styles.rigaComandiFissi}>
                <Pressable
                  style={styles.tastoPiccolo}
                  onPress={async () => {
                    try { await nuovoSet(match.id); router.replace(`/partita/${match.id}/prepara`); }
                    catch (e) { avvisa("Errore", (e as Error).message); }
                  }}
                >
                  <Text style={styles.tastoPiccoloTesto}>Nuovo set</Text>
                </Pressable>
                <Pressable onPress={onChiudiPartita} style={styles.tastoPiccoloDistruttivo}>
                  <Text style={styles.tastoPiccoloDistruttivoTesto}>Chiudi partita</Text>
                </Pressable>
              </View>
            )}
          </View>
          </>
        ) : (
          <>
            <Text style={styles.nota}>Consultazione in sola lettura.</Text>
            <Pressable onPress={ricaricaPagina} style={styles.tastoPiccolo}>
              <Text style={styles.tastoPiccoloTesto}>🔄 Ricarica</Text>
            </Pressable>
          </>
        )}
      </View>

      <Modal visible={popupCambio} animationType="slide" transparent onRequestClose={() => setPopupCambio(false)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <View style={styles.intestazionePopup}>
              <Text style={styles.titoloPopup}>Chi entra per {selezionata?.cognome}?</Text>
              <Pressable onPress={() => setPopupCambio(false)} hitSlop={12}><Text style={styles.chiudiPopup}>✕</Text></Pressable>
            </View>
            <FlatList
              data={inPanchina}
              keyExtractor={(a) => a.id}
              ListEmptyComponent={<Text style={styles.nota}>Nessuna convocata disponibile.</Text>}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.rigaScelta}
                  onPress={() => onSceglieCambio(item)}
                >
                  <Text style={styles.rigaSceltaTesto}>#{item.numero_maglia ?? "-"} {item.nome} {item.cognome}</Text>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={popupTimeout} animationType="slide" transparent onRequestClose={() => setPopupTimeout(false)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <View style={styles.intestazionePopup}>
              <Text style={styles.titoloPopup}>Time-out — set {setCorrente.numero_set}</Text>
              <Pressable onPress={() => setPopupTimeout(false)} hitSlop={12}><Text style={styles.chiudiPopup}>✕</Text></Pressable>
            </View>
            <Text style={styles.nota}>
              Punteggio {setCorrente.punti_noi}-{setCorrente.punti_avversario}. Chiamati finora: noi {timeoutNoi}, loro {timeoutLoro} (di norma 2 per squadra a set).
            </Text>
            <Pressable
              style={styles.rigaScelta}
              onPress={async () => {
                try { await registraTimeout(setCorrente.id, "noi"); setPopupTimeout(false); carica(); }
                catch (e) { avvisa("Time-out non registrato", (e as Error).message); }
              }}
            >
              <Text style={styles.rigaSceltaTesto}>⏱ Time-out NOSTRO{timeoutNoi >= 2 ? " (già 2 chiamati)" : ""}</Text>
            </Pressable>
            <Pressable
              style={styles.rigaScelta}
              onPress={async () => {
                try { await registraTimeout(setCorrente.id, "avversario"); setPopupTimeout(false); carica(); }
                catch (e) { avvisa("Time-out non registrato", (e as Error).message); }
              }}
            >
              <Text style={styles.rigaSceltaTesto}>⏱ Time-out LORO{timeoutLoro >= 2 ? " (già 2 chiamati)" : ""}</Text>
            </Pressable>
            {timeoutSet.length > 0 && (
              <Pressable
                onPress={async () => {
                  try { await annullaUltimoTimeout(setCorrente.id); carica(); }
                  catch (e) { avvisa("Impossibile annullare", (e as Error).message); }
                }}
              >
                <Text style={styles.chiudiPopup}>↩ Annulla l'ultimo time-out registrato</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={popupEventi} animationType="slide" transparent onRequestClose={() => setPopupEventi(false)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <View style={styles.intestazionePopup}>
              <Text style={styles.titoloPopup}>Ultime azioni</Text>
              <Pressable onPress={() => setPopupEventi(false)} hitSlop={12}><Text style={styles.chiudiPopup}>✕</Text></Pressable>
            </View>
            <FlatList
              data={eventi.slice(0, AZIONI_RECENTI_MOSTRATE)}
              keyExtractor={(e) => e.id}
              ListEmptyComponent={<Text style={styles.nota}>Nessun evento registrato.</Text>}
              renderItem={({ item }) => (
                <Text style={styles.rigaLog}>
                  {new Date(item.creato_il).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })} · {item.skill === "Punto_avversario" ? "Punto avversario" : `${item.skill} ${item.esito}`}
                  {item.athlete_id ? ` · ${etichettaAtleta(item.athlete_id)}` : ""}
                  {item.zona_partenza ? ` · da z${item.zona_partenza}` : ""}{item.zona_arrivo ? ` → z${item.zona_arrivo}` : ""}
                </Text>
              )}
            />
            <Pressable style={styles.bottoneSecondario} onPress={() => { setPopupEventi(false); onAnnulla(); }} disabled={eventi.length === 0}>
              <Text style={styles.bottoneSecondarioTesto}>↺ Annulla l'ultimo</Text>
            </Pressable>
          </View>
        </View>
      </Modal>


      <Modal visible={popupCambioLibero} animationType="fade" transparent onRequestClose={() => setPopupCambioLibero(false)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <View style={styles.intestazionePopup}>
              <Text style={styles.titoloPopup}>{libero ? `Libero ${etichettaAtleta(libero.libero_id)}` : "Libero"}</Text>
              <Pressable onPress={() => setPopupCambioLibero(false)} hitSlop={12}><Text style={styles.chiudiPopup}>✕</Text></Pressable>
            </View>
            {libero ? (
              <>
                <Pressable style={styles.rigaScelta} onPress={liberoLasciaIlCampo}>
                  <Text style={styles.rigaSceltaTesto}>Rientra {etichettaAtleta(libero.titolare_id)}</Text>
                </Pressable>
                {liberiDisponibili.filter((l) => l.id !== libero.libero_id).map((l) => (
                  <Pressable key={l.id} style={styles.rigaScelta} onPress={() => cambiaLiberoInCampo(l.id)}>
                    <Text style={styles.rigaSceltaTesto}>Entra il Libero #{l.numero_maglia ?? "-"} {l.nome} {l.cognome}</Text>
                  </Pressable>
                ))}
                <Text style={styles.nota}>Il Libero non conta come sostituzione: puoi alternarlo quante volte vuoi.</Text>
              </>
            ) : (
              <Text style={styles.nota}>Nessun Libero in campo.</Text>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={popupLibero} animationType="fade" transparent onRequestClose={chiudiPopupLibero}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <View style={styles.intestazionePopup}>
              <Text style={styles.titoloPopup}>Libero</Text>
              <Pressable onPress={chiudiPopupLibero} hitSlop={12}><Text style={styles.chiudiPopup}>✕</Text></Pressable>
            </View>

            {libero ? (
              <>
                <Text style={styles.nota}>
                  In campo: {etichettaAtleta(libero.libero_id)} al posto di {etichettaAtleta(libero.titolare_id)}
                  {libero.posizione ? ` (posizione ${libero.posizione})` : ""}.
                </Text>
                <Text style={styles.nota}>
                  Esce da solo quando la rotazione lo porta in prima linea, e rientra chi aveva rimpiazzato.
                </Text>
                <Pressable
                  style={styles.bottoneSecondario}
                  onPress={async () => {
                    if (!setCorrente) return;
                    try { await faiUscireLibero(setCorrente.id); setPopupLibero(false); carica(); }
                    catch (e) { avvisa("Errore", (e as Error).message); }
                  }}
                >
                  <Text style={styles.bottoneSecondarioTesto}>Fai uscire il Libero</Text>
                </Pressable>
              </>
            ) : titolareLiberoScelto ? (
              // Secondo passo, solo se in distinta ci sono più Liberi:
              // chi esce è già scelto, ora si sceglie QUALE Libero entra.
              <>
                <Text style={styles.nota}>Quale Libero entra al posto di {etichettaAtleta(titolareLiberoScelto)}?</Text>
                {liberiDisponibili.map((l) => (
                  <Pressable key={l.id} style={styles.rigaScelta} onPress={() => faiEntrareLibero(l.id, titolareLiberoScelto)}>
                    <Text style={styles.rigaSceltaTesto}>#{l.numero_maglia ?? "-"} {l.nome} {l.cognome}</Text>
                  </Pressable>
                ))}
                <Pressable onPress={() => setTitolareLiberoScelto(null)} style={styles.tastoAnnullaPasso}>
                  <Text style={styles.nota}>← cambia chi esce</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.nota}>
                  {noiAlServizio
                    ? "Scegli chi esce per far entrare il Libero. Solo seconda linea (posizioni 5 e 6): ora serviamo noi, quindi la posizione 1 è alla battuta e il Libero non può servire."
                    : "Scegli chi esce per far entrare il Libero. Solo seconda linea (posizioni 5, 6 e 1): serve l'avversario, quindi la posizione 1 è in ricezione e il Libero può entrarci."}
                </Text>
                {/* La posizione 1 è consentita solo quando NON serviamo noi: la regola è la stessa applicata dal database. */}
                {formazione.filter((f) => f.posizione === 5 || f.posizione === 6 || (f.posizione === 1 && !noiAlServizio)).map((f) => (
                  <Pressable key={f.athlete_id} style={styles.rigaScelta} onPress={() => onSceglieUscenteLibero(f.athlete_id)}>
                    <Text style={styles.rigaSceltaTesto}>esce {etichettaAtleta(f.athlete_id)} (posizione {f.posizione})</Text>
                  </Pressable>
                ))}
              </>
            )}
          </View>
        </View>
      </Modal>

      <ModaleSituazione />
    </View>
  );
}

const styles = StyleSheet.create({
  // Riga anziché colonna: garantisce la disposizione "orizzontale"
  // anche quando il telefono è bloccato in verticale.
  contenitore: { flex: 1, backgroundColor: brand.colors.surface, padding: 6, gap: 6 },
  colonnaCampo: { gap: 6 },
  rigaSottoCampo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  colonnaComandi: { gap: 6 },

  tabelloneCompatto: { flexDirection: "column", alignItems: "stretch", justifyContent: "space-around", padding: 6, gap: 4, flex: 1 },
  tabellone: { flexDirection: "row", alignItems: "center", backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, padding: 10, gap: 8 },
  rigaSquadra: { flexDirection: "row", alignItems: "center", gap: 4 },
  // Larghezza fissa anche quando la palla non c'è: i due nomi restano allineati.
  indicatoreServizio: { width: 18, fontSize: 13, textAlign: "center" },
  nomeSquadra: { flex: 1, color: brand.colors.onSurfaceSecondary, fontWeight: "600", fontSize: 13 },
  nomeSquadraAlServizio: { color: brand.colors.onSurface, fontWeight: "800" },
  setNumero: { color: brand.colors.muted, fontSize: 11 },
  punteggio: { color: brand.colors.brand, fontWeight: "800", fontSize: 26 },

  indicazionePasso: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "700" },
  griglia: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tastoGriglia: { flexGrow: 1, minWidth: "46%", backgroundColor: brand.colors.surfaceSecondary, paddingVertical: 16, borderRadius: 10, alignItems: "center" },
  tastoGrigliaTesto: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 13 },
  tastoEsito: { paddingVertical: 18, borderRadius: 10, alignItems: "center" },
  esitoPunto: { backgroundColor: brand.colors.success },
  esitoNeutro: { backgroundColor: brand.colors.surfaceTertiary },
  esitoErrore: { backgroundColor: brand.colors.error },
  tastoEsitoTesto: { color: "#fff", fontWeight: "800", fontSize: 16 },
  // Griglia 2x2 della qualità ricezione: stesso ingombro di tastoGriglia
  // (2 per riga), colorata come tastoEsito.
  tastoEsitoGriglia: { flexGrow: 1, minWidth: "46%", borderRadius: 10, alignItems: "center" },
  esitoOttima: { backgroundColor: brand.colors.success },
  esitoBuona: { backgroundColor: brand.colors.brandSecondary },
  esitoScarsaRic: { backgroundColor: brand.colors.warning },
  tastoAnnullaPasso: { alignItems: "center", paddingVertical: 6 },
  rigaPuntiDiretti: { flexDirection: "row", gap: 6 },
  bottonePuntoNostro: { flex: 1, backgroundColor: brand.colors.success, borderRadius: 10, alignItems: "center" },
  bottonePuntoNostroTesto: { color: "#000", fontWeight: "800", fontSize: 15 },
  bottonePuntoAvversario: { flex: 1, backgroundColor: "#4A1620", borderRadius: 10, alignItems: "center" },
  bottonePuntoAvversarioTesto: { color: "#fff", fontWeight: "800", fontSize: 15 },
  sottoPulsante: { color: "rgba(255,255,255,0.7)", fontSize: 10 },

  rigaComandiSecondari: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  rigaComandiFissi: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  rigaToggleFisso: { flexDirection: "row", alignItems: "center", gap: 2 },
  zonaFissa: { gap: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: brand.colors.border },
  barraFissa: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  bottoneDistruttivo: { borderColor: brand.colors.error, borderWidth: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  bottoneDistruttivoTesto: { color: brand.colors.error, fontWeight: "700" },
  tastoLibero: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  tastoPiccolo: { flexGrow: 1, backgroundColor: brand.colors.surfaceSecondary, paddingVertical: 6, paddingHorizontal: 6, borderRadius: 8, alignItems: "center", minHeight: 34, justifyContent: "center" },
  tastoPiccoloAttivo: { backgroundColor: brand.colors.brand },
  tastoPiccoloTestoAttivo: { color: "#000", fontWeight: "800" },
  tastoPiccoloTesto: { color: brand.colors.onSurface, fontWeight: "600", fontSize: 12 },
  tastoPiccoloDistruttivo: { flexGrow: 1, borderColor: brand.colors.error, borderWidth: 1, paddingVertical: 6, borderRadius: 8, alignItems: "center", minHeight: 34, justifyContent: "center" },
  tastoPiccoloDistruttivoTesto: { color: brand.colors.error, fontWeight: "600", fontSize: 12 },

  rigaToggle: { flexDirection: "row", alignItems: "center", gap: 4 },
  nota: { color: brand.colors.muted, fontSize: 11 },
  rigaZoneSchema: { flexDirection: "row", alignItems: "center", gap: 4, justifyContent: "center", paddingTop: 2 },
  etichettaZoneSchema: { color: brand.colors.muted, fontSize: 10, fontWeight: "700" },
  tastoZonaSchema: { minWidth: 30, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  tastoZonaSchemaAttivo: { backgroundColor: brand.colors.brand },
  testoZonaSchema: { color: brand.colors.onSurfaceSecondary, fontSize: 13, fontWeight: "700" },
  testoZonaSchemaAttivo: { color: "#000" },
  tastoFase: { paddingVertical: 4, paddingHorizontal: 4, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.06)", minHeight: 28, justifyContent: "center" },
  etichettaFase: { color: brand.colors.brandSecondary, fontSize: 11, fontWeight: "700", textAlign: "center" },
  etichettaLog: { color: brand.colors.muted, fontSize: 10, textTransform: "uppercase", marginTop: 4 },
  rigaLog: { color: brand.colors.onSurfaceSecondary, fontSize: 11, paddingVertical: 2 },
  bannerSerie: { backgroundColor: "rgba(255,215,0,0.15)", borderColor: brand.colors.warning, borderWidth: 1, borderRadius: 8, padding: 8 },
  bannerSerieTesto: { color: brand.colors.warning, fontSize: 12, fontWeight: "700" },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },

  bannerErrore: { backgroundColor: "#4A1620", borderRadius: 8, padding: 8 },
  bannerErroreTesto: { color: "#fff", fontSize: 11 },

  bottoneSecondario: { borderColor: brand.colors.brand, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "600" },

  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 20 },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 16, gap: 10, maxHeight: "90%" },
  intestazionePopup: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  titoloSezionePopup: { color: brand.colors.brandSecondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", marginTop: 6 },
  chiudiPopup: { color: brand.colors.muted, fontSize: 18 },
  segnalazione: { color: brand.colors.onSurface, fontSize: 13, lineHeight: 19 },
  segnalazioneAttenzione: { color: brand.colors.warning, fontWeight: "600" },
  rigaRotazione: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaRotazioneNome: { color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  rigaRotazioneSaldo: { color: brand.colors.success, fontSize: 12, fontWeight: "700" },
  saldoNegativo: { color: brand.colors.error },
  parere: { color: brand.colors.onSurface, fontSize: 13, lineHeight: 20 },
  bottoneAI: { borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  bottoneAITesto: { color: brand.colors.brandSecondary, fontWeight: "700" },
  rigaScelta: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaSceltaTesto: { color: brand.colors.onSurface, fontSize: 14 },
});
