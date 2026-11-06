import { useRef, type ReactNode } from "react";
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { brand } from "@/src/config";

export interface AzioneRiga { etichetta: string; icona: string; colore: string; onPress: () => void }

const LARGHEZZA = 92;

/**
 * Riga che si scorre verso sinistra per mostrare un'azione rapida (come Mail su iPhone).
 * Con `azione` nulla (gesto spento nelle Impostazioni) mostra solo la riga, senza alcun gesto.
 */
export function RigaScorrevole({ azione, sfondo = brand.colors.surfaceSecondary, children }: { azione: AzioneRiga | null; sfondo?: string; children: ReactNode }) {
  const x = useRef(new Animated.Value(0)).current;
  const aperta = useRef(false);
  const azioneRef = useRef(azione);
  azioneRef.current = azione;

  const vai = (a: boolean) => {
    aperta.current = a;
    Animated.spring(x, { toValue: a ? -LARGHEZZA : 0, useNativeDriver: false, bounciness: 0, speed: 18 }).start();
  };

  const gesto = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => {
        const base = aperta.current ? -LARGHEZZA : 0;
        x.setValue(Math.max(-LARGHEZZA - 24, Math.min(0, base + g.dx)));
      },
      onPanResponderRelease: (_e, g) => {
        const base = aperta.current ? -LARGHEZZA : 0;
        vai(base + g.dx < -LARGHEZZA / 2 || g.vx < -0.6);
      },
      onPanResponderTerminate: () => vai(false),
    }),
  ).current;

  if (!azione) return <>{children}</>;

  return (
    <View style={s.contenitore}>
      <Pressable
        style={[s.azione, { backgroundColor: azione.colore }]}
        onPress={() => { vai(false); azioneRef.current?.onPress(); }}
        accessibilityRole="button"
        accessibilityLabel={azione.etichetta}
      >
        <Ionicons name={azione.icona as never} size={22} color="#fff" />
        <Text style={s.azioneTesto}>{azione.etichetta}</Text>
      </Pressable>
      <Animated.View
        style={[{ backgroundColor: sfondo, transform: [{ translateX: x }] }, Platform.OS === "web" ? ({ touchAction: "pan-y" } as object) : null]}
        {...gesto.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  contenitore: { overflow: "hidden" },
  azione: { position: "absolute", right: 0, top: 0, bottom: 0, width: LARGHEZZA, alignItems: "center", justifyContent: "center", gap: 3 },
  azioneTesto: { color: "#fff", fontSize: 12, fontWeight: "600" },
});
