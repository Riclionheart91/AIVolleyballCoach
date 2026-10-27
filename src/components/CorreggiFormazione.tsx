import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Modal } from "react-native";
import { brand } from "@/src/config";
import { avvisa } from "@/src/lib/confermaAzione";
import { aggiungiConvocato, correggiFormazione } from "@/src/services/matches";
import type { Athlete, MatchSetLineup } from "@/src/types/database";

const MAX_LIBERI = 2;
// Disposizione sul campo visto dalla nostra parte: rete in alto, 4-3-2 davanti e 5-6-1 dietro.
const RIGHE: number[][] = [[4, 3, 2], [5, 6, 1]];

interface Props {
  visibile: boolean;
  setId: string;
  matchId: string;
  numeroSet: number;
  /** Rosa (staff) o solo le convocate (scout ospite). */
  atlete: Athlete[];
  convocateIds: string[];
  liberiIds: Set<string>;
  /** Chi sta in campo adesso, con la posizione. */
  inCampo: MatchSetLineup[];
  chiServe: "noi" | "avversario" | null;
  liberoInCampo: boolean;
  /** Solo lo staff cambia la distinta (convocati e Libero). */
  puoCambiareDistinta: boolean;
  onChiudi: () => void;
  /** Dopo ogni modifica: la schermata ricarica i dati della partita. */
  onAggiornato: () => void | Promise<void>;
}

/**
 * Correzione a partita iniziata: rimette in campo le persone giuste nelle posizioni giuste (e chi batte) senza toccare
 * punti e azioni gia' registrati; lo staff puo' anche aggiungere un Libero (per tutta la partita, fino a 2) e una convocata
 * dimenticata (solo nel primo set).
 */
