import { useCallback, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, Alert, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { attivaStagione, creaStagione, elencaStagioni, generaBaselineStagione } from "@/src/services/seasons";
import { brand } from "@/src/config";
import type { Season } from "@/src/types/database";

export default function Stagioni() {
  const { team, puoScrivere } = useAuth();
  const [stagioni, setStagioni] = useState<Season[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [nome, setNome] = useState("");

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      setStagioni(await elencaStagioni(team.id));
    } finally {
      setCaricamento(false);
    }
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function crea() {
    if (!team || !nome.trim()) return;
    try {
      await creaStagione(team.id, { nome: nome.trim(), data_apertura: new Date().toISOString().slice(0, 10) });
      setNome("");
      carica();
    } catch (e) {
      Alert.alert("Errore nella creazione della stagione", (e as Error).message);
    }
  }

  async function attiva(id: string) {
    try {
      await attivaStagione(id);
      carica();
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    }
  }

  async function generaBaseline(id: string) {
    try {
      const n = await generaBaselineStagione(id);
      Alert.alert("Baseline generata", `${n} valori di baseline creati a partire dall'ultima valutazione disponibile per ogni atleta/fondamentale.`);
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    }
  }

  return (
    <View style={styles.container}>
      {puoScrivere && (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder="Nome stagione (es. 2026/2027)" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} />
          <Pressable style={styles.bottone} onPress={crea}>
            <Text style={styles.bottoneTesto}>Crea stagione</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={stagioni}
        keyExtractor={(s) => s.id}
        refreshControl={<RefreshControl refreshing={caricamento} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListEmptyComponent={!caricamento ? <Text style={styles.vuoto}>Nessuna stagione ancora.</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={styles.cardTitolo}>{item.nome}</Text>
              <Text style={[styles.badge, item.stato === "attiva" && styles.badgeAttiva]}>{item.stato}</Text>
            </View>
            <Text style={styles.cardSotto}>Apertura: {item.data_apertura}</Text>
            {puoScrivere && (
              <View style={styles.azioni}>
                {item.stato !== "attiva" && (
                  <Pressable style={styles.bottoneSecondario} onPress={() => attiva(item.id)}>
                    <Text style={styles.bottoneSecondarioTesto}>Attiva</Text>
                  </Pressable>
                )}
                <Pressable style={styles.bottoneSecondario} onPress={() => generaBaseline(item.id)}>
                  <Text style={styles.bottoneSecondarioTesto}>Genera baseline</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface, padding: 16, gap: 16 },
  form: { gap: 8, backgroundColor: brand.colors.surfaceSecondary, padding: 12, borderRadius: 12 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  bottone: { backgroundColor: brand.colors.brand, padding: 10, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, marginBottom: 10, gap: 4 },
  cardTitolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  cardSotto: { color: brand.colors.muted, fontSize: 13 },
  badge: { color: brand.colors.muted, fontSize: 12, textTransform: "uppercase" },
  badgeAttiva: { color: brand.colors.success, fontWeight: "700" },
  azioni: { flexDirection: "row", gap: 8, marginTop: 8 },
  bottoneSecondario: { borderColor: brand.colors.brand, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "600", fontSize: 13 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
});
