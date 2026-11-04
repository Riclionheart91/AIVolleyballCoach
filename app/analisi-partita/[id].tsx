import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import {
  analisiFondamentaliPartita, analisiPersoneDettaglioPartita, analisiZonePartita, analisiPersonePartita, andamentoPersonePartite, andamentoTraPartite,
  elencaEventiPerAndamento, elencaPartite, elencaSet, elencaTimeout, rendimentoServizioRicezionePartita,
  type AnalisiFondamentale, type AnalisiPersona, type AnalisiPersonaFondamentale, type AnalisiZona, type AndamentoPartita, type AndamentoPersonaPartita,
  type EventoAndamento, type MatchTimeout, type RendimentoServizioRicezione,
} from "@/src/services/matches";
import type { ValoreZona } from "@/src/components/ZoneCampo";
import { GraficoAndamentoSet } from "@/src/components/GraficoAndamentoSet";
import { costruisciAndamentoPerSet, seriePiuLunghe } from "@/src/lib/andamentoPunti";
import { calcolaVoti, coloreVoto, MIN_AZIONI_VOTO, type VotoFondamentale } from "@/src/lib/votiPartita";
import { costruisciRivivi } from "@/src/lib/rivivi";
import { esportaCsv, stampaScheda, type SchedaPartita } from "@/src/lib/esportaPartita";
import { condividiRiepilogoPdf, scaricaRiepilogoPdf, type RiepilogoPartita } from "@/src/lib/riepilogoPartitaPdf";
import { calcolaMetriche, caricaConfrontoPartite, type ConfrontoPartite } from "@/src/services/confrontoPartite";
import { supabaseClient } from "@/src/lib/supabase";
import { avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import type { Match, MatchSet } from "@/src/types/database";

/** Iniziali del nome di una squadra, per il cerchio al posto dello stemma. */
function iniziali(nome: string): string {
  const parti = nome.trim().split(/\s+/).filter(Boolean);
  if (parti.length === 0) return "?";
  return (parti.length === 1 ? parti[0].slice(0, 2) : parti[0][0] + parti[1][0]).toUpperCase();
}

/** Statistica singola: etichetta, valore e (se c'è una percentuale) una barra. */
function StatSingola({ etichetta, valore, percentuale, coloreValore }: { etichetta: string; valore: string; percentuale?: number | null; coloreValore?: string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statRiga}>
        <Text style={styles.statEtichetta}>{etichetta}</Text>
        <Text style={[styles.statValore, coloreValore ? { color: coloreValore } : null]}>{valore}</Text>
      </View>
      {percentuale != null && (
        <View style={styles.statTraccia}>
          <View style={[styles.statRiempimento, { width: `${Math.max(0, Math.min(100, percentuale))}%` }]} />
        </View>
      )}
    </View>
  );
}

