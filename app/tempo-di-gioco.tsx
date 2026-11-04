import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { TitoloGrande } from "@/src/components/TitoloGrande";
import { TempoDiGiocoSquadra } from "@/src/components/TempoDiGioco";
import { brand } from "@/src/config";

/**
 * Tempo di gioco della squadra: per ogni atleta la quota di punti giocati in
 * campo e i set giocati nella stagione, per accorgersi subito di chi gioca poco
 * (importante nelle categorie giovanili). Raggiungibile con router.push("/tempo-di-gioco").
 */
export default function TempoDiGioco() {
  const { team, puoScrivere, puoVedereAnalisi, isSuperuser, caricamento } = useAuth();
  const puoVedereSquadra = puoScrivere || puoVedereAnalisi || isSuperuser;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.colonna}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.bersaglio} accessibilityRole="button">
            <Text style={styles.indietro}>‹ Indietro</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.colonna}>
          <TitoloGrande titolo="Tempo di gioco" sottotitolo={team?.nome ? `${team.nome} · punti e set giocati` : "Punti e set giocati"} />

          {caricamento ? (
            <ActivityIndicator color={brand.colors.brand} style={{ marginTop: 24 }} />
          ) : !team ? (
            <View style={styles.scheda}>
              <Text style={styles.nota}>Scegli prima una squadra per vedere il tempo di gioco.</Text>
            </View>
          ) : !puoVedereSquadra ? (
            <View style={styles.scheda}>
              <Text style={styles.titoloScheda}>Solo per lo staff</Text>
              <Text style={styles.nota}>Il confronto tra le atlete è visibile all&apos;allenatore e allo staff. Il tuo tempo di gioco lo trovi nella tua scheda atleta.</Text>
            </View>
          ) : (
            <TempoDiGiocoSquadra teamId={team.id} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { paddingHorizontal: 16, paddingTop: 8 },
  colonna: { width: "100%", maxWidth: 900, alignSelf: "center", gap: 12 },
  scroll: { padding: 16, paddingBottom: 48 },
  bersaglio: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  indietro: { color: brand.colors.brand, fontWeight: "600", fontSize: 17 },
  scheda: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 16, gap: 8 },
  titoloScheda: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  nota: { color: brand.colors.muted, fontSize: 13, lineHeight: 18 },
});
