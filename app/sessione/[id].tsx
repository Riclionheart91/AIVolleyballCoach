import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaEsercizi } from "@/src/services/exercises";
import {
  avviaEsercizio,
  avviaSessione,
  concludiEsercizio,
  concludiSessione,
  elencaSessione,
  type VoceSessione,
} from "@/src/services/trainingPlan";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import { supabaseClient } from "@/src/lib/supabase";
import type { Training } from "@/src/types/database";

function mmss(secondi: number): string {
  const m = Math.floor(secondi / 60);
  const s = secondi % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Esecuzione della seduta da bordo campo: si avvia un esercizio alla
 * volta e l'app cronometra il tempo reale. Avviare un esercizio chiude
 * automaticamente il precedente (lato database), così non restano
 * cronometri aperti per dimenticanza quando si passa velocemente da
 * un'esercitazione all'altra.
 */
export default function SessioneAllenamento() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { team, puoScrivere } = useAuth();
  const [training, setTraining] = useState<Training | null>(null);
  const [voci, setVoci] = useState<VoceSessione[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  // Serve solo a far avanzare i cronometri a video: i tempi veri sono
  // calcolati dal database sui timestamp, non da questo contatore.
  const [, setTick] = useState(0);

  const carica = useCallback(async () => {
    if (!id || !team) return;
    setCaricamento(true);
    try {
      const { data: t } = await supabaseClient.from("trainings").select("*").eq("id", id).single();
      setTraining(t ?? null);
      const catalogo = await elencaEsercizi(team.id);
      setVoci(await elencaSessione(id, catalogo));
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCaricamento(false);
    }
  }, [id, team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const inCorso = voci.find((v) => v.iniziato_il && !v.concluso_il);
  const sessioneAvviata = !!training?.iniziato_il && !training?.concluso_il;

  function secondiTrascorsi(v: VoceSessione): number {
    if (v.durata_effettiva_secondi != null) return v.durata_effettiva_secondi;
    if (!v.iniziato_il) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(v.iniziato_il).getTime()) / 1000));
  }

  const totalePianificato = voci.reduce((s, v) => s + (v.durata_minuti ?? 0), 0);
  const totaleEffettivo = Math.round(voci.reduce((s, v) => s + secondiTrascorsi(v), 0) / 60);

  async function onAvviaSessione() {
    if (!id) return;
    try { await avviaSessione(id); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  async function onAvvia(v: VoceSessione) {
    try { await avviaEsercizio(v.id); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  async function onConcludi(v: VoceSessione) {
    try { await concludiEsercizio(v.id); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  function onChiudiSessione() {
    if (!id) return;
    confermaAzione("Chiudere la sessione?", "L'esercizio eventualmente in corso verrà fermato e i tempi salvati.", "Chiudi sessione", async () => {
      try { await concludiSessione(id); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
    });
  }

  if (caricamento || !training) return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← {training.titolo}</Text></Pressable>
      </View>

      <View style={styles.riepilogo}>
        <View>
          <Text style={styles.etichettaRiepilogo}>Pianificato</Text>
          <Text style={styles.valoreRiepilogo}>{totalePianificato} min</Text>
        </View>
        <View>
          <Text style={styles.etichettaRiepilogo}>Effettivo</Text>
          <Text style={[styles.valoreRiepilogo, totaleEffettivo > totalePianificato && totalePianificato > 0 && styles.valoreOltre]}>{totaleEffettivo} min</Text>
        </View>
        <View>
          <Text style={styles.etichettaRiepilogo}>Esercizi</Text>
          <Text style={styles.valoreRiepilogo}>{voci.filter((v) => v.concluso_il).length}/{voci.length}</Text>
        </View>
      </View>

      {voci.length === 0 ? (
        <Text style={styles.vuoto}>Questa seduta non ha ancora esercizi. Aggiungili dal piano allenamento.</Text>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 100 }}>
          {voci.map((v) => {
            const attivo = inCorso?.id === v.id;
            const fatto = !!v.concluso_il;
            const secondi = secondiTrascorsi(v);
            const pianificatoSec = (v.durata_minuti ?? 0) * 60;
            const oltre = pianificatoSec > 0 && secondi > pianificatoSec;

            return (
              <View key={v.id} style={[styles.card, attivo && styles.cardAttiva, fatto && styles.cardFatta]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.nomeEsercizio}>{fatto ? "✓ " : ""}{v.nome}</Text>
                  <Text style={styles.dettaglio}>
                    pianificato {v.durata_minuti ?? 0} min
                    {(attivo || fatto) ? ` · reale ${mmss(secondi)}` : ""}
                    {oltre ? "  ⏱ oltre il previsto" : ""}
                  </Text>
                </View>

                {puoScrivere && sessioneAvviata && (
                  attivo ? (
                    <Pressable style={styles.bottoneStop} onPress={() => onConcludi(v)}>
                      <Text style={styles.bottoneStopTesto}>■ Fine</Text>
                    </Pressable>
                  ) : (
                    <Pressable style={styles.bottoneStart} onPress={() => onAvvia(v)}>
                      <Text style={styles.bottoneStartTesto}>{fatto ? "↻ Rifai" : "▶ Avvia"}</Text>
                    </Pressable>
                  )
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {puoScrivere && (
        <View style={styles.pieDiPagina}>
          {!sessioneAvviata ? (
            <Pressable style={styles.bottoneGrande} onPress={onAvviaSessione}>
              <Text style={styles.bottoneGrandeTesto}>{training.concluso_il ? "▶ RIAPRI SESSIONE" : "▶ INIZIA ALLENAMENTO"}</Text>
            </Pressable>
          ) : (
            <Pressable style={[styles.bottoneGrande, styles.bottoneChiudi]} onPress={onChiudiSessione}>
              <Text style={styles.bottoneGrandeTesto}>■ CHIUDI SESSIONE</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  riepilogo: { flexDirection: "row", justifyContent: "space-around", backgroundColor: brand.colors.surfaceSecondary, paddingVertical: 12, marginHorizontal: 16, marginTop: 12, borderRadius: 12 },
  etichettaRiepilogo: { color: brand.colors.muted, fontSize: 11, textAlign: "center" },
  valoreRiepilogo: { color: brand.colors.onSurface, fontSize: 18, fontWeight: "800", textAlign: "center" },
  valoreOltre: { color: brand.colors.warning },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32, paddingHorizontal: 24 },
  card: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "transparent" },
  cardAttiva: { borderColor: brand.colors.brand, backgroundColor: brand.colors.surfaceTertiary },
  cardFatta: { opacity: 0.65 },
  nomeEsercizio: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  dettaglio: { color: brand.colors.muted, fontSize: 12, marginTop: 2 },
  bottoneStart: { backgroundColor: brand.colors.brand, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  bottoneStartTesto: { color: "#000", fontWeight: "800" },
  bottoneStop: { backgroundColor: brand.colors.error, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  bottoneStopTesto: { color: "#fff", fontWeight: "800" },
  pieDiPagina: { padding: 16, borderTopWidth: 1, borderTopColor: brand.colors.border },
  bottoneGrande: { backgroundColor: brand.colors.success, paddingVertical: 16, borderRadius: 14, alignItems: "center" },
  bottoneChiudi: { backgroundColor: brand.colors.surfaceTertiary },
  bottoneGrandeTesto: { color: "#000", fontWeight: "800", fontSize: 16 },
});