/** Due valori affiancati con barra divisa in proporzione (sinistra / destra). */
function StatDoppia({ etichetta, sx, dx, coloreSx, coloreDx }: { etichetta: string; sx: number; dx: number; coloreSx: string; coloreDx: string }) {
  const haDati = sx + dx > 0;
  return (
    <View style={styles.stat}>
      <View style={styles.statRiga}>
        <Text style={[styles.statValoreLato, { color: coloreSx }]}>{sx}</Text>
        <Text style={styles.statEtichettaCentro}>{etichetta}</Text>
        <Text style={[styles.statValoreLato, { color: coloreDx, textAlign: "right" }]}>{dx}</Text>
      </View>
      <View style={styles.statDoppiaBarra}>
        <View style={{ flex: haDati ? sx : 1, backgroundColor: haDati ? coloreSx : brand.colors.border, borderRadius: 3 }} />
        <View style={{ flex: haDati ? dx : 1, backgroundColor: haDati ? coloreDx : brand.colors.border, borderRadius: 3 }} />
      </View>
    </View>
  );
}

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
  const [filtroRivivi, setFiltroRivivi] = useState<"tutti" | "noi" | "loro">("tutti");
  const [setRivivi, setSetRivivi] = useState<Set<string>>(new Set());
  const [mostraCalcoloVoto, setMostraCalcoloVoto] = useState(false);
  const [trendPersone, setTrendPersone] = useState<Record<string, AndamentoPersonaPartita[]>>({});
  // Confronto con le ultime partite concluse della stessa squadra e stagione (null = non disponibile: la sezione resta nascosta).
  const [confronto, setConfronto] = useState<ConfrontoPartite | null>(null);

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
        andamentoTraPartite(m?.team_id ?? team.id, 8).catch(() => []),
        rendimentoServizioRicezionePartita(id).catch(() => null),
        elencaSet(id).catch(() => [] as MatchSet[]),
        elencaEventiPerAndamento(id).catch(() => [] as EventoAndamento[]),
        elencaTimeout(id).catch(() => [] as MatchTimeout[]),
        elencaPartite(m?.team_id ?? team.id).catch(() => [] as Match[]),
        andamentoPersonePartite(m?.team_id ?? team.id, 5).catch(() => [] as AndamentoPersonaPartita[]),
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

  // Il confronto si carica dopo la schermata, senza farla aspettare: se qualcosa non va la sezione non compare.
  const societaIdSquadra = team?.societaId ?? null;
  useEffect(() => {
    let annullato = false;
    setConfronto(null);
    if (!match || eventiAndamento.length === 0 || partiteSquadra.length === 0) return;
    caricaConfrontoPartite(match, partiteSquadra, societaIdSquadra, calcolaMetriche(eventiAndamento, servizioRicezione?.side_out_pct))
      .then((c) => { if (!annullato) setConfronto(c); })
      .catch(() => { /* sezione nascosta */ });
    return () => { annullato = true; };
  }, [match, eventiAndamento, partiteSquadra, servizioRicezione, societaIdSquadra]);

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

  /** Righe per zona (1-6) di un fondamentale, nell'ordine delle zone, per la scheda esportata. */
  function zoneDi(fondamentale: string, dimensione: "arrivo" | "partenza", vista: string) {
    return Object.entries(valoriPerZona(fondamentale, dimensione))
      .map(([z, v]) => ({ fondamentale, vista, zona: Number(z), azioni: v.azioni, punti: v.punti, errori: v.errori }))
      .sort((a, b) => a.zona - b.zona);
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
        fondamentali: (dettaglio[pp.athlete_id] ?? []).map((r) => {
          const vf = voti[pp.athlete_id]?.fondamentali.find((x) => x.fondamentale === r.fondamentale);
          const conQualita = (r.fondamentale === "Ricezione" || r.fondamentale === "Difesa") && !!vf;
          return {
            nome: r.fondamentale, azioni: r.azioni, punti: r.punti, neutri: r.neutri, errori: r.errori,
            ...(conQualita ? { perfette: vf!.perfette, buone: vf!.buone, scarse: vf!.scarse } : {}),
          };
        }),
      })),
      timeouts: timeouts.map((t) => ({
        set: numeroSet(t.set_id),
        squadra: t.squadra === "noi" ? "Noi" : "Loro",
        punteggio: `${t.punti_noi}-${t.punti_avversario}`,
      })),
      qualita: (["Ricezione", "Difesa"] as const).map((fond) => {
        const ev = eventiAndamento.filter((e) => e.skill === fond);
        return {
          fondamentale: fond,
          perfette: ev.filter((e) => e.qualita === "ottima").length,
          buone: ev.filter((e) => e.qualita === "buona").length,
          scarse: ev.filter((e) => e.qualita === "scarsa").length,
          errori: ev.filter((e) => e.esito === "errore").length,
        };
      }).filter((q) => q.perfette + q.buone + q.scarse + q.errori > 0),
      zone: [
        ...zoneDi("Servizio", "arrivo", "Arrivo"),
        ...zoneDi("Attacco", "partenza", "Partenza"),
        ...zoneDi("Attacco", "arrivo", "Arrivo"),
      ],
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

  /** Numero con una cifra decimale e la virgola, come si scrive in italiano. */
  const decimale = (v: number) => v.toFixed(1).replace(".", ",");

  /** Dati del "Riepilogo partita" in PDF: gli stessi numeri che si vedono a schermo. */
  function costruisciRiepilogo(): RiepilogoPartita {
    const m = calcolaMetriche(eventiAndamento, servizioRicezione?.side_out_pct);
    const attacchi = conta((e) => e.skill === "Attacco");
    const attacchiPunto = conta((e) => e.skill === "Attacco" && e.esito === "punto");
    const servizi = conta((e) => e.skill === "Servizio");
    const haEventi = eventiAndamento.length > 0;
    const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);
    const statistiche: RiepilogoPartita["statistiche"] = haEventi ? [
      { etichetta: "Ricezione positiva", valore: pct(m.ricezionePositivaPct), dettaglio: ricezioniTot > 0 ? `${ricezioniPositive}/${ricezioniTot}` : undefined, percentuale: m.ricezionePositivaPct },
      { etichetta: "Attacco efficace", valore: pct(m.attaccoEfficacePct), dettaglio: attacchi > 0 ? `${attacchiPunto}/${attacchi}` : undefined, percentuale: m.attaccoEfficacePct },
      { etichetta: "Side-out", valore: pct(m.sideOutPct), percentuale: m.sideOutPct },
      { etichetta: "Break-point", valore: servizioRicezione?.break_point_pct != null ? `${Math.round(Number(servizioRicezione.break_point_pct))}%` : "—", percentuale: servizioRicezione?.break_point_pct != null ? Number(servizioRicezione.break_point_pct) : null },
      { etichetta: "Ace / errori servizio", valore: `${aceBattuta} / ${erroriBattuta}`, dettaglio: servizi > 0 ? `su ${servizi}` : undefined },
      { etichetta: "Muri vincenti", valore: String(puntiMuro) },
    ] : [];

    const migliori: RiepilogoPartita["migliori"] = [];
    for (const fond of ["Servizio", "Ricezione", "Attacco", "Muro", "Difesa"]) {
      let meglio: { athleteId: string; f: VotoFondamentale } | null = null;
      for (const v of Object.values(voti)) {
        const f = v.fondamentali.find((x) => x.fondamentale === fond && x.azioni >= 3);
        if (f && (!meglio || f.voto > meglio.f.voto || (f.voto === meglio.f.voto && f.azioni > meglio.f.azioni))) meglio = { athleteId: v.athlete_id, f };
      }
      if (!meglio) continue;
      const f = meglio.f;
      const extra = fond === "Servizio" ? `${f.punti} ace su ${f.azioni}`
        : fond === "Ricezione" || fond === "Difesa" ? `${Math.round(((f.perfette + f.buone) / f.azioni) * 100)}% positive su ${f.azioni}`
        : `${f.punti} punti, ${f.errori} errori su ${f.azioni}`;
      migliori.push({ fondamentale: fond, nome: nomeAtleta(meglio.athleteId), dettaglio: `voto ${decimale(f.voto)} · ${extra}` });
    }

    return {
      squadra: nomeNoi,
      avversario: match!.avversario,
      data: new Date(match!.data).toLocaleDateString("it-IT"),
      luogo: match!.luogo === "casa" ? "Casa" : match!.luogo === "trasferta" ? "Trasferta" : null,
      stato: match!.stato === "conclusa" ? "Finita" : match!.stato === "in_corso" ? "In corso" : "Da giocare",
      setVintiNoi: vintiNoi,
      setVintiLoro: vintiLoro,
      setGiocati: setGiocati.map((x) => ({ numero: x.numero_set, noi: x.punti_noi, avv: x.punti_avversario })),
      statistiche,
      confronto: confronto && confronto.partiteConfrontate.length > 0 ? {
        titolo: `Rispetto alle ultime ${confronto.partiteConfrontate.length} ${confronto.partiteConfrontate.length === 1 ? "partita" : "partite"}`,
        righe: confronto.righe.map((r) => ({
          etichetta: r.etichetta,
          valore: r.valore === null ? "—" : `${Math.round(r.valore)}%`,
          media: r.media === null ? "—" : `${Math.round(r.media)}%`,
          differenza: r.differenza === null ? "" : `${r.differenza > 0 ? "+" : ""}${decimale(r.differenza)}`,
          migliora: r.migliora,
        })),
        frase: confronto.frase,
      } : null,
      migliori,
      migliorInCampo: migliore && migliore.voto != null ? { nome: nomeAtleta(migliore.athlete_id), voto: `voto ${decimale(migliore.voto)}` } : null,
      andamento: setGiocati.map((x) => {
        const punti = andamentoPerSet[x.id] ?? [];
        const sr = seriePiuLunghe(punti);
        return { numero: x.numero_set, noi: x.punti_noi, avv: x.punti_avversario, differenze: [0, ...punti.map((q) => q.noi - q.avv)], serieNoi: sr.noi, serieAvv: sr.avversario };
      }),
    };
  }

  /** "Riepilogo PDF": scarica il file da browser; nell'app apre la condivisione del testo. */
  async function onRiepilogoPdf() {
    if (!match) return;
    const riepilogo = costruisciRiepilogo();
    if (scaricaRiepilogoPdf(riepilogo)) return;
    const esito = await condividiRiepilogoPdf(riepilogo);
    if (esito === "errore") avvisa("Riepilogo non riuscito", "Non è stato possibile creare il PDF. Riprova.");
  }

  /** "Condividi": foglio di condivisione con il PDF allegato (chat, mail...); se il browser non lo permette scarica il file. */
  async function onCondividiRiepilogo() {
    if (!match) return;
    const esito = await condividiRiepilogoPdf(costruisciRiepilogo());
    if (esito === "scaricato") avvisa("Riepilogo scaricato", "Questo browser non può condividere il file direttamente: il PDF è stato scaricato, ora puoi allegarlo alla chat.");
    else if (esito === "errore") avvisa("Condivisione non riuscita", "Non è stato possibile condividere il riepilogo. Riprova.");
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
  const erroriNostri = conta((e) => e.esito === "errore" || (e.skill === "Punto_avversario" && e.causa === "errore_nostro"));
  const puntiDirettiLoro = conta((e) => e.skill === "Punto_avversario" && e.causa !== "errore_nostro");
  const ricezioniTot = conta((e) => e.skill === "Ricezione");
  const ricezioniPositive = conta((e) => e.skill === "Ricezione" && (e.qualita === "ottima" || e.qualita === "buona"));
  const efficienzaAttacco = fondamentali.find((f) => f.fondamentale === "Attacco")?.efficienza ?? null;
  const setVintiNoi = setGiocati.filter((x) => x.punti_noi > x.punti_avversario).length;
  const setVintiLoro = setGiocati.filter((x) => x.punti_avversario > x.punti_noi).length;
  const MIN_ATTACCHI_ZONA = 3;
  const attaccoPerZona = Object.entries(valoriPerZona("Attacco", "partenza"))
    .map(([zona, v]) => ({ zona: Number(zona), azioni: v.azioni, punti: v.punti, errori: v.errori, efficienza: (v.punti - v.errori) / v.azioni, efficacia: v.punti / v.azioni }))
    .sort((a, b) => b.efficienza - a.efficienza);
  const zoneConfrontabili = attaccoPerZona.filter((z) => z.azioni >= MIN_ATTACCHI_ZONA);
  const migliorePerEfficienza = zoneConfrontabili[0] ?? null;
  const migliorePerEfficacia = [...zoneConfrontabili].sort((a, b) => b.efficacia - a.efficacia)[0] ?? null;
  const attacchiConZona = attaccoPerZona.reduce((s2, z) => s2 + z.azioni, 0);
  const attacchiTotali = fondamentali.find((f) => f.fondamentale === "Attacco")?.azioni ?? 0;
  const percentuale = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
  function renderDettaglioPersona(athleteId: string) {
    const righe = dettaglio[athleteId] ?? [];
    return (
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
                                const vf = voti[athleteId]?.fondamentali.find((x) => x.fondamentale === r.fondamentale);
                                return <Text style={[styles.cellaVoto, { color: brand.colors[coloreVoto(vf?.voto ?? null)] }]}>{vf ? vf.voto.toFixed(1) : "—"}</Text>;
                              })()}
                            </View>
                            {(r.fondamentale === "Ricezione" || r.fondamentale === "Difesa") && (() => {
                              const vf = voti[athleteId]?.fondamentali.find((x) => x.fondamentale === r.fondamentale);
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
                            <Text style={[styles.cellaVoto, styles.testoTotale, { color: brand.colors[coloreVoto(voti[athleteId]?.voto ?? null)] }]}>{voti[athleteId]?.voto != null ? voti[athleteId].voto!.toFixed(1) : "n.c."}</Text>
                          </View>
                        );
                      })()}
                      <Text style={styles.notaTabella}>Pt = punti, Neu = neutri, Err = errori. Efficienza = (punti − errori) / azioni.</Text>
                      {renderTrend(athleteId)}
                    </View>
    );
  }

  function alternaSetRivivi(setId: string) {
    setSetRivivi((prev) => { const n = new Set(prev); if (n.has(setId)) n.delete(setId); else n.add(setId); return n; });
  }

  const nomeNoi = team?.nome ?? "Noi";
  const vintiNoi = setGiocati.length > 0 ? setVintiNoi : match.set_vinti_noi;
  const vintiLoro = setGiocati.length > 0 ? setVintiLoro : match.set_vinti_avversario;
  const statoTesto = match.stato === "conclusa" ? "FINITA" : match.stato === "in_corso" ? "IN CORSO" : "DA GIOCARE";
  const dataBreve = new Date(match.data).toLocaleDateString("it-IT", { day: "numeric", month: "short" }).toUpperCase();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.tastoIndietro}><Text style={styles.indietro}>‹ Partite</Text></Pressable>
        <Text style={styles.statoPartita} numberOfLines={1}>{statoTesto} · {dataBreve}</Text>
        <Pressable onPress={onEsportaCsv} hitSlop={8} style={styles.bottoneEsporta}><Text style={styles.bottoneEsportaTesto}>⬇ CSV</Text></Pressable>
        <Pressable onPress={onStampa} hitSlop={8} style={styles.bottoneEsporta}><Text style={styles.bottoneEsportaTesto}>🖨 PDF</Text></Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.contenuto}>
        <View style={styles.tabellone}>
          <View style={styles.squadraTab}>
            <View style={[styles.stemma, { backgroundColor: brand.colors.surfaceTertiary }]}><Text style={[styles.stemmaTesto, { color: brand.colors.brand }]}>{iniziali(nomeNoi)}</Text></View>
            <Text style={styles.squadraTabNome} numberOfLines={2}>{nomeNoi}</Text>
          </View>
          <Text style={[styles.risultatoGrande, { color: vintiNoi > vintiLoro ? brand.colors.success : vintiNoi < vintiLoro ? brand.colors.error : brand.colors.onSurface }]}>
            {vintiNoi} – {vintiLoro}
          </Text>
          <View style={styles.squadraTab}>
            <View style={[styles.stemma, { backgroundColor: brand.colors.border }]}><Text style={[styles.stemmaTesto, { color: brand.colors.onSurfaceSecondary }]}>{iniziali(match.avversario)}</Text></View>
            <Text style={styles.squadraTabNome} numberOfLines={2}>{match.avversario}</Text>
          </View>
        </View>

        {setGiocati.length > 0 && (
          <View style={styles.schedaLista}>
            {setGiocati.map((x, i) => {
              const vinto = x.punti_noi > x.punti_avversario;
              const perso = x.punti_noi < x.punti_avversario;
              return (
                <View key={x.id}>
                  {i > 0 && <View style={styles.separatore} />}
                  <View style={styles.rigaSet}>
                    <View style={{ width: 72 }}>
                      <Text style={styles.rigaSetNome}>Set {x.numero_set}</Text>
                      {!x.concluso && <Text style={styles.rigaSetInCorso}>in corso</Text>}
                    </View>
                    <Text style={[styles.rigaSetPunti, { textAlign: "right" }, vinto ? styles.puntiForti : perso ? styles.puntiDeboli : null]}>{x.punti_noi}</Text>
                    <Text style={styles.rigaSetTrattino}>–</Text>
                    <Text style={[styles.rigaSetPunti, { textAlign: "left" }, perso ? styles.puntiForti : vinto ? styles.puntiDeboli : null]}>{x.punti_avversario}</Text>
                    <View style={{ width: 72 }} />
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.azioniRiepilogo}>
          <Pressable testID="btn-riepilogo-pdf" onPress={onRiepilogoPdf} accessibilityRole="button" style={[styles.pillRiepilogo, styles.pillRiepilogoPrimaria]}>
            <Text style={styles.pillRiepilogoTestoPrimaria}>Riepilogo PDF</Text>
          </Pressable>
          <Pressable testID="btn-condividi-riepilogo" onPress={onCondividiRiepilogo} accessibilityRole="button" style={styles.pillRiepilogo}>
            <Text style={styles.pillRiepilogoTesto}>Condividi</Text>
          </Pressable>
        </View>

        {eventiAndamento.length > 0 && (
          <View style={styles.sezioneBlocco}>
            <Text style={styles.sezione}>Statistiche</Text>
            <View style={styles.scheda}>
              <StatSingola
                etichetta="Side-out (punti vinti quando riceviamo)"
                valore={servizioRicezione?.side_out_pct != null ? `${servizioRicezione.side_out_pct}%` : "—"}
                percentuale={servizioRicezione?.side_out_pct ?? null}
              />
              <StatSingola
                etichetta="Break-point (punti vinti quando battiamo)"
                valore={servizioRicezione?.break_point_pct != null ? `${servizioRicezione.break_point_pct}%` : "—"}
                percentuale={servizioRicezione?.break_point_pct ?? null}
              />
              <StatSingola
                etichetta={`Ricezione positiva (${ricezioniPositive}/${ricezioniTot})`}
                valore={percentuale(ricezioniPositive, ricezioniTot)}
                percentuale={ricezioniTot > 0 ? (ricezioniPositive / ricezioniTot) * 100 : null}
              />
              <StatSingola etichetta="Efficienza in attacco" valore={formattaEfficienza(efficienzaAttacco)} coloreValore={coloreEfficienza(efficienzaAttacco)} />
              <StatDoppia etichetta="Ace / errori in battuta" sx={aceBattuta} dx={erroriBattuta} coloreSx={brand.colors.success} coloreDx={brand.colors.error} />
              <StatSingola etichetta="Punti a muro" valore={String(puntiMuro)} />
              <StatDoppia etichetta="Errori nostri / punti diretti avversari" sx={erroriNostri} dx={puntiDirettiLoro} coloreSx={brand.colors.brand} coloreDx={brand.colors.brandSecondary} />
              <Text style={styles.dettaglioFondamentale}>"Errori nostri" sono quelli attribuiti a una giocatrice; "punti diretti avversari" sono i punti loro registrati senza un nostro errore specifico.</Text>
            </View>
          </View>
        )}

        {confronto && confronto.righe.some((r) => r.valore !== null) && (
          <View style={styles.sezioneBlocco}>
            <Text style={styles.sezione}>Rispetto alle ultime partite</Text>
            <Text style={styles.nota}>
              Confronto con la media delle ultime {confronto.partiteConfrontate.length} {confronto.partiteConfrontate.length === 1 ? "partita conclusa" : "partite concluse"} della squadra in questa stagione. La differenza è in punti percentuali; per gli errori in servizio meno è meglio.
            </Text>
            <View style={styles.schedaLista}>
              {confronto.righe.map((r, i) => {
                const colore = r.migliora === null ? brand.colors.muted : r.migliora ? brand.colors.success : brand.colors.error;
                const freccia = r.differenza === null || r.differenza === 0 ? "" : r.differenza > 0 ? "▲" : "▼";
                return (
                  <View key={r.chiave} style={[styles.rigaConfronto, i > 0 && styles.rigaConfrontoBordo]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.confrontoEtichetta}>{r.etichetta}</Text>
                      <Text style={styles.dettaglioPersona}>{r.media !== null ? `media ${Math.round(r.media)}%` : "nessun dato nelle altre partite"}</Text>
                    </View>
                    <Text style={styles.confrontoValore}>{r.valore !== null ? `${Math.round(r.valore)}%` : "—"}</Text>
                    <Text style={[styles.confrontoDifferenza, { color: colore }]}>
                      {r.differenza === null ? "—" : `${freccia} ${r.differenza > 0 ? "+" : ""}${decimale(r.differenza)}`.trim()}
                    </Text>
                  </View>
                );
              })}
            </View>
            {confronto.frase && (
              <Text style={[styles.fraseConfronto, confronto.problemi.length > 0 && { color: brand.colors.error }]}>{confronto.frase}</Text>
            )}
          </View>
        )}

        <View style={styles.sezioneBlocco}>
          <Text style={styles.sezione}>Efficienza per fondamentale</Text>
          <Text style={styles.nota}>Punti meno errori sulle azioni totali: dice quanto un fondamentale rende, non solo quante volte è stato usato.</Text>
          {fondamentali.length === 0 ? (
            <Text style={styles.vuoto}>Nessun evento registrato in questa partita.</Text>
          ) : (
            <View style={styles.scheda}>
            {fondamentali.map((f) => (
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
            ))}
            </View>
          )}
        </View>

        {servizioRicezione && (servizioRicezione.punti_in_battuta > 0 || servizioRicezione.punti_in_ricezione > 0) && (
          <View style={styles.sezioneBlocco}>
            <Text style={styles.sezione}>Side-out % / Break-point %</Text>
            <Text style={styles.nota}>Le due metriche-cardine dell'analisi pallavolistica: quanto si rende servendo e quanto si rende ricevendo.</Text>
            <View style={styles.scheda}>
              <StatSingola
                etichetta="Break-point (punti vinti in battuta)"
                valore={`${servizioRicezione.break_point_pct != null ? `${servizioRicezione.break_point_pct}%` : "—"} (${servizioRicezione.punti_vinti_in_battuta}/${servizioRicezione.punti_in_battuta})`}
                percentuale={servizioRicezione.break_point_pct ?? null}
              />
              <StatSingola
                etichetta="Side-out (punti vinti in ricezione)"
                valore={`${servizioRicezione.side_out_pct != null ? `${servizioRicezione.side_out_pct}%` : "—"} (${servizioRicezione.punti_vinti_in_ricezione}/${servizioRicezione.punti_in_ricezione})`}
                percentuale={servizioRicezione.side_out_pct ?? null}
              />
              <Text style={styles.dettaglioFondamentale}>
                Ricezioni: {servizioRicezione.ricezioni_ottime} perfette, {servizioRicezione.ricezioni_buone} buone, {servizioRicezione.ricezioni_scarse} scarse, {servizioRicezione.ricezioni_errori} errori.
              </Text>
            </View>
          </View>
        )}

        {attaccoPerZona.length > 0 && (
          <View style={styles.sezioneBlocco}>
            <Text style={styles.sezione}>Attacco: da quale zona rende di più</Text>
            <Text style={styles.nota}>
              La zona è la posizione del nostro campo da cui parte l'attacco (dalla rotazione, non serve indicare nulla). Efficienza = (punti − errori) / attacchi; efficacia = punti / attacchi. Per il confronto servono almeno {MIN_ATTACCHI_ZONA} attacchi dalla zona.
            </Text>
            {migliorePerEfficienza && (
              <Text style={styles.migliore}>⭐ Più efficiente: zona {migliorePerEfficienza.zona} ({formattaEfficienza(migliorePerEfficienza.efficienza)}){migliorePerEfficacia && migliorePerEfficacia.zona !== migliorePerEfficienza.zona ? ` · più efficace: zona ${migliorePerEfficacia.zona} (${Math.round(migliorePerEfficacia.efficacia * 100)}%)` : migliorePerEfficacia ? ` · anche la più efficace (${Math.round(migliorePerEfficacia.efficacia * 100)}%)` : ""}</Text>
            )}
            <View style={styles.scheda}>
            <View style={styles.rigaTabella}>
              <Text style={[styles.cellaFondamentale, styles.intestazioneTabella]}>Zona</Text>
              <Text style={[styles.cellaNumero, styles.intestazioneTabella]}>Att.</Text>
              <Text style={[styles.cellaNumero, styles.intestazioneTabella]}>Pt</Text>
              <Text style={[styles.cellaNumero, styles.intestazioneTabella]}>Err</Text>
              <Text style={[styles.cellaEfficienza, styles.intestazioneTabella]}>Effic.</Text>
              <Text style={[styles.cellaVoto, styles.intestazioneTabella]}>Effic.a</Text>
            </View>
            {attaccoPerZona.map((z) => (
              <View key={z.zona} style={styles.rigaTabella}>
                <Text style={styles.cellaFondamentale}>{z.zona}{z.zona === migliorePerEfficienza?.zona ? " ⭐" : ""}</Text>
                <Text style={styles.cellaNumero}>{z.azioni}</Text>
                <Text style={styles.cellaNumero}>{z.punti}</Text>
                <Text style={styles.cellaNumero}>{z.errori}</Text>
                <Text style={[styles.cellaEfficienza, { color: coloreEfficienza(z.efficienza) }]}>{formattaEfficienza(z.efficienza)}</Text>
                <Text style={styles.cellaVoto}>{Math.round(z.efficacia * 100)}%</Text>
              </View>
            ))}
            <Text style={styles.notaTabella}>Ultima colonna = efficacia (% di attacchi vincenti). Zone con meno di {MIN_ATTACCHI_ZONA} attacchi non entrano nel confronto. Attacchi con zona nota: {attacchiConZona} su {attacchiTotali}.</Text>
            </View>
          </View>
        )}

        {setGiocati.length > 0 && (
          <View style={styles.sezioneBlocco}>
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
          <View style={styles.sezioneBlocco}>
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
                  <Pressable onPress={() => alternaSetRivivi(x.id)} style={styles.rigaToccabile}>
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

        <View style={styles.sezioneBlocco}>
          <Text style={styles.sezione}>Contributo individuale</Text>
          <Text style={styles.nota}>Ordinate dal saldo migliore. Il voto è da 0 a 10 (n.c. sotto le {MIN_AZIONI_VOTO} azioni).{Object.keys(dettaglio).length > 0 ? " Tocca una giocatrice per vedere voto e numeri fondamentale per fondamentale." : ""}</Text>
          {migliore && (
            <View>
              <Pressable onPress={() => alternaDettaglio(migliore.athlete_id)}>
                <Text style={styles.migliore}>
                  ⭐ Migliore in campo: {nomeAtleta(migliore.athlete_id)} ({migliore.voto?.toFixed(1)}) {aperti.has(migliore.athlete_id) ? "▾" : "▸ vedi i fondamentali"}
                </Text>
              </Pressable>
              {aperti.has(migliore.athlete_id) && (
                (dettaglio[migliore.athlete_id] ?? []).length > 0
                  ? renderDettaglioPersona(migliore.athlete_id)
                  : <Text style={styles.nota}>Nessun dettaglio per fondamentale disponibile.</Text>
              )}
            </View>
          )}
          <Pressable onPress={() => setMostraCalcoloVoto((v) => !v)} style={styles.rigaToccabile}>
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
            <View style={styles.schedaLista}>
            {persone.map((p, i) => {
              const righe = dettaglio[p.athlete_id] ?? [];
              const espandibile = righe.length > 0;
              const aperta = espandibile && aperti.has(p.athlete_id);
              return (
                <View key={p.athlete_id} style={[styles.cardPersona, i === persone.length - 1 && { borderBottomWidth: 0 }]}>
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

                  {aperta && renderDettaglioPersona(p.athlete_id)}
                </View>
              );
            })}
            </View>
          )}
        </View>

        {(() => {
          const precedenti = partiteSquadra
            .filter((m) => m.id !== match.id && m.stato === "conclusa" && chiaveAvversario(m.avversario) === chiaveAvversario(match.avversario))
            .sort((a, b) => b.data.localeCompare(a.data));
          const vinte = precedenti.filter((m) => m.set_vinti_noi > m.set_vinti_avversario).length;
          return (
            <View style={styles.sezioneBlocco}>
              <Text style={styles.sezione}>Storico contro {match.avversario}</Text>
              {precedenti.length === 0 ? (
                <Text style={styles.nota}>Nessun'altra partita conclusa contro questa squadra in archivio.</Text>
              ) : (
                <>
                  <Text style={styles.nota}>
                    Altre {precedenti.length} {precedenti.length === 1 ? "partita" : "partite"} concluse: {vinte} {vinte === 1 ? "vittoria" : "vittorie"}, {precedenti.length - vinte} {precedenti.length - vinte === 1 ? "sconfitta" : "sconfitte"}. Il nome dell'avversario deve essere scritto uguale.
                  </Text>
                  <View style={styles.schedaLista}>
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
                  </View>
                </>
              )}
            </View>
          );
        })()}

        {andamento.length > 1 && (
          <View style={styles.sezioneBlocco}>
            <Text style={styles.sezione}>Tendenza nelle ultime partite</Text>
            <Text style={styles.nota}>Efficienza complessiva partita per partita: se scende per più gare di fila è un segnale da guardare in allenamento.</Text>
            <View style={styles.schedaLista}>
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
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8, width: "100%", maxWidth: 900, alignSelf: "center" },
  tastoIndietro: { minHeight: 44, justifyContent: "center" },
  indietro: { color: brand.colors.brand, fontWeight: "600", fontSize: 17 },
  statoPartita: { flex: 1, textAlign: "center", color: brand.colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  contenuto: { padding: 16, gap: 20, paddingBottom: 60, width: "100%", maxWidth: 900, alignSelf: "center" },
  sezioneBlocco: { gap: 10 },
  sezione: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  nota: { color: brand.colors.muted, fontSize: 12, lineHeight: 17 },
  vuoto: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 12 },
  scheda: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 16, gap: 14 },
  schedaLista: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, overflow: "hidden" },
  separatore: { height: 1, backgroundColor: brand.colors.border, marginLeft: 16 },
  rigaToccabile: { minHeight: 44, justifyContent: "center" },
  tabellone: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 4 },
  squadraTab: { flex: 1, alignItems: "center", gap: 6 },
  squadraTabNome: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "700", textAlign: "center" },
  stemma: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  stemmaTesto: { fontSize: 18, fontWeight: "800" },
  risultatoGrande: { fontSize: 52, fontWeight: "800", letterSpacing: -1, lineHeight: 58, textAlign: "center" },
  rigaSet: { flexDirection: "row", alignItems: "center", paddingVertical: 11, paddingHorizontal: 16, minHeight: 48 },
  rigaSetNome: { color: brand.colors.muted, fontSize: 14, fontWeight: "600" },
  rigaSetInCorso: { color: brand.colors.warning, fontSize: 11, fontWeight: "700" },
  rigaSetPunti: { flex: 1, color: brand.colors.onSurface, fontSize: 17, fontWeight: "500" },
  rigaSetTrattino: { width: 24, textAlign: "center", color: brand.colors.muted },
  puntiForti: { color: brand.colors.onSurface, fontWeight: "800" },
  puntiDeboli: { color: brand.colors.muted, fontWeight: "500" },
  stat: { gap: 5 },
  statRiga: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  statEtichetta: { flex: 1, color: brand.colors.onSurfaceSecondary, fontSize: 14, fontWeight: "500" },
  statEtichettaCentro: { flex: 1, color: brand.colors.onSurfaceSecondary, fontSize: 14, fontWeight: "500", textAlign: "center" },
  statValore: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "800" },
  statValoreLato: { minWidth: 28, color: brand.colors.onSurface, fontSize: 14, fontWeight: "800" },
  statTraccia: { height: 6, borderRadius: 3, backgroundColor: brand.colors.surfaceTertiary, overflow: "hidden" },
  statRiempimento: { height: 6, borderRadius: 3, backgroundColor: brand.colors.brand },
  statDoppiaBarra: { flexDirection: "row", gap: 4, height: 6 },
  rigaFondamentale: { gap: 5 },
  rigaTitoloFondamentale: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  nomeFondamentale: { color: brand.colors.onSurfaceSecondary, fontSize: 14, fontWeight: "500" },
  valoreEfficienza: { fontSize: 14, fontWeight: "800" },
  barraSfondo: { height: 6, backgroundColor: brand.colors.surfaceTertiary, borderRadius: 3, overflow: "hidden" },
  barraRiempimento: { height: "100%", borderRadius: 3 },
  dettaglioFondamentale: { color: brand.colors.muted, fontSize: 11 },
  cardPersona: { borderBottomWidth: 1, borderBottomColor: brand.colors.border, paddingHorizontal: 16 },
  rigaPersona: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, minHeight: 56 },
  tabellaDettaglio: { backgroundColor: brand.colors.surfaceTertiary, borderRadius: 12, padding: 12, marginBottom: 12, gap: 4 },
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
  rigaRivivi: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 3 },
  punteggioRivivi: { width: 52, fontSize: 13, fontWeight: "800", textAlign: "right" },
  testoRivivi: { flex: 1, color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  timeoutRivivi: { color: brand.colors.warning, fontSize: 11, fontWeight: "700", paddingLeft: 62, paddingVertical: 2 },
  migliore: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "700", paddingVertical: 10 },
  linkCalcolo: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "700" },
  votoPersona: { fontSize: 18, fontWeight: "800" },
  posizionePersona: { color: brand.colors.muted, fontSize: 13, fontWeight: "700", width: 20 },
  nomePersona: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "600" },
  dettaglioPersona: { color: brand.colors.muted, fontSize: 11, marginTop: 2 },
  rigaAndamento: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, paddingHorizontal: 16, minHeight: 44, borderBottomWidth: 1, borderBottomColor: brand.colors.border, gap: 8 },
  rigaAndamentoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13, flex: 1 },
  bottoneEsporta: { backgroundColor: brand.colors.surfaceTertiary, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
  bottoneEsportaTesto: { color: brand.colors.onSurface, fontSize: 12, fontWeight: "700" },
  chipZona: { paddingVertical: 10, paddingHorizontal: 16, minHeight: 44, justifyContent: "center", borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary },
  chipZonaAttivo: { backgroundColor: brand.colors.brand },
  chipZonaTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipZonaTestoAttivo: { color: "#000", fontWeight: "700" },
  bloccoSet: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 14, gap: 4 },
  titoloSet: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "700" },
  trendBox: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: brand.colors.border, gap: 4 },
  trendTitolo: { color: brand.colors.brandSecondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  azioniRiepilogo: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  pillRiepilogo: { minHeight: 44, paddingHorizontal: 20, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  pillRiepilogoPrimaria: { backgroundColor: brand.colors.brand },
  pillRiepilogoTesto: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  pillRiepilogoTestoPrimaria: { color: "#000", fontSize: 15, fontWeight: "700" },
  rigaConfronto: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 16, minHeight: 56 },
  rigaConfrontoBordo: { borderTopWidth: 1, borderTopColor: brand.colors.border },
  confrontoEtichetta: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "600" },
  confrontoValore: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "800", minWidth: 52, textAlign: "right" },
  confrontoDifferenza: { fontSize: 14, fontWeight: "800", minWidth: 78, textAlign: "right" },
  fraseConfronto: { color: brand.colors.onSurfaceSecondary, fontSize: 14, fontWeight: "600", lineHeight: 20 },
  cellaTrend: { width: 42, textAlign: "right", fontSize: 11, fontWeight: "700", color: brand.colors.onSurfaceSecondary },
});
