import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import {
  analisiFondamentaliPartita, analisiPersoneDettaglioPartita, analisiZonePartita, analisiPersonePartita, andamentoPersonePartite, andamentoTraPartite,
  elencaEventiPerAndamento, elencaPartite, elencaSet, elencaTimeout, rendimentoServizioRicezionePartita,
  type AnalisiFondamentale, type AnalisiPersona, type AnalisiPersonaFondamentale, type AnalisiZona, type AndamentoPartita, type AndamentoPersonaPartita,
  type EventoAndamento, type MatchTimeout, type RendimentoServizioRicezione,
} from "@/src/services/matches";
import { GrigliaZone, type ValoreZona } from "@/src/components/ZoneCampo";
import { GraficoAndamentoSet } from "@/src/components/GraficoAndamentoSet";
import { costruisciAndamentoPerSet, seriePiuLunghe } from "@/src/lib/andamentoPunti";
import { calcolaVoti, coloreVoto, MIN_AZIONI_VOTO } from "@/src/lib/votiPartita";
import { costruisciRivivi } from "@/src/lib/rivivi";
import { esportaCsv, stampaScheda, type SchedaPartita } from "@/src/lib/esportaPartita";
import { supabaseClient } from "@/src/lib/supabase";
import { avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import type { Match, MatchSet } from "@/src/types/database";

/**
 * Analisi ricca di una partita (F4): non solo il punteggio, ma dove
 * si vince e si perde davvero. L'efficienza (punti meno errori sulle
 * azioni) è la misura che conta in uno scouting reale — dice quanto
 * un fondamentale RENDE, non solo quante volte è stato usato.
 */
export default function AnalisiPartita() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { team } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const [fondamentali, setFondamentali] = useState<AnalisiFondamentale[]>([]);
  const [persone, setPersone] = useState<AnalisiPersona[]>([]);
  // Dettaglio per fondamentale, raggruppato per giocatore; vuoto se non disponibile.
  const [dettaglio, setDettaglio] = useState<Record<string, AnalisiPersonaFondamentale[]>>({});
  const [aperti, setAperti] = useState<Set<string>>(new Set());
  const [andamento, setAndamento] = useState<AndamentoPartita[]>([]);
  const [servizioRicezione, setServizioRicezione] = useState<RendimentoServizioRicezione | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  // Andamento punto a punto, time-out, storico con lo stesso avversario, trend dei giocatori.
  const [setGiocati, setSetGiocati] = useState<MatchSet[]>([]);
  const [eventiAndamento, setEventiAndamento] = useState<EventoAndamento[]>([]);
  const [timeouts, setTimeouts] = useState<MatchTimeout[]>([]);
  const [partiteSquadra, setPartiteSquadra] = useState<Match[]>([]);
  const [zone, setZone] = useState<AnalisiZona[]>([]);
  // Per l'attacco si puo' guardare dove e' caduta la palla oppure da dove e' partito l'attacco.
  const [zonaAttaccoVista, setZonaAttaccoVista] = useState<"arrivo" | "partenza">("arrivo");
  const [filtroRivivi, setFiltroRivivi] = useState<"tutti" | "noi" | "loro">("tutti");
  const [setRivivi, setSetRivivi] = useState<Set<string>>(new Set());
  const [mostraCalcoloVoto, setMostraCalcoloVoto] = useState(false);
  const [trendPersone, setTrendPersone] = useState<Record<string, AndamentoPersonaPartita[]>>({});

  const carica = useCallback(async () => {
    if (!id || !team) return;
    setCaricamento(true);
    try {
      const { data: m } = await supabaseClient.from("matches").select("*").eq("id", id).single();
      setMatch(m ?? null);
      const [f, p, det, a, sr, setLista, evAnd, to, partite, trend, zoneRighe] = await Promise.all([
        analisiFondamentaliPartita(id).catch(() => []),
        analisiPersonePartita(id).catch(() => []),
        analisiPersoneDettaglioPartita(id).catch(() => [] as AnalisiPersonaFondamentale[]),
        andamentoTraPartite(team.id, 8).catch(() => []),
        rendimentoServizioRicezionePartita(id).catch(() => null),
        elencaSet(id).catch(() => [] as MatchSet[]),
        elencaEventiPerAndamento(id).catch(() => [] as EventoAndamento[]),
        elencaTimeout(id).catch(() => [] as MatchTimeout[]),
        elencaPartite(team.id).catch(() => [] as Match[]),
        andamentoPersonePartite(team.id, 5).catch(() => [] as AndamentoPersonaPartita[]),
        analisiZonePartita(id).catch(() => [] as AnalisiZona[]),
      ]);
      setZone(zoneRighe);
      setSetGiocati(setLista);
      setEventiAndamento(evAnd);
      setTimeouts(to);
      setPartiteSquadra(partite);
      const trendPerGiocatore: Record<string, AndamentoPersonaPartita[]> = {};
      for (const riga of trend) {
        if (!trendPerGiocatore[riga.athlete_id]) trendPerGiocatore[riga.athlete_id] = [];
        trendPerGiocatore[riga.athlete_id].push(riga);
      }
      setTrendPersone(trendPerGiocatore);
      setFondamentali(f);
      setPersone(p);
      const perGiocatore: Record<string, AnalisiPersonaFondamentale[]> = {};
      for (const riga of det) {
        if (!perGiocatore[riga.athlete_id]) perGiocatore[riga.athlete_id] = [];
        perGiocatore[riga.athlete_id].push(riga);
      }
      setDettaglio(perGiocatore);
      setAndamento(a);
      setServizioRicezione(sr);
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCaricamento(false);
    }
  }, [id, team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  function alternaDettaglio(athleteId: string) {
    setAperti((prev) => {
      const nuovo = new Set(prev);
      if (nuovo.has(athleteId)) nuovo.delete(athleteId);
      else nuovo.add(athleteId);
      return nuovo;
    });
  }

  /** (punti - errori) / azioni, come per i fondamentali di squadra. */
  function efficienzaDi(punti: number, errori: number, azioni: number): number | null {
    return azioni > 0 ? (punti - errori) / azioni : null;
  }

  function formattaEfficienza(v: number | null): string {
    return v === null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2);
  }

  function coloreEfficienza(v: number | null): string {
    if (v === null) return brand.colors.muted;
    if (v >= 0.3) return brand.colors.success;
    if (v >= 0) return brand.colors.brand;
    if (v >= -0.3) return brand.colors.warning;
    return brand.colors.error;
  }

  const andamentoPerSet = costruisciAndamentoPerSet(eventiAndamento);

  /** Time-out di un set come marcatori del grafico. */
  function marcatoriDelSet(setId: string) {
    return timeouts.filter((t) => t.set_id === setId).map((t) => ({ dopoPunti: t.punti_noi + t.punti_avversario, squadra: t.squadra }));
  }

  /** Andamento dell'efficienza di una persona nelle ultime partite, per fondamentale. */
  function renderTrend(athleteId: string) {
    const righe = trendPersone[athleteId] ?? [];
    const partite = Array.from(new Map(righe.map((r) => [r.match_id, r])).values()).sort((a, b) => a.data.localeCompare(b.data));
    if (partite.length < 2) return null;
    const fondamentaliPresenti = Array.from(new Set(righe.map((r) => r.fondamentale)));
    const valore = (matchId: string, fond?: string): number | null => {
      const sel = righe.filter((r) => r.match_id === matchId && (!fond || r.fondamentale === fond));
      return efficienzaDi(sel.reduce((x, r) => x + r.punti, 0), sel.reduce((x, r) => x + r.errori, 0), sel.reduce((x, r) => x + r.azioni, 0));
    };
    const giorno = (iso: string) => new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
    return (
      <View style={styles.trendBox}>
        <Text style={styles.trendTitolo}>Ultime {partite.length} partite della squadra (efficienza)</Text>
        <View style={styles.rigaTabella}>
          <Text style={[styles.cellaFondamentale, styles.intestazioneTabella]}> </Text>
          {partite.map((m) => <Text key={m.match_id} style={[styles.cellaTrend, styles.intestazioneTabella]}>{giorno(m.data)}</Text>)}
        </View>
        {fondamentaliPresenti.map((fond) => (
          <View key={fond} style={styles.rigaTabella}>
            <Text style={styles.cellaFondamentale}>{fond}</Text>
            {partite.map((m) => { const v = valore(m.match_id, fond); return <Text key={m.match_id} style={[styles.cellaTrend, { color: coloreEfficienza(v) }]}>{formattaEfficienza(v)}</Text>; })}
          </View>
        ))}
        <View style={[styles.rigaTabella, styles.rigaTotale]}>
          <Text style={[styles.cellaFondamentale, styles.testoTotale]}>Totale</Text>
          {partite.map((m) => { const v = valore(m.match_id); return <Text key={m.match_id} style={[styles.cellaTrend, styles.testoTotale, { color: coloreEfficienza(v) }]}>{formattaEfficienza(v)}</Text>; })}
        </View>
        <Text style={styles.notaTabella}>"—" = nessuna azione in quella partita.</Text>
      </View>
    );
  }

  function costruisciScheda(): SchedaPartita {
    const numeroSet = (setId: string) => setGiocati.find((x) => x.id === setId)?.numero_set ?? 0;
    return {
      titolo: `${team?.nome ?? "Noi"} vs ${match!.avversario}`,
      dataPartita: new Date(match!.data).toLocaleDateString("it-IT"),
      setGiocati: setGiocati.map((x) => ({ numero: x.numero_set, noi: x.punti_noi, avv: x.punti_avversario })),
      fondamentali: fondamentali.map((f) => ({
        nome: f.fondamentale === "Punto_avversario" ? "Punto avversario" : f.fondamentale,
        azioni: f.azioni, punti: f.punti, errori: f.errori, efficienza: f.efficienza,
      })),
      sideOutBreakPoint: servizioRicezione && (servizioRicezione.punti_in_battuta > 0 || servizioRicezione.punti_in_ricezione > 0)
        ? { breakPointPct: servizioRicezione.break_point_pct ?? null, sideOutPct: servizioRicezione.side_out_pct ?? null }
        : null,
      persone: persone.map((pp) => ({
        nome: pp.nome_completo, azioni: pp.azioni, punti: pp.punti, errori: pp.errori, saldo: pp.saldo,
        fondamentali: (dettaglio[pp.athlete_id] ?? []).map((r) => ({ nome: r.fondamentale, azioni: r.azioni, punti: r.punti, neutri: r.neutri, errori: r.errori })),
      })),
      timeouts: timeouts.map((t) => ({
        set: numeroSet(t.set_id),
        squadra: t.squadra === "noi" ? "Noi" : "Loro",
        punteggio: `${t.punti_noi}-${t.punti_avversario}`,
      })),
      zone: zone.length === 0 ? [] : (["Servizio", "Attacco"] as const).flatMap((fond) =>
        (["arrivo", "partenza"] as const).flatMap((dim) => {
          if (fond === "Servizio" && dim === "partenza") return [];
          const val = valoriPerZona(fond, dim);
          return Object.keys(val).map((k) => ({ fondamentale: fond, vista: dim === "arrivo" ? "Arrivo" : "Partenza", zona: Number(k), azioni: val[Number(k)].azioni, punti: val[Number(k)].punti, errori: val[Number(k)].errori }));
        }),
      ),
      serie: setGiocati.map((x) => { const sr2 = seriePiuLunghe(andamentoPerSet[x.id] ?? []); return { set: x.numero_set, noi: sr2.noi, avversario: sr2.avversario }; }),
    };
  }

  async function onEsportaCsv() {
    if (!match) return;
    const ok = await esportaCsv(costruisciScheda());
    if (!ok) avvisa("Esportazione non riuscita", "Non è stato possibile creare il file.");
  }

  function onStampa() {
    if (!match) return;
    if (!stampaScheda(costruisciScheda())) avvisa("Stampa non disponibile", "La stampa/PDF funziona dal browser. Se si è bloccata la finestra, consenti i popup per questo sito e riprova.");
  }

  /** Somma le righe per zona (di arrivo o di partenza) per un fondamentale. */
  function valoriPerZona(fondamentale: string, dimensione: "arrivo" | "partenza"): Record<number, ValoreZona> {
    const out: Record<number, ValoreZona> = {};
    for (const r of zone) {
      if (r.fondamentale !== fondamentale) continue;
      const z = dimensione === "arrivo" ? r.zona_arrivo : r.zona_partenza;
      if (!z) continue;
      const v = out[z] ?? (out[z] = { azioni: 0, punti: 0, errori: 0 });
      v.azioni += r.azioni; v.punti += r.punti; v.errori += r.errori;
    }
    return out;
  }
  /** Quante azioni di quel fondamentale hanno la zona indicata, rispetto a tutte quelle registrate. */
  function coperturaZone(fondamentale: string, dimensione: "arrivo" | "partenza"): { con: number; totali: number; quota: number } {
    const con = Object.values(valoriPerZona(fondamentale, dimensione)).reduce((s, v) => s + v.azioni, 0);
    const totali = fondamentali.find((f) => f.fondamentale === fondamentale)?.azioni ?? 0;
    return { con, totali, quota: totali > 0 ? con / totali : 0 };
  }
  function notaCopertura(fondamentale: string, dimensione: "arrivo" | "partenza", nome: string) {
    const c = coperturaZone(fondamentale, dimensione);
    const poche = c.quota < 0.5;
    return (
      <Text style={[styles.dettaglioFondamentale, poche && { color: brand.colors.warning }]}>
        {poche ? "⚠ " : ""}Zona indicata su {c.con} {nome} su {c.totali} ({Math.round(c.quota * 100)}%).
        {c.quota < 0.1 ? " Troppo pochi dati per dire qualcosa: le percentuali qui sotto non sono affidabili." : poche ? " Dato parziale: leggilo come indicazione, non come quadro della partita." : ""}
      </Text>
    );
  }
  const haZone = (fondamentale: string, dimensione: "arrivo" | "partenza") => Object.keys(valoriPerZona(fondamentale, dimensione)).length > 0;

  const chiaveAvversario = (nome: string) => nome.toLowerCase().replace(/\s+/g, " ").trim();

  if (caricamento) return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} /></View>;
  if (!match) return <View style={styles.container}><Text style={styles.nota}>Partita non trovata.</Text></View>;

  const massimoAzioni = Math.max(1, ...fondamentali.map((f) => f.azioni));

  // Voti, "rivivi la partita" e scheda generale: tutto calcolato dagli eventi.
  const nomiAtlete = new Map(persone.map((p) => [p.athlete_id, p.nome_completo]));
  const nomeAtleta = (aid: string) => nomiAtlete.get(aid) ?? "—";
  const voti = calcolaVoti(eventiAndamento);
  const rivivi = costruisciRivivi(eventiAndamento, nomeAtleta);
  const migliore = Object.values(voti).filter((v) => v.voto !== null).sort((a, b) => (b.voto ?? 0) - (a.voto ?? 0))[0] ?? null;
  const conta = (f: (e: EventoAndamento) => boolean) => eventiAndamento.filter(f).length;
  const aceBattuta = conta((e) => e.skill === "Servizio" && e.esito === "punto");
  const erroriBattuta = conta((e) => e.skill === "Servizio" && e.esito === "errore");
  const puntiMuro = conta((e) => e.skill === "Muro" && e.esito === "punto");
  const erroriNostri = conta((e) => e.esito === "errore");
  const puntiDirettiLoro = conta((e) => e.skill === "Punto_avversario");
  const ricezioniTot = conta((e) => e.skill === "Ricezione");
  const ricezioniPositive = conta((e) => e.skill === "Ricezione" && (e.qualita === "ottima" || e.qualita === "buona"));
  const efficienzaAttacco = fondamentali.find((f) => f.fondamentale === "Attacco")?.efficienza ?? null;
  const setVintiNoi = setGiocati.filter((x) => x.punti_noi > x.punti_avversario).length;
  const setVintiLoro = setGiocati.filter((x) => x.punti_avversario > x.punti_noi).length;
  const percentuale = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
  function alternaSetRivivi(setId: string) {
    setSetRivivi((prev) => { const n = new Set(prev); if (n.has(setId)) n.delete(setId); else n.add(setId); return n; });
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← Partite</Text></Pressable>
        <Text style={styles.titolo} numberOfLines={1}>vs {match.avversario}</Text>
        <Pressable onPress={onEsportaCsv} hitSlop={8} style={styles.bottoneEsporta}><Text style={styles.bottoneEsportaTesto}>⬇ CSV</Text></Pressable>
        <Pressable onPress={onStampa} hitSlop={8} style={styles.bottoneEsporta}><Text style={styles.bottoneEsportaTesto}>🖨 PDF</Text></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 60 }}>
        {setGiocati.length > 0 && (
          <View>
            <Text style={styles.sezione}>Risultato e parziali</Text>
            <Text style={[styles.risultatoGrande, { color: setVintiNoi > setVintiLoro ? brand.colors.success : setVintiNoi < setVintiLoro ? brand.colors.error : brand.colors.onSurface }]}>
              {setVintiNoi} - {setVintiLoro}
            </Text>
            <View style={styles.rigaParziali}>
              {setGiocati.map((x) => {
                const vinto = x.punti_noi > x.punti_avversario;
                const perso = x.punti_noi < x.punti_avversario;
                return (
                  <View key={x.id} style={styles.cardParziale}>
                    <Text style={styles.parzialeSet}>Set {x.numero_set}</Text>
                    <Text style={[styles.parzialePunteggio, { color: vinto ? brand.colors.success : perso ? brand.colors.error : brand.colors.onSurface }]}>{x.punti_noi}-{x.punti_avversario}</Text>
                    {!x.concluso && <Text style={styles.parzialeSet}>in corso</Text>}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {eventiAndamento.length > 0 && (
          <View>
            <Text style={styles.sezione}>Scheda della partita</Text>
            <View style={styles.rigaAndamento}>
              <Text style={styles.rigaAndamentoTesto}>Side-out (punti vinti quando riceviamo)</Text>
              <Text style={styles.valoreScheda}>{servizioRicezione?.side_out_pct != null ? `${servizioRicezione.side_out_pct}%` : "—"}</Text>
            </View>
            <View style={styles.rigaAndamento}>
              <Text style={styles.rigaAndamentoTesto}>Break-point (punti vinti quando battiamo)</Text>
              <Text style={styles.valoreScheda}>{servizioRicezione?.break_point_pct != null ? `${servizioRicezione.break_point_pct}%` : "—"}</Text>
            </View>
            <View style={styles.rigaAndamento}>
              <Text style={styles.rigaAndamentoTesto}>Ricezione positiva ({ricezioniPositive}/{ricezioniTot})</Text>
              <Text style={styles.valoreScheda}>{percentuale(ricezioniPositive, ricezioniTot)}</Text>
            </View>
            <View style={styles.rigaAndamento}>
              <Text style={styles.rigaAndamentoTesto}>Efficienza in attacco</Text>
              <Text style={[styles.valoreScheda, { color: coloreEfficienza(efficienzaAttacco) }]}>{formattaEfficienza(efficienzaAttacco)}</Text>
            </View>
            <View style={styles.rigaAndamento}>
              <Text style={styles.rigaAndamentoTesto}>Ace / errori in battuta</Text>
              <Text style={styles.valoreScheda}>{aceBattuta} / {erroriBattuta}</Text>
            </View>
            <View style={styles.rigaAndamento}>
              <Text style={styles.rigaAndamentoTesto}>Punti a muro</Text>
              <Text style={styles.valoreScheda}>{puntiMuro}</Text>
            </View>
            <View style={styles.rigaAndamento}>
              <Text style={styles.rigaAndamentoTesto}>Errori nostri / punti diretti avversari</Text>
              <Text style={styles.valoreScheda}>{erroriNostri} / {puntiDirettiLoro}</Text>
            </View>
            <Text style={styles.dettaglioFondamentale}>"Errori nostri" sono quelli attribuiti a una giocatrice; "punti diretti avversari" sono i punti loro registrati senza un nostro errore specifico.</Text>
          </View>
        )}

        <View>
          <Text style={styles.sezione}>Efficienza per fondamentale</Text>
          <Text style={styles.nota}>Punti meno errori sulle azioni totali: dice quanto un fondamentale rende, non solo quante volte è stato usato.</Text>
          {fondamentali.length === 0 ? (
            <Text style={styles.vuoto}>Nessun evento registrato in questa partita.</Text>
          ) : (
            fondamentali.map((f) => (
              <View key={f.fondamentale} style={styles.rigaFondamentale}>
                <View style={styles.rigaTitoloFondamentale}>
                  <Text style={styles.nomeFondamentale}>{f.fondamentale === "Punto_avversario" ? "Punto avversario" : f.fondamentale}</Text>
                  <Text style={[styles.valoreEfficienza, { color: coloreEfficienza(f.efficienza) }]}>
                    {f.efficienza !== null ? (f.efficienza >= 0 ? "+" : "") + f.efficienza.toFixed(2) : "—"}
                  </Text>
                </View>
                <View style={styles.barraSfondo}>
                  <View style={[styles.barraRiempimento, { width: `${(f.azioni / massimoAzioni) * 100}%`, backgroundColor: coloreEfficienza(f.efficienza) }]} />
                </View>
                <Text style={styles.dettaglioFondamentale}>
                  {f.azioni} azioni ({f.quota_sul_totale ?? 0}% del totale) · {f.punti} punti, {f.errori} errori
                </Text>
              </View>
            ))
          )}
        </View>

        {servizioRicezione && (servizioRicezione.punti_in_battuta > 0 || servizioRicezione.punti_in_ricezione > 0) && (
          <View>
            <Text style={styles.sezione}>Side-out % / Break-point %</Text>
            <Text style={styles.nota}>Le due metriche-cardine dell'analisi pallavolistica: quanto si rende servendo e quanto si rende ricevendo.</Text>
            <View style={styles.rigaAndamento}>
              <Text style={styles.rigaAndamentoTesto}>Break-point (punti vinti in battuta)</Text>
              <Text style={[styles.valoreEfficienza, { color: brand.colors.brand }]}>
                {servizioRicezione.break_point_pct != null ? `${servizioRicezione.break_point_pct}%` : "—"} ({servizioRicezione.punti_vinti_in_battuta}/{servizioRicezione.punti_in_battuta})
              </Text>
            </View>
            <View style={styles.rigaAndamento}>
              <Text style={styles.rigaAndamentoTesto}>Side-out (punti vinti in ricezione)</Text>
              <Text style={[styles.valoreEfficienza, { color: brand.colors.brand }]}>
                {servizioRicezione.side_out_pct != null ? `${servizioRicezione.side_out_pct}%` : "—"} ({servizioRicezione.punti_vinti_in_ricezione}/{servizioRicezione.punti_in_ricezione})
              </Text>
            </View>
            <Text style={styles.dettaglioFondamentale}>
              Ricezioni: {servizioRicezione.ricezioni_ottime} perfette, {servizioRicezione.ricezioni_buone} buone, {servizioRicezione.ricezioni_scarse} scarse, {servizioRicezione.ricezioni_errori} errori.
            </Text>
          </View>
        )}

        {zone.length > 0 && (
          <View>
            <Text style={styles.sezione}>Zone di battuta e attacco</Text>
            <Text style={styles.nota}>
              Campo avversario visto dalla nostra parte (rete in basso). Per ogni zona: quante azioni, punti/errori ed efficienza. Compaiono solo le azioni registrate con la modalità "Zone" attiva.
            </Text>
            {haZone("Servizio", "arrivo") && (
              <View style={styles.bloccoSet}>
                <Text style={styles.titoloSet}>Battuta — dove cade</Text>
                {notaCopertura("Servizio", "arrivo", "battute")}
                <GrigliaZone valori={valoriPerZona("Servizio", "arrivo")} />
              </View>
            )}
            {(haZone("Attacco", "arrivo") || haZone("Attacco", "partenza")) && (
              <View style={styles.bloccoSet}>
                <Text style={styles.titoloSet}>Attacco — {zonaAttaccoVista === "arrivo" ? "dove cade" : "da dove parte (posizione di rotazione)"}</Text>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
                  <Pressable onPress={() => setZonaAttaccoVista("arrivo")} style={[styles.chipZona, zonaAttaccoVista === "arrivo" && styles.chipZonaAttivo]}>
                    <Text style={[styles.chipZonaTesto, zonaAttaccoVista === "arrivo" && styles.chipZonaTestoAttivo]}>Arrivo</Text>
                  </Pressable>
                  <Pressable onPress={() => setZonaAttaccoVista("partenza")} style={[styles.chipZona, zonaAttaccoVista === "partenza" && styles.chipZonaAttivo]}>
                    <Text style={[styles.chipZonaTesto, zonaAttaccoVista === "partenza" && styles.chipZonaTestoAttivo]}>Partenza</Text>
                  </Pressable>
                </View>
                {haZone("Attacco", zonaAttaccoVista) && notaCopertura("Attacco", zonaAttaccoVista, "attacchi")}
                {haZone("Attacco", zonaAttaccoVista)
                  ? <GrigliaZone valori={valoriPerZona("Attacco", zonaAttaccoVista)} />
                  : <Text style={styles.nota}>Nessun dato per questa vista.</Text>}
                {zonaAttaccoVista === "partenza" && (
                  <Text style={styles.dettaglioFondamentale}>La partenza è la posizione di rotazione di chi attacca: è un'approssimazione (es. un'alzatrice o chi attacca fuori posto).</Text>
                )}
              </View>
            )}
          </View>
        )}

        {setGiocati.length > 0 && (
          <View>
            <Text style={styles.sezione}>Andamento punto a punto</Text>
            <Text style={styles.nota}>Differenza punti dopo ogni punto: le serie si vedono come blocchi di barre consecutive nello stesso verso.</Text>
            {setGiocati.map((x) => {
              const punti = andamentoPerSet[x.id] ?? [];
              const serie = seriePiuLunghe(punti);
              const toSet = timeouts.filter((t) => t.set_id === x.id);
              return (
                <View key={x.id} style={styles.bloccoSet}>
                  <Text style={styles.titoloSet}>Set {x.numero_set} — {x.punti_noi}-{x.punti_avversario}</Text>
                  <GraficoAndamentoSet punti={punti} timeouts={marcatoriDelSet(x.id)} />
                  {punti.length > 0 && (
                    <Text style={styles.dettaglioFondamentale}>Serie più lunga: noi {serie.noi} punti di fila, loro {serie.avversario}.</Text>
                  )}
                  {toSet.length > 0 && (
                    <Text style={styles.dettaglioFondamentale}>
                      Time-out: {toSet.map((t) => `${t.squadra === "noi" ? "noi" : "loro"} sul ${t.punti_noi}-${t.punti_avversario}`).join(" · ")}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {setGiocati.length > 0 && eventiAndamento.length > 0 && (
          <View>
            <Text style={styles.sezione}>Rivivi la partita</Text>
            <Text style={styles.nota}>Punto per punto: punteggio, chi ha segnato e come. Con 🔥 le serie da 3 punti di fila e con ⏱ i time-out.</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
              {([["tutti", "Tutti i punti"], ["noi", "Nostri"], ["loro", "Loro"]] as const).map(([k, et]) => (
                <Pressable key={k} onPress={() => setFiltroRivivi(k)} style={[styles.chipZona, filtroRivivi === k && styles.chipZonaAttivo]}>
                  <Text style={[styles.chipZonaTesto, filtroRivivi === k && styles.chipZonaTestoAttivo]}>{et}</Text>
                </Pressable>
              ))}
            </View>
            {setGiocati.map((x) => {
              const punti = rivivi[x.id] ?? [];
              const aperto = setRivivi.has(x.id);
              const to = timeouts.filter((t) => t.set_id === x.id);
              return (
                <View key={x.id} style={styles.bloccoSet}>
                  <Pressable onPress={() => alternaSetRivivi(x.id)}>
                    <Text style={styles.titoloSet}>{aperto ? "▾" : "▸"} Set {x.numero_set} — {x.punti_noi}-{x.punti_avversario} ({punti.length} punti)</Text>
                  </Pressable>
                  {aperto && punti.map((pt) => {
                    if (filtroRivivi === "noi" && pt.chi !== "noi") return null;
                    if (filtroRivivi === "loro" && pt.chi !== "avversario") return null;
                    const toDopo = to.filter((t) => t.punti_noi + t.punti_avversario === pt.numero);
                    return (
                      <View key={pt.numero}>
                        <View style={styles.rigaRivivi}>
                          <Text style={[styles.punteggioRivivi, { color: pt.chi === "noi" ? brand.colors.success : brand.colors.error }]}>{pt.noi}-{pt.avv}</Text>
                          <Text style={styles.testoRivivi} numberOfLines={2}>
                            {pt.chi === "noi" ? "Noi · " : "Loro · "}{pt.testo}{pt.serie >= 3 ? `  🔥 ${pt.serie} di fila` : ""}
                          </Text>
                        </View>
                        {toDopo.map((t) => (
                          <Text key={t.id} style={styles.timeoutRivivi}>⏱ Time-out {t.squadra === "noi" ? "nostro" : "loro"} sul {t.punti_noi}-{t.punti_avversario}</Text>
                        ))}
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        )}

        <View>
          <Text style={styles.sezione}>Contributo individuale</Text>
          <Text style={styles.nota}>Ordinate dal saldo migliore. Il voto è da 0 a 10 (n.c. sotto le {MIN_AZIONI_VOTO} azioni).{Object.keys(dettaglio).length > 0 ? " Tocca una giocatrice per vedere voto e numeri fondamentale per fondamentale." : ""}</Text>
          {migliore && (
            <Text style={styles.migliore}>⭐ Migliore in campo: {nomeAtleta(migliore.athlete_id)} ({migliore.voto?.toFixed(1)})</Text>
          )}
          <Pressable onPress={() => setMostraCalcoloVoto((v) => !v)}>
            <Text style={styles.linkCalcolo}>{mostraCalcoloVoto ? "▾" : "▸"} Come si calcola il voto</Text>
          </Pressable>
          {mostraCalcoloVoto && (
            <Text style={styles.nota}>
              Ogni fondamentale ha un indice tra −1 e +1: (punti − errori) / azioni; per ricezione e difesa (perfette + ½ buone − errori) / azioni. Il voto del fondamentale è 6 + 4 × indice (6 = in equilibrio, 10 = tutto punti, 0 = tutto errori), smorzato verso il 6 quando le azioni sono poche. Il voto generale è la media dei fondamentali pesata sul numero di azioni.
            </Text>
          )}
          {persone.length === 0 ? (
            <Text style={styles.vuoto}>Nessun dato individuale disponibile.</Text>
          ) : (
            persone.map((p, i) => {
              const righe = dettaglio[p.athlete_id] ?? [];
              const espandibile = righe.length > 0;
              const aperta = espandibile && aperti.has(p.athlete_id);
              return (
                <View key={p.athlete_id} style={styles.cardPersona}>
                  <Pressable style={styles.rigaPersona} onPress={() => espandibile && alternaDettaglio(p.athlete_id)} disabled={!espandibile}>
                    <Text style={styles.posizionePersona}>{i + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nomePersona}>{espandibile ? (aperta ? "▾ " : "▸ ") : ""}{p.nome_completo}</Text>
                      <Text style={styles.dettaglioPersona}>
                        {p.azioni} azioni · {p.punti}+/{p.errori}-
                        {p.fondamentale_migliore ? ` · forte in ${p.fondamentale_migliore}` : ""}
                        {p.fondamentale_peggiore && p.fondamentale_peggiore !== p.fondamentale_migliore ? ` · da curare: ${p.fondamentale_peggiore}` : ""}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={[styles.votoPersona, { color: brand.colors[coloreVoto(voti[p.athlete_id]?.voto ?? null)] }]}>
                        {voti[p.athlete_id]?.voto != null ? voti[p.athlete_id].voto!.toFixed(1) : "n.c."}
                      </Text>
                      <Text style={[styles.dettaglioPersona, { color: p.saldo >= 0 ? brand.colors.success : brand.colors.error }]}>saldo {p.saldo >= 0 ? "+" : ""}{p.saldo}</Text>
                    </View>
                  </Pressable>

                  {aperta && (
                    <View style={styles.tabellaDettaglio}>
                      <View style={styles.rigaTabella}>
                        <Text style={[styles.cellaFondamentale, styles.intestazioneTabella]}>Fondamentale</Text>
                        <Text style={[styles.cellaNumero, styles.intestazioneTabella]}>Az.</Text>
                        <Text style={[styles.cellaNumero, styles.intestazioneTabella]}>Pt</Text>
                        <Text style={[styles.cellaNumero, styles.intestazioneTabella]}>Neu</Text>
                        <Text style={[styles.cellaNumero, styles.intestazioneTabella]}>Err</Text>
                        <Text style={[styles.cellaEfficienza, styles.intestazioneTabella]}>Eff.</Text>
                        <Text style={[styles.cellaVoto, styles.intestazioneTabella]}>Voto</Text>
                      </View>
                      {righe.map((r) => {
                        const eff = efficienzaDi(r.punti, r.errori, r.azioni);
                        return (
                          <View key={r.fondamentale}>
                            <View style={styles.rigaTabella}>
                              <Text style={styles.cellaFondamentale}>{r.fondamentale}</Text>
                              <Text style={styles.cellaNumero}>{r.azioni}</Text>
                              <Text style={styles.cellaNumero}>{r.punti}</Text>
                              <Text style={styles.cellaNumero}>{r.neutri}</Text>
                              <Text style={styles.cellaNumero}>{r.errori}</Text>
                              <Text style={[styles.cellaEfficienza, { color: coloreEfficienza(eff) }]}>{formattaEfficienza(eff)}</Text>
                              {(() => {
                                const vf = voti[p.athlete_id]?.fondamentali.find((x) => x.fondamentale === r.fondamentale);
                                return <Text style={[styles.cellaVoto, { color: brand.colors[coloreVoto(vf?.voto ?? null)] }]}>{vf ? vf.voto.toFixed(1) : "—"}</Text>;
                              })()}
                            </View>
                            {(r.fondamentale === "Ricezione" || r.fondamentale === "Difesa") && (() => {
                              const vf = voti[p.athlete_id]?.fondamentali.find((x) => x.fondamentale === r.fondamentale);
                              if (!vf || vf.perfette + vf.buone + vf.scarse === 0) return null;
                              return (
                                <Text style={styles.dettaglioRicezione}>
                                  Qualità: {vf.perfette} perfette · {vf.buone} buone · {vf.scarse} scarse · {vf.errori} errori
                                </Text>
                              );
                            })()}
                          </View>
                        );
                      })}
                      {(() => {
                        const totAz = righe.reduce((s, r) => s + r.azioni, 0);
                        const totPt = righe.reduce((s, r) => s + r.punti, 0);
                        const totNeu = righe.reduce((s, r) => s + r.neutri, 0);
                        const totErr = righe.reduce((s, r) => s + r.errori, 0);
                        const eff = efficienzaDi(totPt, totErr, totAz);
                        return (
                          <View style={[styles.rigaTabella, styles.rigaTotale]}>
                            <Text style={[styles.cellaFondamentale, styles.testoTotale]}>Totale</Text>
                            <Text style={[styles.cellaNumero, styles.testoTotale]}>{totAz}</Text>
                            <Text style={[styles.cellaNumero, styles.testoTotale]}>{totPt}</Text>
                            <Text style={[styles.cellaNumero, styles.testoTotale]}>{totNeu}</Text>
                            <Text style={[styles.cellaNumero, styles.testoTotale]}>{totErr}</Text>
                            <Text style={[styles.cellaEfficienza, styles.testoTotale, { color: coloreEfficienza(eff) }]}>{formattaEfficienza(eff)}</Text>
                            <Text style={[styles.cellaVoto, styles.testoTotale, { color: brand.colors[coloreVoto(voti[p.athlete_id]?.voto ?? null)] }]}>{voti[p.athlete_id]?.voto != null ? voti[p.athlete_id].voto!.toFixed(1) : "n.c."}</Text>
                          </View>
                        );
                      })()}
                      <Text style={styles.notaTabella}>Pt = punti, Neu = neutri, Err = errori. Efficienza = (punti − errori) / azioni.</Text>
                      {renderTrend(p.athlete_id)}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>

        {(() => {
          const precedenti = partiteSquadra
            .filter((m) => m.id !== match.id && m.stato === "conclusa" && chiaveAvversario(m.avversario) === chiaveAvversario(match.avversario))
            .sort((a, b) => b.data.localeCompare(a.data));
          const vinte = precedenti.filter((m) => m.set_vinti_noi > m.set_vinti_avversario).length;
          return (
            <View>
              <Text style={styles.sezione}>Storico contro {match.avversario}</Text>
              {precedenti.length === 0 ? (
                <Text style={styles.nota}>Nessun'altra partita conclusa contro questa squadra in archivio.</Text>
              ) : (
                <>
                  <Text style={styles.nota}>
                    Altre {precedenti.length} {precedenti.length === 1 ? "partita" : "partite"} concluse: {vinte} {vinte === 1 ? "vittoria" : "vittorie"}, {precedenti.length - vinte} {precedenti.length - vinte === 1 ? "sconfitta" : "sconfitte"}. Il nome dell'avversario deve essere scritto uguale.
                  </Text>
                  {precedenti.map((m) => {
                    const vinta = m.set_vinti_noi > m.set_vinti_avversario;
                    const eff = andamento.find((a) => a.match_id === m.id)?.efficienza ?? null;
                    return (
                      <Pressable key={m.id} style={styles.rigaAndamento} onPress={() => router.push(`/analisi-partita/${m.id}`)}>
                        <Text style={styles.rigaAndamentoTesto} numberOfLines={1}>
                          {new Date(m.data).toLocaleDateString("it-IT")} · {m.luogo === "casa" ? "casa" : "trasferta"} · set {m.set_vinti_noi}-{m.set_vinti_avversario}
                        </Text>
                        <Text style={[styles.valoreEfficienza, { color: vinta ? brand.colors.success : brand.colors.error }]}>
                          {vinta ? "V" : "S"}{eff !== null ? `  ${formattaEfficienza(eff)}` : ""}
                        </Text>
                      </Pressable>
                    );
                  })}
                </>
              )}
            </View>
          );
        })()}

        {andamento.length > 1 && (
          <View>
            <Text style={styles.sezione}>Tendenza nelle ultime partite</Text>
            <Text style={styles.nota}>Efficienza complessiva partita per partita: se scende per più gare di fila è un segnale da guardare in allenamento.</Text>
            {andamento.map((a) => (
              <View key={a.match_id} style={styles.rigaAndamento}>
                <Text style={styles.rigaAndamentoTesto} numberOfLines={1}>
                  vs {a.avversario} ({new Date(a.data).toLocaleDateString("it-IT")}) — set {a.set_vinti_noi}-{a.set_vinti_avversario}
                </Text>
                <Text style={[styles.valoreEfficienza, { color: coloreEfficienza(a.efficienza) }]}>
                  {a.efficienza !== null ? (a.efficienza >= 0 ? "+" : "") + a.efficienza.toFixed(2) : "—"}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700", flex: 1 },
  sezione: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "800", textTransform: "uppercase", marginBottom: 4 },
  nota: { color: brand.colors.muted, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  vuoto: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 12 },
  rigaFondamentale: { marginBottom: 12, gap: 4 },
  rigaTitoloFondamentale: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  nomeFondamentale: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "700" },
  valoreEfficienza: { fontSize: 14, fontWeight: "800" },
  barraSfondo: { height: 8, backgroundColor: brand.colors.surfaceTertiary, borderRadius: 4, overflow: "hidden" },
  barraRiempimento: { height: "100%", borderRadius: 4 },
  dettaglioFondamentale: { color: brand.colors.muted, fontSize: 11 },
  cardPersona: { borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaPersona: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  tabellaDettaglio: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, padding: 10, marginBottom: 10, marginLeft: 30, gap: 4 },
  rigaTabella: { flexDirection: "row", alignItems: "center", gap: 4 },
  intestazioneTabella: { color: brand.colors.muted, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  cellaFondamentale: { flex: 1, color: brand.colors.onSurface, fontSize: 12, fontWeight: "600" },
  cellaNumero: { width: 32, textAlign: "right", color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  cellaVoto: { width: 40, textAlign: "right", fontSize: 12, fontWeight: "800", color: brand.colors.onSurfaceSecondary },
  cellaEfficienza: { width: 48, textAlign: "right", fontSize: 12, fontWeight: "800", color: brand.colors.onSurfaceSecondary },
  dettaglioRicezione: { color: brand.colors.muted, fontSize: 11, paddingBottom: 2 },
  rigaTotale: { borderTopWidth: 1, borderTopColor: brand.colors.border, paddingTop: 4, marginTop: 2 },
  testoTotale: { fontWeight: "800", color: brand.colors.onSurface },
  notaTabella: { color: brand.colors.muted, fontSize: 10, marginTop: 4 },
  risultatoGrande: { fontSize: 34, fontWeight: "800", textAlign: "center", marginVertical: 4 },
  rigaParziali: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  cardParziale: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, alignItems: "center", minWidth: 76 },
  parzialeSet: { color: brand.colors.muted, fontSize: 11, fontWeight: "700" },
  parzialePunteggio: { fontSize: 20, fontWeight: "800" },
  valoreScheda: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "800" },
  rigaRivivi: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 3 },
  punteggioRivivi: { width: 52, fontSize: 13, fontWeight: "800", textAlign: "right" },
  testoRivivi: { flex: 1, color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  timeoutRivivi: { color: brand.colors.warning, fontSize: 11, fontWeight: "700", paddingLeft: 62, paddingVertical: 2 },
  migliore: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "700", marginBottom: 6 },
  linkCalcolo: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "700", marginBottom: 6 },
  votoPersona: { fontSize: 18, fontWeight: "800" },
  posizionePersona: { color: brand.colors.muted, fontSize: 13, fontWeight: "700", width: 20 },
  nomePersona: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "600" },
  dettaglioPersona: { color: brand.colors.muted, fontSize: 11, marginTop: 2 },
  saldoPersona: { fontSize: 16, fontWeight: "800" },
  rigaAndamento: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: brand.colors.border, gap: 8 },
  rigaAndamentoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12, flex: 1 },
  bottoneEsporta: { borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 },
  bottoneEsportaTesto: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "700" },
  chipZona: { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 14, backgroundColor: brand.colors.surfaceTertiary },
  chipZonaAttivo: { backgroundColor: brand.colors.brand },
  chipZonaTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  chipZonaTestoAttivo: { color: "#000", fontWeight: "700" },
  bloccoSet: { marginBottom: 14, gap: 4 },
  titoloSet: { color: brand.colors.onSurface, fontSize: 13, fontWeight: "700" },
  trendBox: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: brand.colors.border, gap: 4 },
  trendTitolo: { color: brand.colors.brandSecondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  cellaTrend: { width: 42, textAlign: "right", fontSize: 11, fontWeight: "700", color: brand.colors.onSurfaceSecondary },
});
