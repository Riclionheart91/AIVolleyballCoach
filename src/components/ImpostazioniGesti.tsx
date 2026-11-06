import { Pressable, StyleSheet, Text, View } from "react-native";
import { brand } from "@/src/config";
import { LISTE_GESTI, impostaGesto, useGestoRiga, type ListaGesti } from "@/src/lib/preferenzeGesti";

function RigaGesto({ lista, titolo, opzioni }: { lista: ListaGesti; titolo: string; opzioni: { id: string; etichetta: string }[] }) {
  const scelta = useGestoRiga(lista);
  return (
    <View style={s.riga}>
      <Text style={s.nome}>{titolo}</Text>
      <View style={s.opzioni}>
        {opzioni.map((o) => (
          <Pressable key={o.id} style={[s.chip, scelta === o.id && s.chipAttivo]} onPress={() => impostaGesto(lista, o.id as never)} accessibilityRole="button" accessibilityState={{ selected: scelta === o.id }}>
            <Text style={[s.chipTesto, scelta === o.id && s.chipTestoAttivo]}>{o.etichetta}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Sezione di Impostazioni: cosa fa lo scorrimento di lato sulle righe degli elenchi (di default spento). */
export function ImpostazioniGesti() {
  return (
    <View style={s.card}>
      <Text style={s.titolo}>Scorrimento di lato sulle righe</Text>
      <Text style={s.nota}>Scorrendo una riga verso sinistra compare un'azione rapida, come in Mail su iPhone. Per ogni elenco scegli cosa deve fare; di base è spento. Vale per questo dispositivo.</Text>
      {LISTE_GESTI.map((l) => <RigaGesto key={l.lista} lista={l.lista} titolo={l.titolo} opzioni={l.opzioni} />)}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 16, gap: 12 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  nota: { color: brand.colors.muted, fontSize: 13, lineHeight: 18 },
  riga: { gap: 8 },
  nome: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "600" },
  opzioni: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
});
