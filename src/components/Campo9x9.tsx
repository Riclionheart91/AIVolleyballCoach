import { View, Text, Pressable, StyleSheet } from "react-native";
import { brand } from "@/src/config";

export interface OccupanteCampo {
  posizione: number; // 1-6
  cognome: string;
  numeroMaglia: number | null;
  attivo?: boolean; // evidenziata (es. selezionata per cambio/evento)
}

interface Props {
  occupanti: OccupanteCampo[];
  onTapPosizione?: (posizione: number) => void;
  /** Se true, le posizioni vuote sono comunque tappabili (usato in fase di composizione formazione). */
  consentiPosizioniVuote?: boolean;
}

// Disposizione reale del campo: rete in alto. Fila avanti (4-3-2) vicino
// alla rete, fila difesa (5-6-1) in fondo — la posizione 1 è anche la
// zona di battuta (Art. 7.3-7.4 del regolamento).
const GRIGLIA: number[][] = [
  [4, 3, 2], // fila avanti, vicino alla rete
  [5, 6, 1], // fila difesa — 1 è la zona di battuta
];

export function Campo9x9({ occupanti, onTapPosizione, consentiPosizioniVuote }: Props) {
  const mappa = Object.fromEntries(occupanti.map((o) => [o.posizione, o]));

  return (
    <View style={styles.contenitore}>
      <View style={styles.rete}><Text style={styles.reteTesto}>RETE</Text></View>
      {GRIGLIA.map((riga, i) => (
        <View key={i} style={styles.riga}>
          {riga.map((pos) => {
            const occupante = mappa[pos];
            const tappabile = !!onTapPosizione && (!!occupante || !!consentiPosizioniVuote);
            return (
              <Pressable
                key={pos}
                disabled={!tappabile}
                onPress={() => onTapPosizione?.(pos)}
                style={[styles.cella, occupante?.attivo && styles.cellaAttiva, !occupante && styles.cellaVuota]}
              >
                <Text style={styles.numeroPosizione}>{pos}</Text>
                {occupante ? (
                  <>
                    <Text style={styles.numeroMaglia}>{occupante.numeroMaglia ?? "–"}</Text>
                    <Text style={styles.cognome} numberOfLines={1}>{occupante.cognome}</Text>
                  </>
                ) : (
                  <Text style={styles.vuotaTesto}>vuota</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  contenitore: { backgroundColor: "#1a3a2a", borderRadius: 12, padding: 12, gap: 8, borderWidth: 2, borderColor: brand.colors.brand },
  rete: { alignItems: "center", borderBottomWidth: 3, borderBottomColor: "#fff", paddingBottom: 4, marginBottom: 4 },
  reteTesto: { color: "#fff", fontSize: 10, fontWeight: "700", letterSpacing: 2 },
  riga: { flexDirection: "row", gap: 8 },
  cella: { flex: 1, aspectRatio: 1, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  cellaVuota: { backgroundColor: "rgba(255,255,255,0.03)", borderStyle: "dashed" },
  cellaAttiva: { backgroundColor: brand.colors.brand, borderColor: brand.colors.brand },
  numeroPosizione: { position: "absolute", top: 3, left: 5, color: "rgba(255,255,255,0.5)", fontSize: 9, fontWeight: "700" },
  numeroMaglia: { color: "#fff", fontSize: 20, fontWeight: "800" },
  cognome: { color: "#fff", fontSize: 10, maxWidth: "90%" },
  vuotaTesto: { color: "rgba(255,255,255,0.4)", fontSize: 11 },
});
