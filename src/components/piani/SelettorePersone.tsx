import { View, Text, Pressable, StyleSheet } from "react-native";
import { brand } from "@/src/config";
import type { Athlete } from "@/src/types/database";

/** Sceglie un gruppo di persone: a una a una, oppure tutte / per ruolo in campo con un tocco. */
export function SelettorePersone({ atlete, selezionate, onChange }: { atlete: Athlete[]; selezionate: Set<string>; onChange: (s: Set<string>) => void }) {
  const ruoli = Array.from(new Set(atlete.map((a) => a.ruolo_campo).filter((r): r is NonNullable<Athlete["ruolo_campo"]> => !!r)));
  const tutteSelezionate = (ids: string[]) => ids.length > 0 && ids.every((id) => selezionate.has(id));

  function alterna(ids: string[]) {
    const nuovo = new Set(selezionate);
    if (tutteSelezionate(ids)) ids.forEach((id) => nuovo.delete(id));
    else ids.forEach((id) => nuovo.add(id));
    onChange(nuovo);
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.riga}>
        <Pressable style={[styles.chip, tutteSelezionate(atlete.map((a) => a.id)) && styles.chipAttivo]} onPress={() => alterna(atlete.map((a) => a.id))}>
          <Text style={[styles.chipTesto, tutteSelezionate(atlete.map((a) => a.id)) && styles.chipTestoAttivo]}>Tutte ({atlete.length})</Text>
        </Pressable>
        {ruoli.map((r) => {
          const ids = atlete.filter((a) => a.ruolo_campo === r).map((a) => a.id);
          const attivo = tutteSelezionate(ids);
          return (
            <Pressable key={r} style={[styles.chip, attivo && styles.chipAttivo]} onPress={() => alterna(ids)}>
              <Text style={[styles.chipTesto, attivo && styles.chipTestoAttivo]}>{r} ({ids.length})</Text>
            </Pressable>
          );
        })}
        {selezionate.size > 0 && (
          <Pressable style={styles.chip} onPress={() => onChange(new Set())}><Text style={styles.chipTesto}>Nessuna</Text></Pressable>
        )}
      </View>
      {atlete.map((a) => {
        const attiva = selezionate.has(a.id);
        return (
          <Pressable key={a.id} style={styles.persona} onPress={() => alterna([a.id])}>
            <View style={[styles.casella, attiva && styles.casellaAttiva]}>{attiva && <Text style={styles.segno}>✓</Text>}</View>
            <Text style={styles.nome}>{a.nome} {a.cognome}</Text>
            {!!a.ruolo_campo && <Text style={styles.ruolo}>{a.ruolo_campo}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  riga: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  persona: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  casella: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: brand.colors.brand, alignItems: "center", justifyContent: "center" },
  casellaAttiva: { backgroundColor: brand.colors.brand },
  segno: { color: "#000", fontWeight: "800", fontSize: 13 },
  nome: { color: brand.colors.onSurface, fontSize: 14, flex: 1 },
  ruolo: { color: brand.colors.muted, fontSize: 11 },
});
