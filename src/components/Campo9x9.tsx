import { View, Text, Pressable, StyleSheet } from "react-native";
import { brand } from "@/src/config";

export interface OccupanteCampo {
  posizione: number; // 1-6
  cognome: string;
  numeroMaglia: number | null;
  ruolo?: string | null;
  attivo?: boolean; // evidenziata (es. selezionata per cambio/evento)
}

interface Props {
  occupanti: OccupanteCampo[];
  onTapPosizione?: (posizione: number) => void;
  /** Se presente, mostra una "✕" su ogni casella occupata per rimuoverla singolarmente. */
  onRimuoviPosizione?: (posizione: number) => void;
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

export function Campo9x9({ occupanti, onTapPosizione, onRimuoviPosizione, consentiPosizioniVuote }: Props) {
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
                {occupante && onRimuoviPosizione && (
                  <Pressable
                    hitSlop={8}
                    onPress={(e) => { e.stopPropagation?.(); onRimuoviPosizione(pos); }}
                    style={styles.bottoneRimuoviPosizione}
                  >
                    <Text style={styles.bottoneRimuoviPosizioneTesto}>✕</Text>
                  </Pressable>
                )}
                {occupante ? (
                  <>
                    <Text style={styles.numeroMaglia}>{occupante.numeroMaglia ?? "–"}</Text>
                    <Text style={styles.cognome} numberOfLines={1}>{occupante.cognome}</Text>
                    {occupante.ruolo ? <Text style={styles.ruolo} numberOfLines={1}>{occupante.ruolo}</Text> : null}
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
  contenitore: { backgroundColor: "#1a3a2a", borderRadius: 12, padding: 8, gap: 6, borderWidth: 2, borderColor: brand.colors.brand },
  rete: { alignItems: "center", borderBottomWidth: 3, borderBottomColor: "#fff", paddingBottom: 2, marginBottom: 2 },
  reteTesto: { color: "#fff", fontSize: 9, fontWeight: "700", letterSpacing: 2 },
  riga: { flexDirection: "row", gap: 6 },
  // Niente più aspectRatio: 1 (rendeva il campo troppo grande e
  // quadrato). Altezza fissa contenuta, più larga che alta — sta
  // tutto in una schermata anche su telefono senza scroll.
  cella: { flex: 1, height: 64, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  cellaVuota: { backgroundColor: "rgba(255,255,255,0.03)", borderStyle: "dashed" },
  cellaAttiva: { backgroundColor: brand.colors.brand, borderColor: brand.colors.brand },
  numeroPosizione: { position: "absolute", top: 2, left: 4, color: "rgba(255,255,255,0.5)", fontSize: 8, fontWeight: "700" },
  bottoneRimuoviPosizione: { position: "absolute", top: 2, right: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", zIndex: 2 },
  bottoneRimuoviPosizioneTesto: { color: "#fff", fontSize: 10, fontWeight: "800", lineHeight: 12 },
  numeroMaglia: { color: "#fff", fontSize: 16, fontWeight: "800", lineHeight: 18 },
  cognome: { color: "#fff", fontSize: 9, maxWidth: "90%" },
  ruolo: { color: "rgba(255,255,255,0.6)", fontSize: 7, maxWidth: "90%" },
  vuotaTesto: { color: "rgba(255,255,255,0.4)", fontSize: 10 },
});