export function CorreggiFormazione({ visibile, setId, matchId, numeroSet, atlete, convocateIds, liberiIds, inCampo, chiServe, liberoInCampo, puoCambiareDistinta, onChiudi, onAggiornato }: Props) {
  const [posizioni, setPosizioni] = useState<Record<number, string>>({});
  const [scelta, setScelta] = useState<number | null>(null);
  const [chiBatte, setChiBatte] = useState<"noi" | "avversario">("noi");
  const [salvataggio, setSalvataggio] = useState(false);
  const [elencoAggiunta, setElencoAggiunta] = useState<"libero" | "convocato" | null>(null);

  // Ogni volta che si apre si riparte da come e' la formazione adesso.
  useEffect(() => {
    if (!visibile) return;
    const p: Record<number, string> = {};
    for (const r of inCampo) if (r.posizione) p[r.posizione] = r.athlete_id;
    setPosizioni(p);
    setScelta(null);
    setChiBatte(chiServe ?? "noi");
    setElencoAggiunta(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibile]);

  const nomeDi = (id?: string) => {
    const a = atlete.find((x) => x.id === id);
    return a ? `${a.numero_maglia != null ? `#${a.numero_maglia} ` : ""}${a.cognome}` : "—";
  };
  const usate = new Set(Object.values(posizioni));
  const disponibili = atlete.filter((a) => convocateIds.includes(a.id) && !liberiIds.has(a.id) && !usate.has(a.id));
  const completa = Object.keys(posizioni).length === 6;
  const nLiberi = Array.from(liberiIds).filter((id) => convocateIds.includes(id)).length;
  const primoSet = numeroSet === 1;
  const idInCampo = new Set(inCampo.map((r) => r.athlete_id));

  function assegna(athleteId: string) {
    if (scelta === null) { avvisa("Scegli prima la posizione", "Tocca una posizione sul campo e poi la giocatrice."); return; }
    setPosizioni((p) => ({ ...p, [scelta]: athleteId }));
    const prossima = [1, 2, 3, 4, 5, 6].find((n) => n !== scelta && !posizioni[n]);
    setScelta(prossima ?? null);
  }

  async function salva() {
    if (!completa || salvataggio) return;
    setSalvataggio(true);
    try {
      await correggiFormazione(setId, Object.fromEntries(Object.entries(posizioni).map(([p, a]) => [p, a])), chiBatte);
      await onAggiornato();
      onChiudi();
    } catch (e) {
      avvisa("Formazione non corretta", (e as Error).message);
    } finally {
      setSalvataggio(false);
    }
  }

  async function aggiungi(athleteId: string, comeLibero: boolean) {
    try {
      await aggiungiConvocato(matchId, athleteId, comeLibero);
      setElencoAggiunta(null);
      await onAggiornato();
    } catch (e) {
      avvisa(comeLibero ? "Libero non aggiunto" : "Convocato non aggiunto", (e as Error).message);
    }
  }

  // Chi si puo' aggiungere come Libero: chiunque non lo sia gia' e non sia in campo adesso (anche chi non era convocato).
  const candidatiLibero = atlete.filter((a) => !liberiIds.has(a.id) && !idInCampo.has(a.id));
  const candidatiConvocato = atlete.filter((a) => !convocateIds.includes(a.id));

  return (
    <Modal visible={visibile} animationType="slide" transparent onRequestClose={onChiudi}>
      <View style={styles.sfondo}>
        <View style={styles.carta}>
          <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
            <View style={styles.intestazione}>
              <Text style={styles.titolo}>Correggi la formazione</Text>
              <Pressable onPress={onChiudi} hitSlop={12}><Text style={styles.chiudi}>✕</Text></Pressable>
            </View>
            <Text style={styles.nota}>Rimette in campo chi indichi nelle posizioni indicate. Punti e azioni già registrati non cambiano e chi esce per correzione non conta come cambio.</Text>

            {liberoInCampo && (
              <View style={styles.avviso}>
                <Text style={styles.avvisoTesto}>Il Libero è in campo: fallo prima uscire (tasto Libero), poi correggi la formazione.</Text>
              </View>
            )}

            <View style={styles.campo}>
              <Text style={styles.rete}>RETE</Text>
              {RIGHE.map((riga, i) => (
                <View key={i} style={styles.riga}>
                  {riga.map((n) => (
                    <Pressable key={n} onPress={() => setScelta(scelta === n ? null : n)} style={[styles.posizione, scelta === n && styles.posizioneScelta]}>
                      <Text style={styles.numeroPosizione}>{n}</Text>
                      <Text style={styles.nomePosizione} numberOfLines={1}>{nomeDi(posizioni[n])}</Text>
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>

            <Text style={styles.sezione}>Chi batte adesso</Text>
            <View style={styles.rigaChip}>
              {(["noi", "avversario"] as const).map((c) => (
                <Pressable key={c} onPress={() => setChiBatte(c)} style={[styles.chip, chiBatte === c && styles.chipAttivo]}>
                  <Text style={[styles.chipTesto, chiBatte === c && styles.chipTestoAttivo]}>{c === "noi" ? "Noi" : "Loro"}</Text>
                </Pressable>
              ))}
            </View>

            {disponibili.length > 0 && (
              <>
                <Text style={styles.sezione}>{scelta ? `Chi va in posizione ${scelta}?` : "Giocatrici disponibili (tocca prima una posizione)"}</Text>
                <View style={styles.rigaChip}>
                  {disponibili.map((a) => (
                    <Pressable key={a.id} onPress={() => assegna(a.id)} style={styles.chip}>
                      <Text style={styles.chipTesto}>{a.numero_maglia != null ? `#${a.numero_maglia} ` : ""}{a.cognome}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Pressable disabled={!completa || salvataggio || liberoInCampo} onPress={salva} style={[styles.bottone, (!completa || salvataggio || liberoInCampo) && { opacity: 0.4 }]}>
              <Text style={styles.bottoneTesto}>{salvataggio ? "Un attimo…" : completa ? "Salva la formazione" : `Mancano ${6 - Object.keys(posizioni).length} posizioni`}</Text>
            </Pressable>

            {puoCambiareDistinta && (
              <>
                <Text style={styles.sezione}>Distinta della partita</Text>
                <Text style={styles.nota}>
                  Libero: {nLiberi} su {MAX_LIBERI}{nLiberi >= MAX_LIBERI ? " (completo)" : ""}. Il Libero si può aggiungere per tutta la partita; una convocata dimenticata solo durante il primo set.
                </Text>
                <View style={styles.rigaChip}>
                  {nLiberi < MAX_LIBERI && (
                    <Pressable onPress={() => setElencoAggiunta(elencoAggiunta === "libero" ? null : "libero")} style={[styles.chipAzione, elencoAggiunta === "libero" && styles.chipAttivo]}>
                      <Text style={[styles.chipAzioneTesto, elencoAggiunta === "libero" && styles.chipTestoAttivo]}>+ Aggiungi Libero</Text>
                    </Pressable>
                  )}
                  {primoSet ? (
                    <Pressable onPress={() => setElencoAggiunta(elencoAggiunta === "convocato" ? null : "convocato")} style={[styles.chipAzione, elencoAggiunta === "convocato" && styles.chipAttivo]}>
                      <Text style={[styles.chipAzioneTesto, elencoAggiunta === "convocato" && styles.chipTestoAttivo]}>+ Aggiungi convocata</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.nota}>Dal secondo set i convocati non si cambiano più.</Text>
                  )}
                </View>
                {elencoAggiunta && (
                  <View style={styles.rigaChip}>
                    {(elencoAggiunta === "libero" ? candidatiLibero : candidatiConvocato).length === 0 ? (
                      <Text style={styles.nota}>Nessuno da aggiungere.</Text>
                    ) : (elencoAggiunta === "libero" ? candidatiLibero : candidatiConvocato).map((a) => (
                      <Pressable key={a.id} onPress={() => aggiungi(a.id, elencoAggiunta === "libero")} style={styles.chip}>
                        <Text style={styles.chipTesto}>{a.numero_maglia != null ? `#${a.numero_maglia} ` : ""}{a.nome} {a.cognome}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sfondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 12 },
  carta: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 16, maxHeight: "94%", width: "100%", maxWidth: 520, alignSelf: "center" },
  intestazione: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titolo: { color: brand.colors.onSurface, fontSize: 18, fontWeight: "700" },
  chiudi: { color: brand.colors.muted, fontSize: 18 },
  nota: { color: brand.colors.muted, fontSize: 12, lineHeight: 17 },
  avviso: { backgroundColor: "rgba(255,215,0,0.15)", borderColor: brand.colors.warning, borderWidth: 1, borderRadius: 8, padding: 8 },
  avvisoTesto: { color: brand.colors.warning, fontSize: 12, fontWeight: "700" },
  campo: { backgroundColor: "#1a3a2a", borderRadius: 12, borderWidth: 2, borderColor: brand.colors.brand, padding: 8, gap: 8 },
  rete: { color: "#fff", fontSize: 10, fontWeight: "700", letterSpacing: 2, textAlign: "center", borderBottomWidth: 3, borderBottomColor: "#fff", paddingBottom: 2 },
  riga: { flexDirection: "row", gap: 8 },
  posizione: { flex: 1, minHeight: 60, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 10, alignItems: "center", justifyContent: "center", padding: 4, borderWidth: 2, borderColor: "transparent" },
  posizioneScelta: { borderColor: brand.colors.brand, backgroundColor: "rgba(255,255,255,0.25)" },
  numeroPosizione: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "700" },
  nomePosizione: { color: "#fff", fontSize: 13, fontWeight: "700" },
  sezione: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  rigaChip: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  chipAzione: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: brand.colors.brand },
  chipAzioneTesto: { color: brand.colors.brand, fontSize: 14, fontWeight: "600" },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
});
