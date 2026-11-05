import { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, RefreshControl, ActivityIndicator, Modal, ScrollView } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { andamentoSquadraPartite, analisiPersonePartita, convertiPartitaInAllenamento, generaCommentoPartitaAI, creaMatch, eliminaPartita, impostaLuogoPartita, elencaPartite, elencaSet, ricominciaPartita, rendimentoRotazioniPartita, type AndamentoSquadraPartiteVoce, type RendimentoRotazionePartita } from "@/src/services/matches";
import { elencaCampionati, riassegnaCampionatoPartita } from "@/src/services/championships";
import { brand } from "@/src/config";
import type { Campionato, Match, MatchSet } from "@/src/types/database";
import { avvisa, confermaAzione } from "@/src/lib/confermaAzione";
import { cambiaCodiceScout, elencaScoutAnonimi, escludiScoutAnonimo, linkScout, ottieniCodiceScout, rilasciaTurnoScout, type ScoutAnonimo } from "@/src/services/scoutQr";
import { CodiceQr } from "@/src/components/CodiceQr";
import { IndicatoreScoutQr } from "@/src/components/IndicatoreScoutQr";
import { MessaggioWhatsApp } from "@/src/components/MessaggioWhatsApp";
import { TitoloGrande } from "@/src/components/TitoloGrande";
import { CondividiGenitori } from "@/src/components/CondividiGenitori";
import { commentoPartita, inviaLinkScout } from "@/src/lib/messaggiWhatsApp";
import { Ionicons } from "@expo/vector-icons";

