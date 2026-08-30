import { useCallback, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, RefreshControl, Alert } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { andamentoSquadraPartite, creaMatch, elencaPartite, type AndamentoSquadraPartiteVoce } from "@/src/services/matches";
import { brand } from "@/src/config";
import type { Match } from "@/src/types/database";

export default function Partite() {
  const { team, puoScrivere } = useAuth();
  const [partite, setPartite] = useState<Match[]>([]);
  const [andamento, setAndamento] = useState<AndamentoSquadraPartiteVoce[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [avversario, setAvversario] = useState("");
  const [luogo, setLuogo] = useState<"casa" | "trasferta">("casa");

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      const [listaPartite, listaAndamento] = await Promise.all([elencaPartite(team.id), andamentoSquadraPartite(team.id).catch(() => [])]);
      setPartite(listaPartite);
      setAndamento(listaAndamento);
    } finally {
      setCaricamento(false);
    }
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function nuovaPartita() {
    if (!team || !avversario.trim()) return;
    try {
      const matchId = await creaMatch(team.id, avversario.trim(), new Date().toISOString(), luogo);
      setAvversario("");
      router.push(`/partita/${matchId}`);
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    }
  }

  return (
    <View style={styles.container}>
      {puoScrivere && (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder="Avversario" placeholderTextColor={brand.colors.muted} value={avversario} onChangeText={setAvversario} />
          <View style={styles.selettoreRiga}>
            {(["casa", "trasferta"] as const).map((l) => (
              <Pressable key={l} onPress={() => setLuogo(l)} style={[styles.chip, luogo === l && styles.chipAttivo]}>
                <Text style={[styles.chipTesto, luogo === l && styles.chipTestoAttivo]}>{l === "casa" ? "Casa" : "Trasferta"}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.bottone} onPress={nuovaPartita}>
            <Text style={styles.bottoneTesto}>Inizia partita (scouting live)</Text>
          </Pressable>
        </View>
      )}

      {andamento.length > 0 && (
        <View style={styles.cardAndamento}>
          <Text style={styles.sottotitoloSezione}>Andamento tra le partite</Text>
          {andamento.slice(0, 8).map((v, i) => (
            <View key={i} style={styles.rigaAndamento}>
              <Text style={styles.rigaAndamentoTesto}>{v.partita.slice(0, 10)} vs {v.avversario} — {v.fondamentale}</Text>
              <Text style={styles.rigaAndamentoValore}>+{v.punti} / -{v.errori}</Text>
            </View>
          ))}
        </View>
      )}

      <FlatList
        data={partite}
        keyExtractor={(m) => m.id}
        refreshControl={<RefreshControl refreshing={caricamento} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListEmptyComponent={!caricamento ? <Text style={styles.vuoto}>Nessuna partita ancora.</Text> : null}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/partita/${item.id}`)}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.cardTitolo}>vs {item.avversario}</Text>
              <Text style={[styles.badge, item.stato === "in_corso" && styles.badgeInCorso]}>{item.stato}</Text>
            </View>
            <Text style={styles.cardSotto}>{new Date(item.data).toLocaleDateString("it-IT")} — {item.luogo}</Text>
            {item.stato === "conclusa" && <Text style={styles.cardRisultato}>Set: {item.set_vinti_noi} - {item.set_vinti_avversario}</Text>}
          </Pressable>
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
  selettoreRiga: { flexDirection: "row", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  cardAndamento: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 12, gap: 6 },
  sottotitoloSezione: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "700" },
  rigaAndamento: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaAndamentoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12, flex: 1, marginRight: 8 },
  rigaAndamentoValore: { color: brand.colors.brand, fontWeight: "700", fontSize: 12 },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, marginBottom: 10, gap: 2 },
  cardTitolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  cardSotto: { color: brand.colors.muted, fontSize: 13 },
  cardRisultato: { color: brand.colors.brand, fontWeight: "700", marginTop: 4 },
  badge: { color: brand.colors.muted, fontSize: 12, textTransform: "uppercase" },
  badgeInCorso: { color: brand.colors.warning, fontWeight: "700" },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
});
