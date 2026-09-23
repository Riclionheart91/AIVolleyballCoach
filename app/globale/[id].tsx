import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Modal, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaAtlete } from "@/src/services/athletes";
import {
  FONDAMENTALI_COMPLETI, FONDAMENTALI_ESSENZIALI,
  annullaUltimoEventoGlobale, chiudiGlobale, creaGlobale, elencaEventiGlobale, elencaFormazioni,
  globaleApertoPerAllenamento, impostaFormazioneGlobale, leggiGlobale, registraEventoGlobale,
  rendimentoRotazioni,
  type EventoGlobale, type FormazioneGlobale, type Globale, type RendimentoRotazione, type SquadraGlobale,
} from "@/src/services/globale";
import { Campo9x9, type OccupanteCampo } from "@/src/components/Campo9x9";
import { useSincronizzazioneLive } from "@/src/hooks/useSincronizzazioneLive";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import type { Athlete } from "@/src/types/database";

/**
 * "Globale": partita interna alla squadra con scouting leggero.
 * Due differenze volute rispetto allo scouting partita: entrambe le
 * squadre sono nostre (quindi ogni scambio ha un responsabile) e
 * l'enfasi è sugli ERRORI, che in allenamento sono il segnale utile.
 *
 * Il parametro della rotta è l'id dell'ALLENAMENTO: la schermata
 * riapre il globale già avviato per quella seduta, oppure ne crea uno.
 */