/** "OGGI · 21:00" oppure "GIO 5 NOV · 21:00" per la scheda in evidenza. */
function etichettaQuando(iso: string): string {
  const d = new Date(iso);
  const ora = d.getHours() === 0 && d.getMinutes() === 0 ? "" : ` · ${d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
  const giorno = d.toDateString() === new Date().toDateString()
    ? "OGGI"
    : d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "").toUpperCase();
  return `${giorno}${ora}`;
}

/** Iniziali del nome di una squadra, per il cerchio al posto dello stemma. */
function iniziali(nome: string): string {
  const parti = nome.trim().split(/\s+/).filter(Boolean);
  if (parti.length === 0) return "?";
  return (parti.length === 1 ? parti[0].slice(0, 2) : parti[0][0] + parti[1][0]).toUpperCase();
}

export default function Partite() {
  const { team, puoScrivere, isSuperuser, puoVedereAnalisi } = useAuth();
  // Stessa regola applicata dal database (funzione elimina_partita):
  // allenatore/vice della squadra oppure superuser.
  const puoEliminare = puoScrivere || isSuperuser;
  const [partite, setPartite] = useState<Match[]>([]);
  const [andamento, setAndamento] = useState<AndamentoSquadraPartiteVoce[]>([]);
  const [campionati, setCampionati] = useState<Campionato[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [avversario, setAvversario] = useState("");
  const [luogo, setLuogo] = useState<"casa" | "trasferta">("casa");
  const [tipoGara, setTipoGara] = useState<"campionato" | "amichevole">("amichevole");
  const [campionatoId, setCampionatoId] = useState<string | null>(null);
  const [pickerCampionatoMatchId, setPickerCampionatoMatchId] = useState<string | null>(null);
  // Chiuso di default: occupava spazio in cima anche quando non serviva.
  const [mostraAndamento, setMostraAndamento] = useState(false);
  const [mostraPassate, setMostraPassate] = useState(false);
  const [rotazioniPartita, setRotazioniPartita] = useState<{ nome: string; righe: RendimentoRotazionePartita[] } | null>(null);

  // Toccando una partita conclusa: prima i punteggi dei set, poi la scelta dell'analisi.
  const [whatsappPartita, setWhatsappPartita] = useState<{ match: Match; sets: MatchSet[]; testo: string } | null>(null);
  const [generandoCommento, setGenerandoCommento] = useState(false);
  const [menuPartita, setMenuPartita] = useState<{ match: Match; sets: MatchSet[] } | null>(null);

  /** L'AI scrive il commento sui numeri della partita; se non risponde si parte dal solo risultato. Il testo resta modificabile. */
  async function preparaCommentoGruppo() {
    if (!menuPartita || !team) return;
    const { match, sets } = menuPartita;
    setGenerandoCommento(true);
    try {
      const persone = await analisiPersonePartita(match.id).catch(() => []);
      const nomi = new Map(persone.map((p) => [p.athlete_id, p.nome_completo]));
      const r = await generaCommentoPartitaAI(team.id, match, sets, nomi);
      const intestazione = commentoPartita(match, sets, team.nome);
      if (r.errore || !r.testo) {
        avvisa("Commento automatico non disponibile", `${r.messaggio ?? "Errore"}\n\nTi ho preparato il risultato: il commento lo scrivi tu.`);
        setWhatsappPartita({ match, sets, testo: intestazione });
      } else {
        setWhatsappPartita({ match, sets, testo: `${intestazione.trimEnd()}\n\n${r.testo}` });
      }
      setMenuPartita(null);
    } finally {
      setGenerandoCommento(false);
    }
  }

  async function apriRotazioni(m: Match) {
    try {
      const righe = await rendimentoRotazioniPartita(m.id);
      setRotazioniPartita({ nome: m.avversario, righe });
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      const [listaPartite, listaAndamento, listaCampionati] = await Promise.all([
        elencaPartite(team.id),
        andamentoSquadraPartite(team.id).catch(() => []),
        elencaCampionati(team.id).catch(() => []),
      ]);
      setPartite(listaPartite);
      setAndamento(listaAndamento);
      setCampionati(listaCampionati);
    } finally {
      setCaricamento(false);
    }
  }, [team, puoScrivere]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  // Ordine: dalla piu' vicina a oggi alla piu' lontana. Una partita conclusa e' "passata"
  // (nascosta) dal giorno prima della prossima partita da giocare; quelle non concluse
  // restano sempre visibili.
  const { visibili, nascoste } = (() => {
    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
    const adesso = Date.now();
    const prossima = partite
      .filter((m) => m.stato !== "conclusa" && new Date(m.data).getTime() >= oggi.getTime())
      .sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime())[0];
    let soglia: number | null = null;
    if (prossima) { const g = new Date(prossima.data); g.setHours(0, 0, 0, 0); soglia = g.getTime() - 24 * 3600 * 1000; }
    const sonoPassate = (m: Match) => m.stato === "conclusa" && soglia !== null && adesso >= soglia;
    const ordinate = [...partite].sort((a, b) => Math.abs(new Date(a.data).getTime() - adesso) - Math.abs(new Date(b.data).getTime() - adesso));
    return { visibili: ordinate.filter((m) => !sonoPassate(m)), nascoste: ordinate.filter(sonoPassate) };
  })();
  const elenco = mostraPassate ? [...visibili, ...nascoste].sort((a, b) => Math.abs(new Date(a.data).getTime() - Date.now()) - Math.abs(new Date(b.data).getTime() - Date.now())) : visibili;

  async function nuovaPartita() {
    if (!team || !avversario.trim()) return;
    try {
      const matchId = await creaMatch(team.id, avversario.trim(), new Date().toISOString(), luogo, tipoGara === "campionato" ? campionatoId : null, tipoGara);
      setAvversario("");
      router.push(`/partita/${matchId}/prepara`);
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    }
  }

  function apriPartita(m: Match) {
    if (m.stato === "programmata") {
      if (!puoScrivere) { avvisa("Partita non ancora iniziata", "L'allenatore non ha ancora preparato questa partita."); return; }
      router.push(`/partita/${m.id}/prepara`);
      return;
    }
    if (m.stato === "conclusa") {
      elencaSet(m.id)
        .then((sets) => setMenuPartita({ match: m, sets: sets.filter((x) => x.punti_noi + x.punti_avversario > 0).sort((a, b) => a.numero_set - b.numero_set) }))
        .catch(() => setMenuPartita({ match: m, sets: [] }));
      return;
    }
    router.push(`/partita/${m.id}`);
  }

  function chiediConversioneInAllenamento(m: Match) {
    confermaAzione(
      "Convertire in allenamento?",
      `"${m.avversario}" del ${new Date(m.data).toLocaleDateString("it-IT")} verrà spostato tra gli allenamenti. Usalo quando la lettura automatica del calendario SportEasy ha sbagliato categoria.`,
      "Sposta tra gli allenamenti",
      async () => {
        try {
          await convertiPartitaInAllenamento(m.id);
          carica();
          avvisa("Convertito", "Lo trovi ora nella tab Allenamenti.");
        } catch (e) { avvisa("Impossibile convertire", (e as Error).message); }
      },
    );
  }

  // Scout esterno: persona che registra UNA partita col QR/link (vede solo quella, solo finche' e' in corso).
  const [ospitiPartita, setOspitiPartita] = useState<Match | null>(null);

  // Scout senza account: QR della partita e persone agganciate.
  const [codiceQr, setCodiceQr] = useState<string | null>(null);
  const [anonimi, setAnonimi] = useState<ScoutAnonimo[]>([]);
  const [mostraQr, setMostraQr] = useState(false);
  const [linkCopiato, setLinkCopiato] = useState(false);
  const [whatsappScout, setWhatsappScout] = useState(false);

  async function caricaAnonimi(matchId: string) {
    try { setAnonimi(await elencaScoutAnonimi(matchId)); } catch { /* resta l'elenco di prima */ }
  }

  async function onMostraQr() {
    if (!ospitiPartita) return;
    try {
      setCodiceQr(await ottieniCodiceScout(ospitiPartita.id));
      setMostraQr(true);
    } catch (e) { avvisa("QR non disponibile", (e as Error).message); }
  }

  function onCambiaCodice() {
    if (!ospitiPartita) return;
    confermaAzione(
      "Cambiare il codice?",
      "Il QR attuale smette di funzionare: chi è già dentro resta collegato, chi non è ancora entrato dovrà usare il nuovo QR.",
      "Cambia codice",
      async () => {
        try { setCodiceQr(await cambiaCodiceScout(ospitiPartita.id)); setLinkCopiato(false); }
        catch (e) { avvisa("Impossibile cambiare il codice", (e as Error).message); }
      },
    );
  }

  async function onCopiaLink() {
    if (!codiceQr) return;
    try {
      await (navigator as unknown as { clipboard: { writeText: (t: string) => Promise<void> } }).clipboard.writeText(linkScout(codiceQr));
      setLinkCopiato(true);
      setTimeout(() => setLinkCopiato(false), 3000);
    } catch { avvisa("Copia non riuscita", "Seleziona e copia il link a mano."); }
  }

  async function onEscludiAnonimo(a: ScoutAnonimo) {
    if (!ospitiPartita) return;
    try { await escludiScoutAnonimo(a.id, !a.escluso); await caricaAnonimi(ospitiPartita.id); }
    catch (e) { avvisa("Operazione non riuscita", (e as Error).message); }
  }

  async function onLiberaTurno() {
    if (!ospitiPartita) return;
    try { await rilasciaTurnoScout(ospitiPartita.id); await caricaAnonimi(ospitiPartita.id); }
    catch (e) { avvisa("Operazione non riuscita", (e as Error).message); }
  }

  // Finestra aperta: l'elenco degli scout col QR si aggiorna da solo.
  useEffect(() => {
    if (!ospitiPartita) return;
    caricaAnonimi(ospitiPartita.id);
    const t = setInterval(() => caricaAnonimi(ospitiPartita.id), 5000);
    return () => clearInterval(t);
  }, [ospitiPartita?.id]);

  function apriOspiti(m: Match) {
    setOspitiPartita(m);
    setMostraQr(false);
    setCodiceQr(null);
    setAnonimi([]);
  }

  function chiediEliminazione(m: Match) {
    const quando = new Date(m.data).toLocaleDateString("it-IT");
    const haDati = m.stato !== "programmata";
    confermaAzione(
      "Eliminare la partita?",
      `"vs ${m.avversario}" del ${quando} verrà eliminata definitivamente${haDati ? ", insieme a set, formazioni e azioni di scouting registrate" : ""}. L'operazione non si può annullare.`,
      "Elimina",
      async () => {
        try {
          await eliminaPartita(m.id);
          setPartite((prev) => prev.filter((p) => p.id !== m.id));
          carica();
        } catch (e) { avvisa("Impossibile eliminare", (e as Error).message); }
      },
      true,
    );
  }

  async function chiediAzzeramento(m: Match) {
    try {
      const sets = await elencaSet(m.id);
      if (sets.length > 1 || sets.some((x) => x.concluso)) {
        avvisa("Non più possibile", "La partita si può azzerare solo durante il primo set. Ora si può correggere la formazione dalla schermata di scouting (✏️ Formazione).");
        return;
      }
    } catch (e) { avvisa("Errore", (e as Error).message); return; }
    confermaAzione(
      "Azzerare la partita?",
      `"vs ${m.avversario}" torna "da preparare": vengono cancellati set, punti, azioni, formazioni e convocati (Libero compresi). Il collegamento con SportEasy resta. Dovrai rifare convocati, Libero e formazione di partenza.`,
      "Azzera",
      async () => {
        try {
          await ricominciaPartita(m.id);
          carica();
        } catch (e) { avvisa("Impossibile azzerare", (e as Error).message); }
      },
      true,
    );
  }

  async function onCambiaLuogo(matchId: string, luogo: "casa" | "trasferta") {
    try {
      await impostaLuogoPartita(matchId, luogo);
      setPartite((prev) => prev.map((p) => (p.id === matchId ? { ...p, luogo } : p)));
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    }
  }

  async function onScegliCampionato(matchId: string, campionatoId: string | null) {
    try {
      await riassegnaCampionatoPartita(matchId, campionatoId);
      setPickerCampionatoMatchId(null);
      carica();
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    }
  }

  // Scheda in evidenza: la prima partita ancora da giocare (oggi o futura) che non è già in diretta.
  const prossimaPartita = (() => {
    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
    return partite
      .filter((m) => m.stato === "programmata" && new Date(m.data).getTime() >= oggi.getTime())
      .sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime())[0] ?? null;
  })();

  // Partite raggruppate per giorno, nello stesso ordine dell'elenco (dalla piu' vicina a oggi).
  const gruppi = (() => {
    const mappa = new Map<string, { chiave: string; etichetta: string; partite: Match[] }>();
    for (const p of elenco) {
      if (prossimaPartita && p.id === prossimaPartita.id) continue;
      const d = new Date(p.data);
      const chiave = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      let g = mappa.get(chiave);
      if (!g) {
        g = { chiave, etichetta: d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" }), partite: [] };
        mappa.set(chiave, g);
      }
      g.partite.push(p);
    }
    return Array.from(mappa.values());
  })();
  const inDiretta = visibili.filter((m) => m.stato === "in_corso");

  /** Azioni di una partita (luogo, campionato, analisi, scout QR, elimina): nella riga dell'elenco e nella scheda "Prossima partita". */
  function renderAzioniPartita(item: Match, inScheda = false) {
    const haAzioni = puoEliminare || (puoVedereAnalisi && item.stato !== "programmata");
    if (!haAzioni) return null;
    return (
            <View style={[styles.azioniPartita, inScheda && styles.azioniInScheda]}>
              {puoScrivere && (
                <View style={styles.selettoreRiga}>
                  {(["casa", "trasferta"] as const).map((l) => (
                    <Pressable key={l} onPress={() => item.luogo !== l && onCambiaLuogo(item.id, l)} hitSlop={{ top: 6, bottom: 6 }} style={[styles.pillola, item.luogo === l && styles.chipAttivo]}>
                      <Text style={[styles.pillolaTesto, item.luogo === l && styles.chipTestoAttivo]}>{l === "casa" ? "🏠 Casa" : "🚌 Trasferta"}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {puoScrivere && (
                <Pressable onPress={() => setPickerCampionatoMatchId(pickerCampionatoMatchId === item.id ? null : item.id)} hitSlop={{ top: 8, bottom: 8 }}>
                  <Text style={styles.linkCampionato}>
                    Campionato: {campionati.find((c) => c.id === item.campionato_id)?.nome ?? "nessuno (amichevole)"} — tocca per cambiare
                  </Text>
                </Pressable>
              )}
              {pickerCampionatoMatchId === item.id && (
                <View style={styles.selettoreRiga}>
                  <Pressable onPress={() => onScegliCampionato(item.id, null)} hitSlop={{ top: 6, bottom: 6 }} style={[styles.pillola, !item.campionato_id && styles.chipAttivo]}>
                    <Text style={[styles.pillolaTesto, !item.campionato_id && styles.chipTestoAttivo]}>Amichevole</Text>
                  </Pressable>
                  {campionati.map((c) => (
                    <Pressable key={c.id} onPress={() => onScegliCampionato(item.id, c.id)} hitSlop={{ top: 6, bottom: 6 }} style={[styles.pillola, item.campionato_id === c.id && styles.chipAttivo]}>
                      <Text style={[styles.pillolaTesto, item.campionato_id === c.id && styles.chipTestoAttivo]}>{c.nome}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {puoScrivere && (
                <Pressable onPress={() => chiediConversioneInAllenamento(item)} hitSlop={{ top: 8, bottom: 8 }}>
                  <Text style={styles.linkConverti}>È un allenamento — spostalo</Text>
                </Pressable>
              )}
              {puoEliminare && item.stato === "in_corso" && <IndicatoreScoutQr matchId={item.id} />}
              {puoVedereAnalisi && item.stato !== "programmata" && (
                <View style={styles.selettoreRiga}>
                  <Pressable onPress={() => router.push(`/analisi-partita/${item.id}`)} hitSlop={{ top: 6, bottom: 6 }} style={styles.pillola}>
                    <Text style={styles.pillolaTestoLink}>📈 Analisi completa</Text>
                  </Pressable>
                  <Pressable onPress={() => apriRotazioni(item)} hitSlop={{ top: 6, bottom: 6 }} style={styles.pillola}>
                    <Text style={styles.pillolaTestoLink}>📊 Rotazioni</Text>
                  </Pressable>
                </View>
              )}
              {puoEliminare && (
                <View style={styles.selettoreRiga}>
                  {item.stato !== "conclusa" && (
                    <Pressable onPress={() => apriOspiti(item)} hitSlop={{ top: 6, bottom: 6 }} style={styles.bottoneOspite}>
                      <Text style={styles.bottoneOspiteTesto}>📋 Scout con QR</Text>
                    </Pressable>
                  )}
                  {item.stato === "in_corso" && (
                    <Pressable onPress={() => chiediAzzeramento(item)} hitSlop={{ top: 6, bottom: 6 }} style={styles.bottoneAzzera}>
                      <Text style={styles.bottoneAzzeraTesto}>↺ Azzera partita (solo 1° set)</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={() => chiediEliminazione(item)} hitSlop={{ top: 6, bottom: 6 }} style={styles.bottoneElimina}>
                    <Ionicons name="trash-outline" size={14} color={brand.colors.error} />
                    <Text style={styles.bottoneEliminaTesto}>Elimina partita</Text>
                  </Pressable>
                </View>
              )}
            </View>
    );
  }

  return (
    <View style={styles.container}>
      {team && whatsappPartita && (
        <MessaggioWhatsApp
          visibile
          titolo={`Gruppo WhatsApp — vs ${whatsappPartita.match.avversario}`}
          modelli={[{ etichetta: "Commento", testo: whatsappPartita.testo }]}
          onChiudi={() => setWhatsappPartita(null)}
        />
      )}

      <Modal visible={!!menuPartita} animationType="slide" transparent onRequestClose={() => setMenuPartita(null)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>vs {menuPartita?.match.avversario}</Text>
            <Text style={styles.nota}>
              {menuPartita ? new Date(menuPartita.match.data).toLocaleDateString("it-IT") : ""} — Set vinti {menuPartita?.match.set_vinti_noi} - {menuPartita?.match.set_vinti_avversario}
            </Text>
            <View style={{ gap: 4, marginVertical: 8 }}>
              {(menuPartita?.sets ?? []).length === 0 ? (
                <Text style={styles.nota}>Nessun punteggio di set registrato.</Text>
              ) : menuPartita!.sets.map((x) => (
                <View key={x.id} style={styles.rigaRotazione}>
                  <Text style={styles.rigaRotazioneNome}>Set {x.numero_set}</Text>
                  <Text style={[styles.rigaRotazioneSaldo, x.punti_noi < x.punti_avversario && styles.saldoNegativo]}>{x.punti_noi} - {x.punti_avversario}</Text>
                </View>
              ))}
            </View>
            {(puoVedereAnalisi || puoScrivere) && <Text style={styles.titoloPopup}>Quale analisi vuoi vedere?</Text>}
            <View style={{ gap: 8, marginTop: 8 }}>
              {puoVedereAnalisi && (
                <Pressable style={styles.bottone} onPress={() => { const m = menuPartita!.match; setMenuPartita(null); router.push(`/analisi-partita/${m.id}`); }}>
                  <Text style={styles.bottoneTesto}>📈 Analisi completa</Text>
                </Pressable>
              )}
              {puoVedereAnalisi && (
                <Pressable style={styles.bottone} onPress={() => { const m = menuPartita!.match; setMenuPartita(null); apriRotazioni(m); }}>
                  <Text style={styles.bottoneTesto}>📊 Analisi per rotazione</Text>
                </Pressable>
              )}
              {puoScrivere && (
                <Pressable style={styles.bottoneSecondario} onPress={preparaCommentoGruppo} disabled={generandoCommento}>
                  <Text style={styles.bottoneSecondarioTesto}>{generandoCommento ? "Sto scrivendo il commento…" : "💬 Commento al gruppo WhatsApp"}</Text>
                </Pressable>
              )}
            </View>
            <Pressable onPress={() => setMenuPartita(null)}><Text style={styles.chiudiPopup}>Chiudi</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!rotazioniPartita} animationType="slide" transparent onRequestClose={() => setRotazioniPartita(null)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>Rotazioni — vs {rotazioniPartita?.nome}</Text>
            <Text style={styles.nota}>Identificate da chi era in posizione 1 al servizio. Dalla peggiore.</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {(rotazioniPartita?.righe ?? []).length === 0 ? (
                <Text style={styles.nota}>Nessun dato per rotazione: servono eventi registrati con la formazione impostata.</Text>
              ) : rotazioniPartita!.righe.map((r, i) => (
                <View key={i} style={styles.rigaRotazione}>
                  <Text style={styles.rigaRotazioneNome}>{r.rotazione_di}</Text>
                  <Text style={[styles.rigaRotazioneSaldo, r.saldo < 0 && styles.saldoNegativo]}>
                    {r.saldo >= 0 ? "+" : ""}{r.saldo} ({r.punti_fatti}/{r.errori_commessi} su {r.azioni_totali})
                  </Text>
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setRotazioniPartita(null)}><Text style={styles.chiudiPopup}>Chiudi</Text></Pressable>
          </View>
        </View>
      </Modal>

      {team && ospitiPartita && codiceQr && whatsappScout && (
        <MessaggioWhatsApp
          visibile
          titolo={`Link scout — vs ${ospitiPartita.avversario}`}
          nota="Si apre WhatsApp col messaggio e il link pronti: scegli tu la persona a cui mandarlo e premi invia."
          modelli={[{ etichetta: "Link scout", testo: inviaLinkScout(team.nome, ospitiPartita.avversario, linkScout(codiceQr)) }]}
          onChiudi={() => setWhatsappScout(false)}
        />
      )}

      <Modal visible={!!ospitiPartita} animationType="slide" transparent onRequestClose={() => setOspitiPartita(null)}>
        <View style={styles.sfondoPopup}>
          <View style={[styles.cartaPopup, { maxHeight: "92%" }]}>
          <ScrollView contentContainerStyle={{ gap: 10 }}>
            <Text style={styles.titoloPopup}>Scout con QR — vs {ospitiPartita?.avversario}</Text>
            <Text style={styles.nota}>
              Chi apre il QR scrive il suo nome ed entra subito, senza account. Vede solo questa partita, finché è in corso. Può registrare, fare cambi e gestire il Libero, aprire il set successivo (a set finito) e inserire la formazione. La partita la chiude solo lo staff. Registra una persona alla volta: le altre guardano e possono subentrare.
            </Text>
            {!mostraQr ? (
              <Pressable style={styles.bottone} onPress={onMostraQr}>
                <Text style={styles.bottoneTesto}>Mostra il QR</Text>
              </Pressable>
            ) : codiceQr ? (
              <View style={{ gap: 8 }}>
                <CodiceQr testo={linkScout(codiceQr)} dimensione={220} />
                <Text style={[styles.nota, { textAlign: "center" }]} selectable>{linkScout(codiceQr)}</Text>
                <View style={styles.selettoreRiga}>
                  <Pressable style={styles.chip} onPress={() => setWhatsappScout(true)}><Text style={styles.chipTesto}>💬 Manda su WhatsApp</Text></Pressable>
                  <Pressable style={styles.chip} onPress={onCopiaLink}><Text style={styles.chipTesto}>{linkCopiato ? "Copiato ✓" : "Copia il link"}</Text></Pressable>
                  <Pressable style={styles.chip} onPress={onCambiaCodice}><Text style={styles.chipTesto}>Cambia codice</Text></Pressable>
                  <Pressable style={styles.chip} onPress={() => setMostraQr(false)}><Text style={styles.chipTesto}>Nascondi</Text></Pressable>
                </View>
              </View>
            ) : null}
            {ospitiPartita && (
              <CondividiGenitori matchId={ospitiPartita.id} squadra={team?.nome} avversario={ospitiPartita.avversario} />
            )}
            {anonimi.length > 0 && (
              <View>
                <Text style={styles.nota}>Collegati col QR:</Text>
                {anonimi.map((a) => (
                  <View key={a.id} style={styles.rigaRotazione}>
                    <Text style={[styles.rigaRotazioneNome, a.escluso && { textDecorationLine: "line-through" }]} numberOfLines={1}>
                      {a.nome}{a.ha_turno ? " · sta registrando ✍️" : ""}{a.escluso ? " · escluso" : ""}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 14 }}>
                      {a.ha_turno && <Pressable onPress={onLiberaTurno} hitSlop={8}><Text style={styles.linkCampionato}>Libera turno</Text></Pressable>}
                      <Pressable onPress={() => onEscludiAnonimo(a)} hitSlop={8}>
                        <Text style={a.escluso ? styles.linkCampionato : styles.erroreTesto}>{a.escluso ? "Riammetti" : "Escludi"}</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <Pressable onPress={() => setOspitiPartita(null)}><Text style={styles.chiudiPopup}>Chiudi</Text></Pressable>
          </ScrollView>
          </View>
        </View>
      </Modal>

      <FlatList
        data={gruppi}
        keyExtractor={(g) => g.chiave}
        contentContainerStyle={styles.contenuto}
        ListHeaderComponent={
          <View style={{ gap: 16, marginBottom: 12 }}>
            <TitoloGrande titolo="Partite" />

            {inDiretta.map((m) => {
              const nomeNoi = team?.nome ?? "Noi";
              const competizione = campionati.find((c) => c.id === m.campionato_id)?.nome ?? (m.tipo_gara === "campionato" ? "Campionato" : "Amichevole");
              return (
                <View key={m.id} style={styles.cardLive}>
                  <View style={styles.cardLiveTesta}>
                    <Text style={styles.cardLiveCompetizione} numberOfLines={1}>{competizione.toUpperCase()}</Text>
                    <View style={styles.pillolaLive}>
                      <View style={styles.puntoLive} />
                      <Text style={styles.pillolaLiveTesto}>IN DIRETTA</Text>
                    </View>
                  </View>
                  <View style={styles.cardLiveCentro}>
                    <View style={styles.squadraLive}>
                      <View style={[styles.stemma, styles.stemmaNoi]}><Text style={[styles.stemmaTesto, { color: brand.colors.brand }]}>{iniziali(nomeNoi)}</Text></View>
                      <Text style={styles.squadraLiveNome} numberOfLines={2}>{nomeNoi}</Text>
                    </View>
                    <View style={{ alignItems: "center" }}>
                      <Text style={styles.punteggioLive}>{m.set_vinti_noi} – {m.set_vinti_avversario}</Text>
                      <Text style={styles.nota}>Set vinti</Text>
                    </View>
                    <View style={styles.squadraLive}>
                      <View style={[styles.stemma, styles.stemmaAvversario]}><Text style={[styles.stemmaTesto, { color: brand.colors.onSurfaceSecondary }]}>{iniziali(m.avversario)}</Text></View>
                      <Text style={styles.squadraLiveNome} numberOfLines={2}>{m.avversario}</Text>
                    </View>
                  </View>
                  <Pressable style={styles.bottonePrincipale} onPress={() => apriPartita(m)}>
                    <Text style={styles.bottonePrincipaleTesto}>{puoScrivere ? "Apri la partita" : "Guarda la diretta"}</Text>
                  </Pressable>
                </View>
              );
            })}

            {prossimaPartita && (() => {
              const m = prossimaPartita;
              const nomeNoi = team?.nome ?? "Noi";
              const inCasa = m.luogo === "casa";
              const competizione = campionati.find((c) => c.id === m.campionato_id)?.nome ?? (m.tipo_gara === "campionato" ? "Campionato" : "Amichevole");
              return (
                <View style={{ gap: 12 }}>
                  <Text style={styles.titoloSezioneGrande}>Prossima partita</Text>
                  <View style={styles.schedaEvidenza}>
                    <View style={{ gap: 6 }}>
                      <Text style={styles.evidenzaQuando}>{etichettaQuando(m.data)}</Text>
                      <Text style={styles.evidenzaTitolo} numberOfLines={3}>{inCasa ? `${nomeNoi} – ${m.avversario}` : `${m.avversario} – ${nomeNoi}`}</Text>
                      <Text style={styles.evidenzaSotto}>{competizione} · {inCasa ? "Casa" : "Trasferta"}</Text>
                      <Text style={[styles.badge, styles.badgeProgrammata, { alignSelf: "flex-start" }]}>Da preparare</Text>
                    </View>
                    {puoScrivere && (
                      <Pressable style={styles.bottonePrincipale} onPress={() => apriPartita(m)} accessibilityRole="button">
                        <Text style={styles.bottonePrincipaleTesto}>Prepara la partita</Text>
                      </Pressable>
                    )}
                    {renderAzioniPartita(m, true)}
                  </View>
                </View>
              );
            })()}

      {puoScrivere && (
        <>
          <Text style={styles.sezionePiccola}>Nuova partita</Text>
          <View style={styles.form}>
            <TextInput style={styles.input} placeholder="Avversario" placeholderTextColor={brand.colors.muted} value={avversario} onChangeText={setAvversario} />
            <View style={styles.selettoreRiga}>
              {(["casa", "trasferta"] as const).map((l) => (
                <Pressable key={l} onPress={() => setLuogo(l)} style={[styles.chip, luogo === l && styles.chipAttivo]}>
                  <Text style={[styles.chipTesto, luogo === l && styles.chipTestoAttivo]}>{l === "casa" ? "Casa" : "Trasferta"}</Text>
                </Pressable>
              ))}
              {(["amichevole", "campionato"] as const).map((t) => (
                <Pressable key={t} onPress={() => setTipoGara(t)} style={[styles.chip, tipoGara === t && styles.chipAttivo]}>
                  <Text style={[styles.chipTesto, tipoGara === t && styles.chipTestoAttivo]}>{t === "amichevole" ? "Amichevole" : "Campionato"}</Text>
                </Pressable>
              ))}
            </View>
            {tipoGara === "campionato" && (
              <View style={styles.selettoreRiga}>
                {campionati.length === 0 ? (
                  <Text style={styles.nota}>Nessun campionato configurato — aggiungine uno da Impostazioni, oppure procedi come amichevole.</Text>
                ) : (
                  campionati.map((c) => (
                    <Pressable key={c.id} onPress={() => setCampionatoId(c.id)} style={[styles.chip, campionatoId === c.id && styles.chipAttivo]}>
                      <Text style={[styles.chipTesto, campionatoId === c.id && styles.chipTestoAttivo]}>{c.nome}</Text>
                    </Pressable>
                  ))
                )}
              </View>
            )}
            <Pressable style={[styles.bottone, !avversario.trim() && { opacity: 0.5 }]} onPress={nuovaPartita} disabled={!avversario.trim()}>
              <Text style={styles.bottoneTesto}>Crea partita (poi convocati e formazione)</Text>
            </Pressable>
          </View>

        </>
      )}

      {andamento.length > 0 && (
        <View style={styles.cardAndamento}>
          <Pressable onPress={() => setMostraAndamento(!mostraAndamento)} style={styles.rigaToccabile}>
            <Text style={styles.sottotitoloSezione}>{mostraAndamento ? "▾" : "▸"} Rendimento medio per fondamentale</Text>
          </Pressable>
          {mostraAndamento && andamento.slice(0, 8).map((v, i) => (
            <View key={i} style={styles.rigaAndamento}>
              <Text style={styles.rigaAndamentoTesto}>{v.partita.slice(0, 10)} vs {v.avversario} — {v.fondamentale}</Text>
              <Text style={styles.rigaAndamentoValore}>+{v.punti} / -{v.errori}</Text>
            </View>
          ))}
        </View>
      )}

      {nascoste.length > 0 && (
        <Pressable style={[styles.chip, { alignSelf: "flex-start" }]} onPress={() => setMostraPassate(!mostraPassate)}>
          <Text style={styles.chipTesto}>{mostraPassate ? "Nascondi le partite passate" : `Mostra le partite passate (${nascoste.length})`}</Text>
        </Pressable>
      )}
          </View>
        }
        refreshControl={<RefreshControl refreshing={caricamento} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListEmptyComponent={!caricamento ? <Text style={styles.vuoto}>Nessuna partita ancora.</Text> : null}
        renderItem={({ item: gruppo }) => (
          <View style={styles.gruppo}>
            <Text style={styles.etichettaGruppo}>{gruppo.etichetta}</Text>
            <View style={styles.schedaGruppo}>
              {gruppo.partite.map((item, indice) => {
                const nomeNoi = team?.nome ?? "Noi";
                const inCasa = item.luogo === "casa";
                const prima = inCasa ? nomeNoi : item.avversario;
                const seconda = inCasa ? item.avversario : nomeNoi;
                const ora = new Date(item.data);
                const oraTesto = ora.getHours() === 0 && ora.getMinutes() === 0 ? "—" : ora.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
                const vinta = item.set_vinti_noi > item.set_vinti_avversario;
                return (
                  <View key={item.id}>
                    {indice > 0 && <View style={styles.separatore} />}
                    <Pressable style={styles.rigaPartita} onPress={() => apriPartita(item)}>
                      <Text style={styles.oraPartita}>{oraTesto}</Text>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[styles.squadraRiga, inCasa && styles.squadraNostra]} numberOfLines={1}>{prima}</Text>
                        <Text style={[styles.squadraRiga, styles.squadraSeconda, !inCasa && styles.squadraNostra]} numberOfLines={1}>{seconda}</Text>
                        <Text style={styles.cardSotto} numberOfLines={1}>{item.tipo_gara}{item.sporteasy_uid ? " · da SportEasy" : ""}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 2 }}>
                        {item.stato === "conclusa" ? (
                          <Text style={[styles.risultatoRiga, { color: vinta ? brand.colors.success : brand.colors.error }]}>{item.set_vinti_noi} – {item.set_vinti_avversario}</Text>
                        ) : item.stato === "in_corso" ? (
                          <Text style={[styles.badge, styles.badgeInCorso]}>In corso</Text>
                        ) : (
                          <Text style={[styles.badge, styles.badgeProgrammata]}>Da preparare</Text>
                        )}
                        <Text style={[styles.luogoRiga, inCasa && { color: brand.colors.success }]}>{inCasa ? "Casa" : "Trasferta"}</Text>
                      </View>
                    </Pressable>
                    {renderAzioniPartita(item)}
                  </View>
                );
              })}
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  titoloSezioneGrande: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  schedaEvidenza: { backgroundColor: brand.colors.surfaceSecondary, borderWidth: 1, borderColor: brand.colors.border, borderRadius: 22, padding: 18, gap: 14 },
  evidenzaQuando: { color: brand.colors.brand, fontSize: 12, fontWeight: "700", letterSpacing: 0.8 },
  evidenzaTitolo: { color: brand.colors.onSurface, fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
  evidenzaSotto: { color: brand.colors.onSurfaceSecondary, fontSize: 14 },
  container: { flex: 1, backgroundColor: brand.colors.surface, paddingHorizontal: 16, paddingTop: 8 },
  contenuto: { paddingBottom: 60, width: "100%", maxWidth: 900, alignSelf: "center" },
  sezionePiccola: { color: brand.colors.muted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, paddingLeft: 4, marginBottom: -8 },
  form: { gap: 10, backgroundColor: brand.colors.surfaceSecondary, padding: 16, borderRadius: 18 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, fontSize: 16 },
  nota: { color: brand.colors.muted, fontSize: 12 },
  bottone: { backgroundColor: brand.colors.brand, paddingHorizontal: 16, paddingVertical: 6, minHeight: 42, borderRadius: 999, alignItems: "center", justifyContent: "center", flex: 1 },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 15 },
  bottoneSecondario: { backgroundColor: brand.colors.surfaceTertiary, paddingHorizontal: 16, paddingVertical: 6, minHeight: 36, borderRadius: 999, alignItems: "center", justifyContent: "center", flex: 1 },
  bottoneSecondarioTesto: { color: brand.colors.onSurface, fontWeight: "600", fontSize: 15 },
  bottonePrincipale: { backgroundColor: brand.colors.brand, minHeight: 42, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  bottonePrincipaleTesto: { color: "#000", fontWeight: "700", fontSize: 15 },
  selettoreRiga: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingVertical: 6, paddingHorizontal: 16, minHeight: 36, justifyContent: "center", borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  pillola: { paddingVertical: 6, paddingHorizontal: 12, minHeight: 32, justifyContent: "center", borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary },
  pillolaTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  pillolaTestoLink: { color: brand.colors.onSurface, fontSize: 13, fontWeight: "600" },
  erroreTesto: { color: brand.colors.error, fontSize: 12 },
  cardAndamento: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 16, gap: 6 },
  rigaToccabile: { minHeight: 44, justifyContent: "center" },
  sottotitoloSezione: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  rigaAndamento: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaAndamentoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12, flex: 1, marginRight: 8 },
  rigaAndamentoValore: { color: brand.colors.brand, fontWeight: "700", fontSize: 12 },
  cardLive: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 22, padding: 16, gap: 14, borderWidth: 1, borderColor: brand.colors.border },
  cardLiveTesta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  cardLiveCompetizione: { flex: 1, color: brand.colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  pillolaLive: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: brand.colors.error, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999 },
  puntoLive: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  pillolaLiveTesto: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  cardLiveCentro: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  squadraLive: { flex: 1, alignItems: "center", gap: 6 },
  squadraLiveNome: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "700", textAlign: "center" },
  stemma: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  stemmaNoi: { backgroundColor: brand.colors.surfaceTertiary },
  stemmaAvversario: { backgroundColor: brand.colors.border },
  stemmaTesto: { fontSize: 17, fontWeight: "800" },
  punteggioLive: { color: brand.colors.onSurface, fontSize: 44, fontWeight: "800", letterSpacing: -1, lineHeight: 50 },
  gruppo: { marginBottom: 16, gap: 8 },
  etichettaGruppo: { color: brand.colors.muted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, paddingLeft: 4 },
  schedaGruppo: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, overflow: "hidden" },
  separatore: { height: 1, backgroundColor: brand.colors.border, marginLeft: 72 },
  rigaPartita: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, minHeight: 56 },
  oraPartita: { width: 46, color: brand.colors.muted, fontSize: 13, fontWeight: "700" },
  squadraRiga: { color: brand.colors.onSurfaceSecondary, fontSize: 15, fontWeight: "500" },
  squadraSeconda: {},
  squadraNostra: { color: brand.colors.onSurface, fontWeight: "700" },
  risultatoRiga: { fontSize: 17, fontWeight: "800" },
  luogoRiga: { color: brand.colors.muted, fontSize: 12, fontWeight: "700" },
  azioniInScheda: { paddingLeft: 0, paddingRight: 0, paddingBottom: 0 },
  azioniPartita: { gap: 8, paddingLeft: 72, paddingRight: 14, paddingBottom: 12 },
  cardSotto: { color: brand.colors.muted, fontSize: 12 },
  linkCampionato: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "600" },
  linkConverti: { color: brand.colors.muted, fontSize: 12 },
  bottoneAzzera: { paddingVertical: 6, paddingHorizontal: 12, minHeight: 32, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: brand.colors.muted },
  bottoneAzzeraTesto: { color: brand.colors.muted, fontSize: 12, fontWeight: "600" },
  bottoneElimina: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 12, minHeight: 32, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: brand.colors.error },
  bottoneOspite: { paddingVertical: 6, paddingHorizontal: 12, minHeight: 32, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: brand.colors.brandSecondary },
  bottoneOspiteTesto: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "600" },
  bottoneEliminaTesto: { color: brand.colors.error, fontSize: 12, fontWeight: "600" },
  badge: { color: brand.colors.muted, fontSize: 12, textTransform: "uppercase", fontWeight: "700" },
  badgeInCorso: { color: brand.colors.error, fontWeight: "800" },
  badgeProgrammata: { color: brand.colors.brandSecondary, fontWeight: "700" },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 20 },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 22, padding: 20, gap: 10, width: "100%", maxWidth: 520, alignSelf: "center" },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  chiudiPopup: { color: brand.colors.muted, fontSize: 15, textAlign: "center", paddingVertical: 12 },
  rigaRotazione: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaRotazioneNome: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  rigaRotazioneSaldo: { color: brand.colors.success, fontSize: 13, fontWeight: "700" },
  saldoNegativo: { color: brand.colors.error },
});
