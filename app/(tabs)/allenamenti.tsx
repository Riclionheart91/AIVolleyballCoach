import { useCallback, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaAtlete } from "@/src/services/athletes";
import { creaAllenamento, elencaAllenamenti, elencaPresenzeAllenamento, elencaRpeAllenamento, registraPresenza, registraRpe } from "@/src/services/trainings";
import { brand } from "@/src/config";
import type { Athlete, Attendance, Rpe, Training } from "@/src/types/database";

export default function Allenamenti() {
  const { team } = useAuth();
  const [allenamenti, setAllenamenti] = useState<Training[]>([]);
  const [aperto, setAperto] = useState<string | null>(null);
  const [titolo, setTitolo] = useState("Allenamento");

  const carica = useCallback(async () => {
    if (!team) return;
    setAllenamenti(await elencaAllenamenti(team.id));
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function crea() {
    if (!team) return;
    await creaAllenamento(team.id, { data: new Date().toISOString(), titolo: titolo.trim() || "Allenamento", note: "" });
    carica();
  }

  return (
    <View style={styles.container}>
      <View style={styles.form}>
        <TextInput style={styles.input} placeholder="Titolo allenamento" placeholderTextColor={brand.colors.muted} value={titolo} onChangeText={setTitolo} />
        <Pressable style={styles.bottone} onPress={crea}>
          <Text style={styles.bottoneTesto}>Nuovo allenamento (oggi)</Text>
        </Pressable>
      </View>

      <FlatList
        data={allenamenti}
        keyExtractor={(t) => t.id}
        refreshControl={<RefreshControl refreshing={false} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListEmptyComponent={<Text style={styles.vuoto}>Nessun allenamento ancora.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Pressable onPress={() => setAperto(aperto === item.id ? null : item.id)}>
              <Text style={styles.cardTitolo}>{item.titolo}</Text>
              <Text style={styles.cardSotto}>{new Date(item.data).toLocaleDateString("it-IT")}</Text>
            </Pressable>
            {aperto === item.id && team && <PresenzeRpe trainingId={item.id} teamId={team.id} />}
          </View>
        )}
      />
    </View>
  );
}

/** Presenze + RPE per singolo allenamento — un tap per atleta, niente form separati (stesso principio "poche interazioni per azione" dello scouting live pianificato in F3). */
function PresenzeRpe({ trainingId, teamId }: { trainingId: string; teamId: string }) {
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [presenze, setPresenze] = useState<Record<string, boolean>>({});
  const [valoriRpe, setValoriRpe] = useState<Record<string, number>>({});

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [listaAtlete, listaPresenze, listaRpe] = await Promise.all([
          elencaAtlete(teamId),
          elencaPresenzeAllenamento(trainingId),
          elencaRpeAllenamento(trainingId),
        ]);
        setAtlete(listaAtlete);
        setPresenze(Object.fromEntries((listaPresenze as Attendance[]).map((p) => [p.athlete_id, p.presente])));
        setValoriRpe(Object.fromEntries((listaRpe as Rpe[]).map((r) => [r.athlete_id, r.valore])));
      })();
    }, [trainingId, teamId]),
  );

  async function segnaPresenza(athleteId: string, presente: boolean) {
    setPresenze((p) => ({ ...p, [athleteId]: presente }));
    await registraPresenza(trainingId, athleteId, presente);
  }

  async function segnaRpe(athleteId: string, valore: number) {
    setValoriRpe((r) => ({ ...r, [athleteId]: valore }));
    await registraRpe(trainingId, athleteId, valore);
  }

  return (
    <View style={styles.presenzeContainer}>
      {atlete.map((a) => (
        <View key={a.id} style={styles.rigaAtleta}>
          <Text style={styles.rigaAtletaNome}>{a.cognome}</Text>
          <View style={styles.presenzaBottoni}>
            <Pressable onPress={() => segnaPresenza(a.id, true)} style={[styles.presenzaBtn, presenze[a.id] === true && styles.presenzaBtnSi]}>
              <Text style={styles.presenzaBtnTesto}>P</Text>
            </Pressable>
            <Pressable onPress={() => segnaPresenza(a.id, false)} style={[styles.presenzaBtn, presenze[a.id] === false && styles.presenzaBtnNo]}>
              <Text style={styles.presenzaBtnTesto}>A</Text>
            </Pressable>
          </View>
          {presenze[a.id] !== false && (
            <View style={styles.rpeBottoni}>
              {[3, 5, 7, 9].map((v) => (
                <Pressable key={v} onPress={() => segnaRpe(a.id, v)} style={[styles.rpeBtn, valoriRpe[a.id] === v && styles.rpeBtnAttivo]}>
                  <Text style={styles.rpeBtnTesto}>{v}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface, padding: 16, gap: 16 },
  form: { gap: 8, backgroundColor: brand.colors.surfaceSecondary, padding: 12, borderRadius: 12 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  bottone: { backgroundColor: brand.colors.brand, padding: 10, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTitolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  cardSotto: { color: brand.colors.muted, fontSize: 13 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  presenzeContainer: { marginTop: 12, gap: 8, borderTopWidth: 1, borderTopColor: brand.colors.border, paddingTop: 12 },
  rigaAtleta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rigaAtletaNome: { color: brand.colors.onSurface, flex: 1 },
  presenzaBottoni: { flexDirection: "row", gap: 4 },
  presenzaBtn: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surfaceTertiary },
  presenzaBtnSi: { backgroundColor: brand.colors.success },
  presenzaBtnNo: { backgroundColor: brand.colors.error },
  presenzaBtnTesto: { color: "#fff", fontWeight: "700", fontSize: 12 },
  rpeBottoni: { flexDirection: "row", gap: 4 },
  rpeBtn: { width: 26, height: 26, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surfaceTertiary },
  rpeBtnAttivo: { backgroundColor: brand.colors.brand },
  rpeBtnTesto: { color: brand.colors.onSurface, fontSize: 11, fontWeight: "700" },
});