export default function GlobaleAllenamento() {
  const { id: trainingId } = useLocalSearchParams<{ id: string }>();
  const { team, puoScrivere } = useAuth();
  const { width, height } = useWindowDimensions();
  const orizzontale = width >= height;

  const [globale, setGlobale] = useState<Globale | null>(null);
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [formazioni, setFormazioni] = useState<FormazioneGlobale[]>([]);
  const [eventi, setEventi] = useState<EventoGlobale[]>([]);
  const [caricamento, setCaricamento] = useState(true);

  // Impostazione: posizioni[squadra][posizione] = athleteId
  const [posizioni, setPosizioni] = useState<Record<SquadraGlobale, Record<number, string>>>({ A: {}, B: {} });
  const [sceltaPosizione, setSceltaPosizione] = useState<{ squadra: SquadraGlobale; posizione: number } | null>(null);

  // Gioco: giocatrice -> fondamentale -> esito
  const [selezione, setSelezione] = useState<{ squadra: SquadraGlobale; athleteId: string } | null>(null);
  const [fondamentaleSel, setFondamentaleSel] = useState<string | null>(null);
  const [essenziale, setEssenziale] = useState(true);
  const [popupRotazioni, setPopupRotazioni] = useState(false);
  const [rotazioni, setRotazioni] = useState<RendimentoRotazione[]>([]);

  const carica = useCallback(async () => {
    if (!trainingId || !team) return;
    setCaricamento(true);
    try {
      let g = await globaleApertoPerAllenamento(trainingId);
      if (!g && puoScrivere) g = await creaGlobale(team.id, trainingId);
      setGlobale(g);
      setAtlete(await elencaAtlete(team.id));
      if (g) {
        const f = await elencaFormazioni(g.id);
        setFormazioni(f);
        setEventi(await elencaEventiGlobale(g.id));
        const iniziali: Record<SquadraGlobale, Record<number, string>> = { A: {}, B: {} };
        for (const r of f) if (r.posizione && r.in_campo) iniziali[r.squadra][r.posizione] = r.athlete_id;
        setPosizioni(iniziali);
      }
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCaricamento(false);
    }
  }, [trainingId, team, puoScrivere]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  useSincronizzazioneLive(
    [
      { nome: "globale_eventi", colonnaFiltro: "globale_id", valoreFiltro: globale?.id },
      { nome: "globale_formazioni", colonnaFiltro: "globale_id", valoreFiltro: globale?.id },
      { nome: "globali", colonnaFiltro: "id", valoreFiltro: globale?.id },
    ],
    carica,
  );

  function atleta(aid: string): Athlete | undefined { return atlete.find((a) => a.id === aid); }
  function etichetta(aid: string): string {
    const a = atleta(aid);
    return a ? `#${a.numero_maglia ?? "-"} ${a.cognome}` : "—";
  }

  const impostate = Object.keys(posizioni.A).length === 6 && Object.keys(posizioni.B).length === 6;
  const inGioco = formazioni.length > 0 && impostate;

  function occupanti(squadra: SquadraGlobale): OccupanteCampo[] {
    return Object.entries(posizioni[squadra]).map(([pos, aid]) => {
      const a = atleta(aid);
      return {
        posizione: Number(pos),
        cognome: a?.cognome ?? "?",
        numeroMaglia: a?.numero_maglia ?? null,
        ruolo: a?.ruolo_campo ?? null,
        attivo: selezione?.squadra === squadra && selezione?.athleteId === aid,
      };
    });
  }

  /** Già schierate ovunque: una giocatrice non può stare in due posti. */
  const giaSchierate = new Set([...Object.values(posizioni.A), ...Object.values(posizioni.B)]);

  function assegna(aid: string) {
    if (!sceltaPosizione) return;
    const { squadra, posizione } = sceltaPosizione;
    setPosizioni((prec) => {
      const nuovo = { A: { ...prec.A }, B: { ...prec.B } };
      for (const s of ["A", "B"] as SquadraGlobale[]) {
        for (const p of Object.keys(nuovo[s])) if (nuovo[s][Number(p)] === aid) delete nuovo[s][Number(p)];
      }
      nuovo[squadra][posizione] = aid;
      return nuovo;
    });
    setSceltaPosizione(null);
  }

  async function salvaFormazioni() {
    if (!globale) return;
    try {
      await impostaFormazioneGlobale(globale.id, "A", posizioni.A);
      await impostaFormazioneGlobale(globale.id, "B", posizioni.B);
      carica();
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  async function registra(esito: "punto" | "errore") {
    if (!globale || !selezione || !fondamentaleSel) return;
    // Aggiornamento ottimistico del punteggio: un errore assegna il
    // punto all'ALTRA squadra, un punto alla propria.
    const aFavore: SquadraGlobale = esito === "errore" ? (selezione.squadra === "A" ? "B" : "A") : selezione.squadra;
    setGlobale((g) => g ? { ...g, punti_a: g.punti_a + (aFavore === "A" ? 1 : 0), punti_b: g.punti_b + (aFavore === "B" ? 1 : 0) } : g);
    const scelta = selezione;
    const fond = fondamentaleSel;
    setSelezione(null); setFondamentaleSel(null);

    try {
      await registraEventoGlobale(globale.id, scelta.squadra, scelta.athleteId, fond, esito);
      carica();
    } catch (e) {
      carica();
      avvisa("Non registrato", (e as Error).message);
    }
  }

  async function onAnnulla() {
    if (!globale) return;
    try { await annullaUltimoEventoGlobale(globale.id); carica(); }
    catch (e) { avvisa("Errore", (e as Error).message); }
  }

  async function apriRotazioni() {
    if (!globale) return;
    setPopupRotazioni(true);
    try { setRotazioni(await rendimentoRotazioni(globale.id)); } catch { setRotazioni([]); }
  }

  function onChiudi() {
    if (!globale) return;
    confermaAzione(
      "Chiudere il globale?",
      "Verranno generate proposte di valutazione per ogni atleta con almeno 3 azioni registrate, da confermare in Valutazioni.",
      "Chiudi e genera",
      async () => {
        try {
          const n = await chiudiGlobale(globale.id, true);
          avvisa("Globale chiuso", n > 0 ? `${n} proposte di valutazione create.` : "Nessuna proposta: servono almeno 3 azioni per persona e fondamentale.");
          router.back();
        } catch (e) { avvisa("Errore", (e as Error).message); }
      },
    );
  }

  if (caricamento) return <View style={styles.contenitore}><ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} /></View>;
  if (!globale) return <View style={styles.contenitore}><Text style={styles.nota}>Nessun globale attivo per questa seduta.</Text></View>;

  const fondamentali = essenziale ? FONDAMENTALI_ESSENZIALI : FONDAMENTALI_COMPLETI;
  const latoCampo = orizzontale ? Math.min(height * 0.42, width * 0.32) : Math.min(width - 32, height * 0.26);

  return (
    <View style={styles.contenitore}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>←</Text></Pressable>
        <Text style={styles.punteggio}>{globale.punti_a} - {globale.punti_b}</Text>
        <Text style={styles.servizio}>serve {globale.squadra_al_servizio}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 40 }}>
        {!inGioco && (
          <Text style={styles.nota}>
            Componi le due squadre toccando le caselle dei campi: servono 6 persone per parte. La posizione 1 è la zona di battuta.
          </Text>
        )}

        {(["A", "B"] as SquadraGlobale[]).map((squadra) => (
          <View key={squadra} style={styles.bloccoSquadra}>
            <Text style={styles.titoloSquadra}>
              Squadra {squadra} — {Object.keys(posizioni[squadra]).length}/6
            </Text>
            <View style={{ width: orizzontale ? latoCampo : "100%", height: latoCampo, alignSelf: "center" }}>
              <Campo9x9
                occupanti={occupanti(squadra)}
                consentiPosizioniVuote={!inGioco}
                onTapPosizione={(pos) => {
                  if (!puoScrivere) return;
                  const aid = posizioni[squadra][pos];
                  if (inGioco && aid) {
                    setSelezione(selezione?.athleteId === aid ? null : { squadra, athleteId: aid });
                    setFondamentaleSel(null);
                  } else {
                    setSceltaPosizione({ squadra, posizione: pos });
                  }
                }}
                onRimuoviPosizione={!inGioco && puoScrivere ? (pos) => {
                  setPosizioni((prec) => {
                    const nuovo = { A: { ...prec.A }, B: { ...prec.B } };
                    delete nuovo[squadra][pos];
                    return nuovo;
                  });
                } : undefined}
              />
            </View>
          </View>
        ))}

        {!inGioco && puoScrivere && (
          <Pressable style={[styles.bottone, !impostate && styles.bottoneSpento]} onPress={salvaFormazioni} disabled={!impostate}>
            <Text style={styles.bottoneTesto}>{impostate ? "▶ Inizia il globale" : "Completa entrambe le formazioni"}</Text>
          </Pressable>
        )}

        {inGioco && puoScrivere && (
          <>
            <Text style={styles.indicazione}>
              {!selezione && "1. Tocca chi ha chiuso lo scambio"}
              {selezione && !fondamentaleSel && `2. ${etichetta(selezione.athleteId)} (squadra ${selezione.squadra}) — quale fondamentale?`}
              {selezione && fondamentaleSel && `3. ${fondamentaleSel} — punto o errore?`}
            </Text>

            {selezione && !fondamentaleSel && (
              <View style={styles.griglia}>
                {fondamentali.map((f) => (
                  <Pressable key={f} style={styles.tastoGriglia} onPress={() => setFondamentaleSel(f)}>
                    <Text style={styles.tastoGrigliaTesto}>{f}</Text>
                  </Pressable>
                ))}
                <Pressable style={styles.tastoAnnullaPasso} onPress={() => setSelezione(null)}>
                  <Text style={styles.nota}>← cambia giocatrice</Text>
                </Pressable>
              </View>
            )}

            {selezione && fondamentaleSel && (
              <>
                {/* L'errore è il pulsante principale: in allenamento è il
                    dato che interessa davvero, e sta sopra perché è
                    quello che si preme più spesso. */}
                <Pressable style={[styles.tastoEsito, styles.esitoErrore]} onPress={() => registra("errore")}>
                  <Text style={styles.tastoEsitoTesto}>ERRORE</Text>
                  <Text style={styles.sottoTesto}>punto alla squadra {selezione.squadra === "A" ? "B" : "A"}</Text>
                </Pressable>
                <Pressable style={[styles.tastoEsito, styles.esitoPunto]} onPress={() => registra("punto")}>
                  <Text style={styles.tastoEsitoTesto}>PUNTO</Text>
                  <Text style={styles.sottoTesto}>punto alla squadra {selezione.squadra}</Text>
                </Pressable>
                <Pressable style={styles.tastoAnnullaPasso} onPress={() => setFondamentaleSel(null)}>
                  <Text style={styles.nota}>← cambia fondamentale</Text>
                </Pressable>
              </>
            )}

            <View style={styles.rigaComandi}>
              <Pressable style={styles.tastoPiccolo} onPress={onAnnulla} disabled={eventi.length === 0}>
                <Text style={styles.tastoPiccoloTesto}>↺ Annulla</Text>
              </Pressable>
              <Pressable style={styles.tastoPiccolo} onPress={apriRotazioni}>
                <Text style={styles.tastoPiccoloTesto}>📊 Rotazioni</Text>
              </Pressable>
              <Pressable style={styles.tastoPiccolo} onPress={() => setEssenziale(!essenziale)}>
                <Text style={styles.tastoPiccoloTesto}>{essenziale ? "3 fondamentali" : "5 fondamentali"}</Text>
              </Pressable>
              <Pressable style={styles.tastoPiccoloDistruttivo} onPress={onChiudi}>
                <Text style={styles.tastoPiccoloDistruttivoTesto}>Chiudi</Text>
              </Pressable>
            </View>

            <Text style={styles.etichettaLog}>Ultimi eventi ({eventi.length})</Text>
            {eventi.slice(0, 5).map((e) => (
              <Text key={e.id} style={styles.rigaLog} numberOfLines={1}>
                {e.squadra} · {e.fondamentale} {e.esito}{e.athlete_id ? ` · ${etichetta(e.athlete_id)}` : ""}
              </Text>
            ))}
          </>
        )}
      </ScrollView>

      <Modal visible={!!sceltaPosizione} animationType="fade" transparent onRequestClose={() => setSceltaPosizione(null)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>
              Squadra {sceltaPosizione?.squadra}, posizione {sceltaPosizione?.posizione}
            </Text>
            <ScrollView style={{ maxHeight: 340 }}>
              {atlete.filter((a) => !giaSchierate.has(a.id)).map((a) => (
                <Pressable key={a.id} style={styles.rigaScelta} onPress={() => assegna(a.id)}>
                  <Text style={styles.rigaSceltaTesto}>{a.numero_maglia ? `#${a.numero_maglia} ` : ""}{a.nome} {a.cognome}</Text>
                </Pressable>
              ))}
              {atlete.filter((a) => !giaSchierate.has(a.id)).length === 0 && (
                <Text style={styles.nota}>Tutte la rosa sono già schierate.</Text>
              )}
            </ScrollView>
            <Pressable onPress={() => setSceltaPosizione(null)}><Text style={styles.chiudi}>Annulla</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={popupRotazioni} animationType="slide" transparent onRequestClose={() => setPopupRotazioni(false)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>Rendimento per rotazione</Text>
            <Text style={styles.nota}>La rotazione è identificata da chi si trova in posizione 1 (al servizio). Ordinate dalla peggiore.</Text>
            <ScrollView style={{ maxHeight: 340 }}>
              {rotazioni.length === 0 ? (
                <Text style={styles.nota}>Nessun dato ancora.</Text>
              ) : rotazioni.map((r, i) => (
                <View key={i} style={styles.rigaRotazione}>
                  <Text style={styles.rigaRotazioneNome}>{r.squadra} · {r.rotazione_di}</Text>
                  <Text style={[styles.rigaRotazioneSaldo, r.saldo < 0 && styles.saldoNegativo]}>
                    {r.saldo >= 0 ? "+" : ""}{r.saldo} ({r.punti_fatti}/{r.errori_commessi})
                  </Text>
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setPopupRotazioni(false)}><Text style={styles.chiudi}>Chiudi</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  contenitore: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 14, padding: 12, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontSize: 22, fontWeight: "700" },
  punteggio: { color: brand.colors.brand, fontSize: 24, fontWeight: "800", flex: 1 },
  servizio: { color: brand.colors.muted, fontSize: 12 },
  bloccoSquadra: { gap: 4 },
  titoloSquadra: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  indicazione: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "700" },
  griglia: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tastoGriglia: { flexGrow: 1, minWidth: "30%", backgroundColor: brand.colors.surfaceSecondary, paddingVertical: 16, borderRadius: 10, alignItems: "center" },
  tastoGrigliaTesto: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 13 },
  tastoEsito: { paddingVertical: 18, borderRadius: 12, alignItems: "center", gap: 2 },
  esitoErrore: { backgroundColor: brand.colors.error },
  esitoPunto: { backgroundColor: brand.colors.success },
  tastoEsitoTesto: { color: "#fff", fontWeight: "800", fontSize: 17 },
  sottoTesto: { color: "rgba(255,255,255,0.8)", fontSize: 11 },
  tastoAnnullaPasso: { alignItems: "center", paddingVertical: 6, width: "100%" },
  rigaComandi: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tastoPiccolo: { flexGrow: 1, backgroundColor: brand.colors.surfaceSecondary, paddingVertical: 10, borderRadius: 8, alignItems: "center", minHeight: 40, justifyContent: "center" },
  tastoPiccoloTesto: { color: brand.colors.onSurface, fontWeight: "600", fontSize: 12 },
  tastoPiccoloDistruttivo: { flexGrow: 1, borderColor: brand.colors.error, borderWidth: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center", minHeight: 40, justifyContent: "center" },
  tastoPiccoloDistruttivoTesto: { color: brand.colors.error, fontWeight: "600", fontSize: 12 },
  bottone: { backgroundColor: brand.colors.success, paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  bottoneSpento: { backgroundColor: brand.colors.surfaceTertiary },
  bottoneTesto: { color: "#000", fontWeight: "800", fontSize: 15 },
  nota: { color: brand.colors.muted, fontSize: 12, lineHeight: 17 },
  etichettaLog: { color: brand.colors.muted, fontSize: 10, textTransform: "uppercase", marginTop: 4 },
  rigaLog: { color: brand.colors.onSurfaceSecondary, fontSize: 12, paddingVertical: 2 },
  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 20 },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 18, gap: 10 },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  rigaScelta: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaSceltaTesto: { color: brand.colors.onSurface, fontSize: 14 },
  rigaRotazione: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaRotazioneNome: { color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  rigaRotazioneSaldo: { color: brand.colors.success, fontSize: 12, fontWeight: "700" },
  saldoNegativo: { color: brand.colors.error },
  chiudi: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 6 },
});
