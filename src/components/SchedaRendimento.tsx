import { Fragment, useCallback, useState } from "react";
import type { ReactNode } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Modal, TextInput, ScrollView } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useFocusEffect } from "expo-router";
import { impostaObiettivo, leggiSchedaAtleta, rimuoviObiettivo, type RigaScheda } from "@/src/services/schedaAtleta";
import { avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import type { Fondamentale } from "@/src/types/database";
import { Ionicons } from "@expo/vector-icons";

/** Colore della barra secondo il livello raggiunto: rende il colpo d'occhio immediato. */
function coloreLivello(valore: number): string {
  if (valore >= 8) return brand.colors.success;
  if (valore >= 6) return brand.colors.brand;
  if (valore >= 4) return brand.colors.warning;
  return brand.colors.error;
}

/** Un anello: raggio, colore e frazione 0..1 riempita. */
interface Anello { raggio: number; colore: string; frazione: number }

/**
 * Tre anelli concentrici stile Apple Fitness. Usa solo frazioni calcolate
 * dai dati reali della scheda; con frazione 0 resta solo la traccia.
 */
function Anelli({ anelli }: { anelli: Anello[] }) {
  return (
    <Svg width={132} height={132} viewBox="0 0 120 120">
      {anelli.map((a) => {
        const circonferenza = 2 * Math.PI * a.raggio;
        const f = Math.max(0, Math.min(1, a.frazione));
        return (
          <Fragment key={a.raggio}>
            <Circle cx={60} cy={60} r={a.raggio} fill="none" stroke={a.colore} strokeOpacity={0.2} strokeWidth={9} />
            {f > 0 && (
              <Circle
                cx={60} cy={60} r={a.raggio} fill="none" stroke={a.colore} strokeWidth={9} strokeLinecap="round"
                strokeDasharray={`${f * circonferenza} ${circonferenza}`}
                rotation={-90} origin="60, 60"
              />
            )}
          </Fragment>
        );
      })}
    </Svg>
  );
}

/**
 * Scheda di rendimento personale. Pensata perché l'atleta la apra e
 * capisca in tre secondi: dove sono, dove devo arrivare, sto
 * migliorando. Per questo ogni riga mostra insieme valore, barra,
 * variazione rispetto alla volta precedente e obiettivo — invece di un
 * elenco di numeri da interpretare.
 *
 * "modificabile" è vero solo per l'allenatore: l'atleta vede gli
 * obiettivi ma non può cambiarseli.
 */
export function SchedaRendimento({ athleteId, nomeAtleta, modificabile, soloRiepilogo = false, riquadroAccanto, sottoRiquadri }: {
  athleteId: string; nomeAtleta?: string; modificabile: boolean;
  /** true = mostra solo i tre numeri sintetici, il dettaglio si apre a richiesta. */
  soloRiepilogo?: boolean;
  /** Riquadro (es. certificato medico) affiancato al riquadro del voto. */
  riquadroAccanto?: ReactNode;
  /** Contenuto (es. pulsanti) subito sotto i riquadri, prima del dettaglio per fondamentale. */
  sottoRiquadri?: ReactNode;
}) {
  const [dettaglioAperto, setDettaglioAperto] = useState(false);
  const [righe, setRighe] = useState<RigaScheda[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [inModifica, setInModifica] = useState<RigaScheda | null>(null);
  const [valoreObiettivo, setValoreObiettivo] = useState("");
  const [entroData, setEntroData] = useState("");

  const carica = useCallback(async () => {
    setCaricamento(true);
    try { setRighe(await leggiSchedaAtleta(athleteId)); }
    catch (e) { avvisa("Errore", (e as Error).message); }
    finally { setCaricamento(false); }
  }, [athleteId]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  const conValutazioni = righe.filter((r) => r.valore_attuale != null);
  const mediaGenerale = conValutazioni.length > 0
    ? (conValutazioni.reduce((s, r) => s + Number(r.valore_attuale), 0) / conValutazioni.length)
    : null;
  const recordAttivi = righe.filter((r) => r.e_record_adesso).length;
  const obiettiviRaggiunti = righe.filter((r) => r.progresso_percentuale === 100).length;
  const obiettiviTotali = righe.filter((r) => r.obiettivo != null).length;

  async function salvaObiettivo() {
    if (!inModifica) return;
    const v = Number(valoreObiettivo.replace(",", "."));
    if (!v || v < 1 || v > 10) { avvisa("Valore non valido", "Indica un obiettivo tra 1 e 10."); return; }
    try {
      await impostaObiettivo(athleteId, inModifica.fondamentale as Fondamentale, v, entroData || null);
      setInModifica(null); carica();
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  if (caricamento) return <ActivityIndicator color={brand.colors.brand} style={{ marginTop: 24 }} />;

  const fondamentaliTotali = righe.length;
  const virgola = (n: number) => n.toFixed(1).replace(".", ",");
  const anelli: Anello[] = [
    { raggio: 54, colore: brand.colors.brand, frazione: fondamentaliTotali > 0 ? conValutazioni.length / fondamentaliTotali : 0 },
    { raggio: 42, colore: brand.colors.brandSecondary, frazione: obiettiviTotali > 0 ? obiettiviRaggiunti / obiettiviTotali : 0 },
    { raggio: 30, colore: brand.colors.success, frazione: fondamentaliTotali > 0 ? recordAttivi / fondamentaliTotali : 0 },
  ];

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.cardAnelli}>
        <Anelli anelli={anelli} />
        <View style={styles.legendaAnelli}>
          <View>
            <Text style={[styles.etichettaAnello, { color: brand.colors.brand }]}>VALUTATI</Text>
            <Text style={styles.valoreAnello}>{fondamentaliTotali > 0 ? `${conValutazioni.length}/${fondamentaliTotali}` : "—"}</Text>
          </View>
          <View>
            <Text style={[styles.etichettaAnello, { color: brand.colors.brandSecondary }]}>OBIETTIVI</Text>
            <Text style={styles.valoreAnello}>{obiettiviTotali > 0 ? `${obiettiviRaggiunti}/${obiettiviTotali}` : "—"}</Text>
          </View>
          <View>
            <Text style={[styles.etichettaAnello, { color: brand.colors.success }]}>RECORD ATTIVI</Text>
            <Text style={styles.valoreAnello}>{recordAttivi > 0 ? `🏆 ${recordAttivi}` : "—"}</Text>
          </View>
        </View>
      </View>

      <View style={styles.rigaRiquadri}>
        {riquadroAccanto}
        <View style={styles.riquadro}>
          <Text style={styles.etichettaRiquadro}>VOTO</Text>
          <Text style={[styles.valoreRiquadro, mediaGenerale != null && { color: coloreLivello(mediaGenerale) }]}>
            {mediaGenerale != null ? virgola(mediaGenerale) : "—"}
          </Text>
          <Text style={styles.notaRiquadro}>
            {conValutazioni.length > 0 ? `media su ${conValutazioni.length} ${conValutazioni.length === 1 ? "fondamentale" : "fondamentali"}` : "nessuna valutazione"}
          </Text>
        </View>
      </View>

      {sottoRiquadri}

      {soloRiepilogo && (
        <Pressable onPress={() => setDettaglioAperto(!dettaglioAperto)} style={styles.apriDettaglio}>
          <Text style={styles.apriDettaglioTesto}>
            {dettaglioAperto ? "▾ Nascondi dettaglio per fondamentale" : "▸ Dettaglio per fondamentale e obiettivi"}
          </Text>
        </Pressable>
      )}

      {(!soloRiepilogo || dettaglioAperto) && righe.map((r) => {
        const valore = r.valore_attuale != null ? Number(r.valore_attuale) : null;
        const percentuale = valore != null ? Math.round((valore / 10) * 100) : 0;
        const percObiettivo = r.obiettivo != null ? Math.round((Number(r.obiettivo) / 10) * 100) : null;

        return (
          <Pressable
            key={r.fondamentale}
            style={[styles.card, r.e_record_adesso && styles.cardRecord]}
            onPress={() => {
              if (!modificabile) return;
              setInModifica(r);
              setValoreObiettivo(r.obiettivo != null ? String(r.obiettivo) : "");
              setEntroData(r.entro_data ?? "");
            }}
          >
            <View style={styles.rigaTitolo}>
              <Text style={styles.nomeFondamentale}>
                {r.e_record_adesso ? "🏆 " : ""}{r.fondamentale}
              </Text>
              <View style={styles.rigaValore}>
                {r.variazione != null && Number(r.variazione) !== 0 && (
                  <Text style={[styles.variazione, Number(r.variazione) > 0 ? styles.variazionePositiva : styles.variazioneNegativa]}>
                    {Number(r.variazione) > 0 ? "▲" : "▼"} {Math.abs(Number(r.variazione)).toFixed(1)}
                  </Text>
                )}
                <Text style={[styles.valore, valore != null && { color: coloreLivello(valore) }]}>
                  {valore != null ? valore.toFixed(1) : "—"}
                </Text>
              </View>
            </View>

            <View style={styles.barraSfondo}>
              {valore != null && (
                <View style={[styles.barraRiempimento, { width: `${percentuale}%`, backgroundColor: coloreLivello(valore) }]} />
              )}
              {/* Tacca dell'obiettivo sulla stessa scala: si vede a colpo
                  d'occhio quanto manca, senza leggere numeri. */}
              {percObiettivo != null && (
                <View style={[styles.taccaObiettivo, { left: `${percObiettivo}%` }]} />
              )}
            </View>

            <Text style={styles.dettaglio}>
              {valore == null
                ? "nessuna valutazione ancora"
                : `${r.numero_valutazioni} valutazioni · record ${Number(r.record_personale).toFixed(1)}${r.data_record ? ` del ${new Date(r.data_record).toLocaleDateString("it-IT")}` : ""}`}
              {r.obiettivo != null && ` · obiettivo ${Number(r.obiettivo).toFixed(1)}${r.entro_data ? ` entro ${new Date(r.entro_data).toLocaleDateString("it-IT")}` : ""}`}
              {r.progresso_percentuale === 100 && " ✓ raggiunto"}
            </Text>

            {r.e_record_adesso && <Text style={styles.messaggioRecord}>Miglior valutazione di sempre in questo fondamentale.</Text>}
            {modificabile && <Text style={styles.suggerimento}>tocca per {r.obiettivo != null ? "modificare" : "fissare"} l'obiettivo</Text>}
          </Pressable>
        );
      })}

      <Modal visible={!!inModifica} animationType="fade" transparent onRequestClose={() => setInModifica(null)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <ScrollView contentContainerStyle={{ gap: 10 }}>
              <Text style={styles.titoloPopup}>
                Obiettivo — {inModifica?.fondamentale}{nomeAtleta ? ` · ${nomeAtleta}` : ""}
              </Text>
              <Text style={styles.dettaglio}>
                Valore attuale: {inModifica?.valore_attuale != null ? Number(inModifica.valore_attuale).toFixed(1) : "nessuna valutazione"}
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Obiettivo da 1 a 10 (es. 7.5)"
                placeholderTextColor={brand.colors.muted}
                keyboardType="decimal-pad"
                value={valoreObiettivo}
                onChangeText={setValoreObiettivo}
                autoFocus
              />
              <TextInput
                style={styles.input}
                placeholder="Entro il (AAAA-MM-GG, facoltativo)"
                placeholderTextColor={brand.colors.muted}
                value={entroData}
                onChangeText={setEntroData}
              />
              <Pressable style={styles.bottone} onPress={salvaObiettivo}>
                <Text style={styles.bottoneTesto}>Salva obiettivo</Text>
              </Pressable>
              {inModifica?.obiettivo != null && (
                <Pressable
                  style={styles.bottoneDistruttivo}
                  onPress={async () => {
                    try { await rimuoviObiettivo(athleteId, inModifica.fondamentale as Fondamentale); setInModifica(null); carica(); }
                    catch (e) { avvisa("Errore", (e as Error).message); }
                  }}
                >
                  <Ionicons name="trash-outline" size={15} color={brand.colors.error} />
                  <Text style={styles.bottoneDistruttivoTesto}>Rimuovi obiettivo</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setInModifica(null)}><Text style={styles.chiudi}>Annulla</Text></Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  cardAnelli: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 22, padding: 18, flexDirection: "row", alignItems: "center", gap: 20 },
  legendaAnelli: { flex: 1, gap: 8 },
  etichettaAnello: { fontSize: 12, fontWeight: "700", letterSpacing: 0.3 },
  valoreAnello: { color: brand.colors.onSurface, fontSize: 24, fontWeight: "800", letterSpacing: -0.5, lineHeight: 28 },
  rigaRiquadri: { flexDirection: "row", gap: 10 },
  riquadro: { flex: 1, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 14, gap: 2 },
  etichettaRiquadro: { color: brand.colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  valoreRiquadro: { color: brand.colors.onSurface, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  notaRiquadro: { color: brand.colors.muted, fontSize: 12 },
  apriDettaglio: { minHeight: 44, justifyContent: "center", alignItems: "center" },
  apriDettaglioTesto: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "600" },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 16, gap: 8, borderWidth: 1, borderColor: "transparent" },
  cardRecord: { borderColor: brand.colors.warning },
  rigaTitolo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  nomeFondamentale: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  rigaValore: { flexDirection: "row", alignItems: "center", gap: 8 },
  valore: { color: brand.colors.muted, fontSize: 22, fontWeight: "800" },
  variazione: { fontSize: 12, fontWeight: "700" },
  variazionePositiva: { color: brand.colors.success },
  variazioneNegativa: { color: brand.colors.error },
  barraSfondo: { height: 10, backgroundColor: brand.colors.surfaceTertiary, borderRadius: 5, overflow: "hidden", position: "relative" },
  barraRiempimento: { height: "100%", borderRadius: 5 },
  taccaObiettivo: { position: "absolute", top: -2, width: 3, height: 14, backgroundColor: "#fff", borderRadius: 2 },
  dettaglio: { color: brand.colors.muted, fontSize: 11, lineHeight: 16 },
  messaggioRecord: { color: brand.colors.warning, fontSize: 12, fontWeight: "700" },
  suggerimento: { color: brand.colors.brandSecondary, fontSize: 10 },
  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, width: "100%", maxWidth: 520, alignSelf: "center", padding: 20, maxHeight: "85%" },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 12 },
  bottone: { backgroundColor: brand.colors.brand, minHeight: 42, justifyContent: "center", paddingHorizontal: 16, borderRadius: 999, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  bottoneDistruttivo: { flexDirection: "row", gap: 6, borderColor: brand.colors.error, borderWidth: 1, minHeight: 36, justifyContent: "center", paddingHorizontal: 16, borderRadius: 999, alignItems: "center" },
  bottoneDistruttivoTesto: { color: brand.colors.error, fontWeight: "700" },
  chiudi: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 14 },
});
