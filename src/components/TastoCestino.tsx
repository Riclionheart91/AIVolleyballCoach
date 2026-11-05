import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { brand } from "@/src/config";

/** Cestino rosso per eliminare: al posto della scritta "Elimina". Area di tocco 44 px anche se l'icona e' piccola. */
export function TastoCestino({ onPress, disabled, etichetta = "Elimina", stile }: {
  onPress: () => void; disabled?: boolean; etichetta?: string; stile?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={etichetta}
      style={({ pressed }) => [s.tasto, pressed && { opacity: 0.5 }, disabled && { opacity: 0.4 }, stile]}
    >
      <Ionicons name="trash-outline" size={20} color={brand.colors.error} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  tasto: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
