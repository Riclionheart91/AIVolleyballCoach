import { View, Text, StyleSheet } from "react-native";
import { brand } from "@/src/config";
import type { PuntoAndamento } from "@/src/lib/andamentoPunti";

export interface MarcatoreTimeout {
  /** Quanti punti erano stati giocati quando e' stato chiamato (0 = prima del primo punto). */
  dopoPunti: number;
  squadra: "noi" | "avversario";
}

const ALTEZZA = 110;

/**
 * Differenza punti (noi meno loro) dopo ogni punto del set: barre verso l'alto
 * quando siamo avanti, verso il basso quando siamo dietro. Le serie si
 * leggono a colpo d'occhio come blocchi di barre consecutive. Le righe
 * verticali segnano i time-out (azzurro = nostro, giallo = loro).
 * Costruito con semplici View: nessuna libreria grafica.
 */
export function GraficoAndamentoSet({ punti, timeouts }: { punti: PuntoAndamento[]; timeouts: MarcatoreTimeout[] }) {
  if (punti.length === 0) return <Text style={styles.vuoto}>Nessun punto registrato in questo set.</Text>;

  const diffs = punti.map((p) => p.noi - p.avv);
  const massimo = Math.max(3, ...diffs.map((d) => Math.abs(d)));
  const meta = ALTEZZA / 2;
  const unita = (meta - 4) / massimo;
  const marcatori = new Map<number, "noi" | "avversario">();
  for (const t of timeouts) marcatori.set(Math.min(Math.max(t.dopoPunti, 1), punti.length), t.squadra);

  return (
    <View>
      <View style={[styles.area, { height: ALTEZZA }]}>
        <View style={[styles.lineaZero, { top: meta }]} />
        {punti.map((p, i) => {
          const d = diffs[i];
          const alt = Math.max(2, Math.abs(d) * unita);
          const marc = marcatori.get(i + 1);
          return (
            <View key={i} style={styles.colonna}>
              {d !== 0 && (
                <View
                  style={[
                    styles.barra,
                    d > 0
                      ? { bottom: meta, height: alt, backgroundColor: brand.colors.success }
                      : { top: meta, height: alt, backgroundColor: brand.colors.error },
                  ]}
                />
              )}
              {marc && <View style={[styles.lineaTimeout, { backgroundColor: marc === "noi" ? brand.colors.brandSecondary : brand.colors.warning }]} />}
            </View>
          );
        })}
      </View>
      <View style={styles.legenda}>
        <Text style={styles.legendaTesto}>▲ avanti noi · ▼ avanti loro · tra i punti 1 e {punti.length}</Text>
        {timeouts.length > 0 && <Text style={styles.legendaTesto}>Righe: time-out (azzurro noi, giallo loro)</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  area: { flexDirection: "row", backgroundColor: brand.colors.surfaceSecondary, borderRadius: 8, overflow: "hidden", position: "relative" },
  lineaZero: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: brand.colors.border },
  colonna: { flex: 1, height: "100%", position: "relative", paddingHorizontal: 0.5 },
  barra: { position: "absolute", left: 0.5, right: 0.5, borderRadius: 1 },
  lineaTimeout: { position: "absolute", top: 0, bottom: 0, left: "40%", width: 2 },
  vuoto: { color: brand.colors.muted, fontSize: 12, paddingVertical: 6 },
  legenda: { marginTop: 4, gap: 1 },
  legendaTesto: { color: brand.colors.muted, fontSize: 10 },
});
