import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaEsercizi } from "@/src/services/exercises";
import { elencaPianoAllenamento, generaPianoAllenamentoAI, impostaPianoAllenamento, type VoceRiepilogoPiano } from "@/src/services/trainingPlan";
import { confermaAzione } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import { supabaseClient } from "@/src/lib/supabase";
import type { Exercise, Training } from "@/src/types/database";

export default function PianoAllenamento() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { team } = useAuth();
  const [training, setTraining] = useState<Training | null>(null);
  const [catalogo, setCatalogo] = useState<Exercise[]>([]);
  const [argomento, setArgomento] = useState("");
  const [durataObiettivo, setDurataObiettivo] = useState("60");
  const [esercizi, setEsercizi] = useState<VoceRiepilogoPiano[]>([]);
  const [mostraCatalogo, setMostraCatalogo] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const carica = useCallback(async () => {
    if (!id || !team) return;
    const { data: t } = await supabaseClient.from("trainings").select("*").eq("id", id).single();
    setTraining(t ?? null);
    setArgomento(t?.argomento ?? "");
    const cat = await elencaEsercizi(team.id);
    setCatalogo(cat);
    const piano = await elencaPianoAllenamento(id);
    setEsercizi(piano.map((p) => ({
      exerciseId: p.exercise_id,
      nome: cat.find((c) => c.id === p.exercise_id)?.nome ?? "Esercizio",
      durataMinuti: p.durata_minuti ?? 10,
      note: p.note ?? "",
    })));
  }, [id, team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  const totaleMinuti = esercizi.reduce((s, e) => s + (e.durataMinuti || 0), 0);

  function aggiungiEsercizio(ex: Exercise) {
    setEsercizi((prev) => [...prev, { exerciseId: ex.id, nome: ex.nome, durataMinuti: 10, note: "" }]);
    setMostraCatalogo(false);
  }

  function rimuoviEsercizio(indice: number) {
    setEsercizi((prev) => prev.filter((_, i) => i !== indice));
  }

  function aggiornaDurata(indice: number, testo: string) {
    const valore = Number(testo) || 0;
    setEsercizi((prev) => prev.map((e, i) => (i === indice ? { ...e, durataMinuti: valore } : e)));
  }

  async function onGeneraAI() {
    if (!team) return;
    if (esercizi.length > 0) {
      confermaAzione("Sostituire il piano attuale?", "La proposta AI sostituirà gli esercizi già inseriti. Potrai comunque modificarla prima di salvare.", "Genera comunque", eseguiGenerazione);
    } else {
      eseguiGenerazione();
    }

    async function eseguiGenerazione() {
      setGenerando(true);
      try {
        const r = await generaPianoAllenamentoAI(team!.id, argomento || "allenamento generico", Number(durataObiettivo) || 60, catalogo);
        if (r.errore || !r.esercizi) { Alert.alert("Generazione non riuscita", r.messaggio ?? "Errore sconosciuto"); return; }
        setEsercizi(r.esercizi);
        if (r.argomentoSuggerito) setArgomento(r.argomentoSuggerito);
      } catch (e) {
        Alert.alert("Errore", (e as Error).message);
      } finally {
        setGenerando(false);
      }
    }
  }

  async function salva() {
    if (!id) return;
    setSalvando(true);
    try {
      await impostaPianoAllenamento(id, argomento, esercizi);
      Alert.alert("Salvato", "Piano allenamento aggiornato.");
      router.back();
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (!training) return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← {training.titolo}</Text></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={styles.card}>
          <Text style={styles.etichetta}>Argomento della sessione</Text>
          <TextInput style={styles.input} placeholder="Es. difesa e copertura attacco" placeholderTextColor={brand.colors.muted} value={argomento} onChangeText={setArgomento} />

          <View style={styles.rigaGenerazione}>
            <View style={{ flex: 1 }}>
              <Text style={styles.etichetta}>Durata obiettivo (min)</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={durataObiettivo} onChangeText={setDurataObiettivo} />
            </View>
            <Pressable style={styles.bottoneAI} onPress={onGeneraAI} disabled={generando}>
              {generando ? <ActivityIndicator color={brand.colors.brandSecondary} /> : <Text style={styles.bottoneAITesto}>✨ Genera con AI</Text>}
            </Pressable>
          </View>
          <Text style={styles.nota}>La proposta AI usa solo esercizi già nel tuo catalogo, e resta modificabile prima di salvare — se non risponde, costruisci il piano scegliendo qui sotto.</Text>
        </View>

        <View style={styles.card}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.etichetta}>Esercizi ({totaleMinuti} min totali)</Text>
            <Pressable onPress={() => setMostraCatalogo(!mostraCatalogo)}><Text style={styles.linkAggiungi}>{mostraCatalogo ? "Chiudi" : "+ Aggiungi"}</Text></Pressable>
          </View>

          {mostraCatalogo && (
            <View style={styles.listaCatalogo}>
              {catalogo.length === 0 ? (
                <Text style={styles.nota}>Nessun esercizio nel catalogo — aggiungine dalla tab Esercizi.</Text>
              ) : (
                catalogo.map((ex) => (
                  <Pressable key={ex.id} style={styles.rigaCatalogo} onPress={() => aggiungiEsercizio(ex)}>
                    <Text style={styles.rigaCatalogoTesto}>{ex.nome}{ex.categoria ? ` (${ex.categoria})` : ""}</Text>
                  </Pressable>
                ))
              )}
            </View>
          )}

          {esercizi.length === 0 ? (
            <Text style={styles.nota}>Nessun esercizio ancora in questo piano.</Text>
          ) : (
            esercizi.map((e, i) => (
              <View key={i} style={styles.rigaEsercizio}>
                <Text style={styles.rigaEsercizioNome}>{e.nome}</Text>
                <TextInput style={styles.inputDurata} keyboardType="numeric" value={String(e.durataMinuti)} onChangeText={(t) => aggiornaDurata(i, t)} />
                <Text style={styles.nota}>min</Text>
                <Pressable onPress={() => rimuoviEsercizio(i)}><Text style={styles.rimuovi}>✕</Text></Pressable>
              </View>
            ))
          )}
        </View>

        <Pressable style={styles.bottoneSalva} onPress={salva} disabled={salvando}>
          {salvando ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneSalvaTesto}>Salva piano</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 8 },
  etichetta: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 14 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  nota: { color: brand.colors.muted, fontSize: 12 },
  rigaGenerazione: { flexDirection: "row", gap: 10, alignItems: "flex-end" },
  bottoneAI: { borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, justifyContent: "center" },
  bottoneAITesto: { color: brand.colors.brandSecondary, fontWeight: "700" },
  linkAggiungi: { color: brand.colors.brand, fontWeight: "600", fontSize: 13 },
  listaCatalogo: { maxHeight: 180, gap: 4 },
  rigaCatalogo: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaCatalogoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  rigaEsercizio: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: brand.colors.border },
  rigaEsercizioNome: { color: brand.colors.onSurface, flex: 1, fontSize: 14 },
  inputDurata: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 6, padding: 6, width: 44, textAlign: "center" },
  rimuovi: { color: brand.colors.error, fontSize: 16, paddingHorizontal: 4 },
  bottoneSalva: { backgroundColor: brand.colors.brand, padding: 14, borderRadius: 10, alignItems: "center" },
  bottoneSalvaTesto: { color: "#000", fontWeight: "700" },
});
