import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { brand } from "@/src/config";

/**
 * Campo di ricerca in stile iPhone: pillola grigia con lente, "x" tonda per cancellare e
 * pulsante "Annulla" che compare quando il campo e' in uso.
 */
export function BarraRicerca({ value, onChangeText, placeholder = "Cerca", testID, accessibilityLabel, stile }: {
  value: string; onChangeText: (t: string) => void; placeholder?: string; testID?: string; accessibilityLabel?: string; stile?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<TextInput>(null);
  const [attivo, setAttivo] = useState(false);
  const mostraAnnulla = attivo || value.length > 0;
  return (
    <View style={[s.riga, stile]}>
      <View style={s.campo}>
        <Ionicons name="search" size={17} color={brand.colors.muted} />
        <TextInput
          ref={ref}
          testID={testID}
          style={[s.input, { outlineStyle: "none" } as object]}
          placeholder={placeholder}
          placeholderTextColor={brand.colors.muted}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setAttivo(true)}
          onBlur={() => setAttivo(false)}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
          accessibilityLabel={accessibilityLabel ?? placeholder}
        />
        {value.length > 0 && (
          <Pressable onPress={() => onChangeText("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancella la ricerca">
            <Ionicons name="close-circle" size={18} color={brand.colors.muted} />
          </Pressable>
        )}
      </View>
      {mostraAnnulla && (
        <Pressable onPress={() => { onChangeText(""); ref.current?.blur(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Annulla la ricerca">
          <Text style={s.annulla}>Annulla</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  riga: { flexDirection: "row", alignItems: "center", gap: 12 },
  campo: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, height: 38, paddingHorizontal: 10, borderRadius: 11, backgroundColor: "rgba(118,118,128,0.24)" },
  input: { flex: 1, color: brand.colors.onSurface, fontSize: 17, paddingVertical: 0, height: 38 },
  annulla: { color: brand.colors.brand, fontSize: 17 },
});
