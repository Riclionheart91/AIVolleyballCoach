import { View, Text, Pressable, StyleSheet, FlatList } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { brand, etichetteRuolo } from "@/src/config";

export default function SelezionaSquadra() {
  const { squadreDisponibili, team, cambiaSquadra } = useAuth();

  async function seleziona(teamId: string) {
    await cambiaSquadra(teamId);
    router.replace("/");
  }

  return (
    <View style={styles.container}>
      <View style={styles.intestazione}>
        <Text style={styles.title}>Le tue squadre</Text>
        <Pressable onPress={() => router.push("/crea-squadra")} style={styles.bottoneAggiungi}>
          <Text style={styles.bottoneAggiungiTesto}>+ Aggiungi squadra</Text>
        </Pressable>
      </View>
      <FlatList
        data={squadreDisponibili}
        keyExtractor={(o) => o.team.id}
        renderItem={({ item }) => (
          <Pressable style={[styles.card, item.team.id === team?.id && styles.cardAttiva]} onPress={() => seleziona(item.team.id)}>
            <Text style={styles.cardNome}>{item.team.nome}</Text>
            <Text style={styles.cardRuolo}>{etichetteRuolo[item.ruolo]}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface, padding: 20, gap: 16 },
  intestazione: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: brand.colors.onSurface, fontSize: 20, fontWeight: "700" },
  bottoneAggiungi: { borderColor: brand.colors.brand, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  bottoneAggiungiTesto: { color: brand.colors.brand, fontWeight: "600", fontSize: 13 },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: "transparent" },
  cardAttiva: { borderColor: brand.colors.brand },
  cardNome: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  cardRuolo: { color: brand.colors.muted, fontSize: 13, marginTop: 2 },
});
