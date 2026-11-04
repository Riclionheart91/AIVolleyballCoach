import { Text, View, StyleSheet } from "react-native";
import { brand } from "@/src/config";

/** Titolo grande in cima alla schermata (stile Apple Music): 34 px, peso 700. */
export function TitoloGrande({ titolo, sottotitolo }: { titolo: string; sottotitolo?: string }) {
  return (
    <View style={styles.contenitore}>
      <Text accessibilityRole="header" style={styles.titolo}>{titolo}</Text>
      {sottotitolo ? <Text style={styles.sottotitolo}>{sottotitolo}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  contenitore: { paddingTop: 4, paddingBottom: 12, gap: 2 },
  titolo: { color: brand.colors.onSurface, fontSize: 34, fontWeight: "700", letterSpacing: -0.5 },
  sottotitolo: { color: brand.colors.muted, fontSize: 15 },
});
