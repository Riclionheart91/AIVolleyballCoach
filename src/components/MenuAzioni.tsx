import { useState } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { brand } from "@/src/config";
import { useTrascinaPerChiudere } from "@/src/lib/trascinaPerChiudere";

export interface VoceMenuAzioni {
  etichetta: string;
  /** Nome di un'icona Ionicons, es. "archive-outline". */
  icona?: string;
  onPress: () => void;
  /** Voce rossa (elimina, rimuovi). */
  distruttiva?: boolean;
  /** Riga piccola sotto il nome: spiega cosa succede o perche' la voce non si puo' usare. */
  sotto?: string;
  disattiva?: boolean;
}

/**
 * Pulsante "⋯" che apre un elenco di azioni secondarie (come i menu di iPhone): tiene le schermate pulite lasciando
 * in vista solo le azioni principali. Le voci distruttive sono rosse e stanno in fondo.
 */
export function MenuAzioni({ titolo, voci, stile, etichetta = "Altre azioni", testoPulsante, occupato }: {
  titolo?: string; voci: VoceMenuAzioni[]; stile?: StyleProp<ViewStyle>; etichetta?: string;
  /** Se c'e', il pulsante e' una pillola arancione con questo testo (azione principale con scelta) invece del "⋯". */
  testoPulsante?: string; occupato?: boolean;
}) {
  const [aperto, setAperto] = useState(false);
  const trascina = useTrascinaPerChiudere(() => setAperto(false));
  const ordinate = [...voci.filter((v) => !v.distruttiva), ...voci.filter((v) => v.distruttiva)];
  return (
    <>
      <Pressable
        onPress={() => setAperto(true)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={etichetta}
        disabled={occupato}
        style={({ pressed }) => [testoPulsante ? s.pillola : s.tasto, pressed && { opacity: 0.6 }, occupato && { opacity: 0.5 }, stile]}
      >
        {testoPulsante
          ? <Text style={s.pillolaTesto}>{occupato ? "Attendi…" : testoPulsante}</Text>
          : <Ionicons name="ellipsis-horizontal" size={20} color={brand.colors.onSurfaceSecondary} />}
      </Pressable>
      <Modal visible={aperto} animationType="fade" transparent onRequestClose={() => setAperto(false)}>
        <Pressable style={s.sfondo} onPress={() => setAperto(false)}>
          <Animated.View style={[s.carta, trascina.stile]} {...trascina.panHandlers}>
            <View style={s.maniglia} />
            {!!titolo && <Text style={s.titolo} numberOfLines={1}>{titolo}</Text>}
            {ordinate.map((v) => (
              <Pressable key={v.etichetta} style={[s.voce, v.disattiva && { opacity: 0.4 }]} disabled={v.disattiva} onPress={() => { setAperto(false); v.onPress(); }}>
                {!!v.icona && <Ionicons name={v.icona as never} size={20} color={v.distruttiva ? brand.colors.error : brand.colors.onSurface} />}
                <View style={{ flex: 1 }}>
                  <Text style={[s.voceTesto, v.distruttiva && { color: brand.colors.error }]}>{v.etichetta}</Text>
                  {!!v.sotto && <Text style={s.voceSotto}>{v.sotto}</Text>}
                </View>
              </Pressable>
            ))}
            <Pressable style={s.annulla} onPress={() => setAperto(false)}><Text style={s.annullaTesto}>Annulla</Text></Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  tasto: { width: 36, height: 36, borderRadius: 18, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  pillola: { minHeight: 44, borderRadius: 999, backgroundColor: brand.colors.brand, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  pillolaTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
  voceSotto: { color: brand.colors.muted, fontSize: 12, marginTop: 1 },
  sfondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end", padding: 12 },
  carta: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 8, gap: 2, maxWidth: 520, width: "100%", alignSelf: "center" },
  maniglia: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.22)", marginTop: 2, marginBottom: 4 },
  titolo: { color: brand.colors.muted, fontSize: 12, fontWeight: "600", textAlign: "center", paddingVertical: 8 },
  voce: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 10 },
  voceTesto: { color: brand.colors.onSurface, fontSize: 16 },
  annulla: { minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 4, borderTopWidth: 1, borderTopColor: brand.colors.border },
  annullaTesto: { color: brand.colors.brandSecondary, fontSize: 16, fontWeight: "600" },
});
