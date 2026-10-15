import { View, Text, Pressable, StyleSheet } from "react-native";
import { brand } from "@/src/config";

/**
 * Le 6 zone del campo AVVERSARIO, disposte come le vede chi scouta dalla
 * nostra parte: rete in basso, fondo campo in alto. Quindi:
 *     1 6 5   (seconda linea, in alto)
 *     2 3 4   (prima linea, vicino alla rete)
 * Le zone sono quelle dell'avversario (la sua zona 4 e' la sua sinistra in
 * prima linea, che da qui si vede sulla destra).
 */
const RIGHE: number[][] = [
  [1, 6, 5],
  [2, 3, 4],
];

/** Scelta della zona in cui e' caduta la palla (un tocco). */
export function SelettoreZona({ altezzaRiga = 44, onScegli }: { altezzaRiga?: number; onScegli: (zona: number) => void }) {
  return (
    <View>
      <View style={styles.campo}>
        {RIGHE.map((riga, i) => (
          <View key={i} style={styles.riga}>
            {riga.map((z) => (
              <Pressable key={z} style={[styles.cella, { height: altezzaRiga }]} onPress={() => onScegli(z)}>
                <Text style={styles.numero}>{z}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
      <Text style={styles.rete}>━━━ rete ━━━</Text>
    </View>
  );
}

export interface ValoreZona {
  azioni: number;
  punti: number;
  errori: number;
}

function coloreEfficienza(v: number | null): string {
  if (v === null) return brand.colors.muted;
  if (v >= 0.3) return brand.colors.success;
  if (v >= 0) return brand.colors.brand;
  if (v >= -0.3) return brand.colors.warning;
  return brand.colors.error;
}

/** Report: le stesse 6 zone, con quante azioni, punti ed errori e l'efficienza di ciascuna. */
export function GrigliaZone({ valori }: { valori: Record<number, ValoreZona> }) {
  const totale = Object.values(valori).reduce((s, v) => s + v.azioni, 0);
  return (
    <View>
      <View style={styles.campo}>
        {RIGHE.map((riga, i) => (
          <View key={i} style={styles.riga}>
            {riga.map((z) => {
              const v = valori[z];
              const eff = v && v.azioni > 0 ? (v.punti - v.errori) / v.azioni : null;
              const quota = v && totale > 0 ? Math.round((v.azioni / totale) * 100) : 0;
              return (
                <View key={z} style={[styles.cella, styles.cellaReport, v ? { borderColor: coloreEfficienza(eff) } : null]}>
                  <Text style={styles.numeroPiccolo}>{z}</Text>
                  {v ? (
                    <>
                      <Text style={styles.valoreGrande}>{v.azioni}</Text>
                      <Text style={styles.valorePiccolo}>{quota}% · {v.punti}+/{v.errori}-</Text>
                      <Text style={[styles.valorePiccolo, { color: coloreEfficienza(eff), fontWeight: "800" }]}>
                        {eff === null ? "—" : (eff >= 0 ? "+" : "") + eff.toFixed(2)}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.valorePiccolo}>—</Text>
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </View>
      <Text style={styles.rete}>━━━ rete ━━━</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  campo: { gap: 4 },
  riga: { flexDirection: "row", gap: 4 },
  cella: { flex: 1, backgroundColor: brand.colors.surfaceTertiary, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: brand.colors.border },
  cellaReport: { paddingVertical: 8, minHeight: 78, gap: 1 },
  numero: { color: brand.colors.onSurface, fontSize: 20, fontWeight: "800" },
  numeroPiccolo: { color: brand.colors.muted, fontSize: 10, fontWeight: "700" },
  valoreGrande: { color: brand.colors.onSurface, fontSize: 18, fontWeight: "800" },
  valorePiccolo: { color: brand.colors.onSurfaceSecondary, fontSize: 10 },
  rete: { color: brand.colors.muted, fontSize: 10, textAlign: "center", marginTop: 4 },
});
