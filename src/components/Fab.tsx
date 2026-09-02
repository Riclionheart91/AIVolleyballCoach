import { Pressable, Text, StyleSheet, View } from "react-native";
import { brand } from "@/src/config";

interface Props {
  onPress: () => void;
  /** Se ci sono due FAB nella stessa schermata (es. Atlete: aggiungi + importa), questo sposta il secondo più in alto per non sovrapporli. */
  posizione?: "principale" | "secondaria";
  icona?: string;
  colore?: string;
}

export function FabAggiungi({ onPress, posizione = "principale", icona = "+", colore }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.fab, posizione === "secondaria" && styles.fabSecondaria, colore ? { backgroundColor: colore } : null]}
    >
      <Text style={styles.fabTesto}>{icona}</Text>
    </Pressable>
  );
}

/** Contenitore da avvolgere attorno all'intera schermata quando ci sono uno o più FAB, così restano ancorati in basso a destra indipendentemente dallo scroll del contenuto. */
export function ContenitoreConFab({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: brand.colors.brand,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  fabSecondaria: {
    right: 20,
    bottom: 90,
    backgroundColor: brand.colors.brandSecondary,
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  fabTesto: { color: "#000", fontSize: 26, fontWeight: "700", lineHeight: 28 },
});
