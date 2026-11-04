import { View, Text, Pressable, StyleSheet, FlatList } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { Ionicons } from "@expo/vector-icons";
import { brand, etichetteRuolo } from "@/src/config";
import { TitoloGrande } from "@/src/components/TitoloGrande";

export default function SelezionaSquadra() {
  const { squadreDisponibili, team, cambiaSquadra } = useAuth();

  async function seleziona(teamId: string) {
    await cambiaSquadra(teamId);
    router.replace("/");
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={squadreDisponibili}
        keyExtractor={(o) => o.team.id}
        contentContainerStyle={styles.contenuto}
        ListHeaderComponent={
          <View>
            <TitoloGrande titolo="Le tue squadre" />
            <Pressable onPress={() => router.push("/crea-squadra")} style={styles.bottoneAggiungi}>
              <Text style={styles.bottoneAggiungiTesto}>+ Aggiungi squadra</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable style={[styles.card, item.team.id === team?.id && styles.cardAttiva]} onPress={() => seleziona(item.team.id)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardNome}>{item.team.nome}</Text>
              <Text style={styles.cardRuolo}>{etichetteRuolo[item.ruolo]}</Text>
            </View>
            {item.team.id === team?.id ? <Ionicons name="checkmark-circle" size={22} color={brand.colors.brand} /> : <Ionicons name="chevron-forward" size={16} color={brand.colors.muted} />}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  contenuto: { padding: 16, paddingBottom: 48, gap: 10, width: "100%", maxWidth: 900, alignSelf: "center" },
  bottoneAggiungi: { alignSelf: "flex-start", minHeight: 44, paddingHorizontal: 18, borderRadius: 999, backgroundColor: brand.colors.brand, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  bottoneAggiungiTesto: { color: "#000", fontWeight: "700", fontSize: 15 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, minHeight: 60, borderWidth: 1, borderColor: "transparent" },
  cardAttiva: { borderColor: brand.colors.brand },
  cardNome: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  cardRuolo: { color: brand.colors.muted, fontSize: 14, marginTop: 2 },
});
