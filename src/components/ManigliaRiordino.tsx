import { useRef, useState } from "react";
import { PanResponder, Platform, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { brand } from "@/src/config";

/**
 * Maniglia "≡" per riordinare trascinando: ogni `passo` pixel di trascinamento la riga scavalca la vicina.
 * `sposta(indice, direzione)` esegue lo scambio e restituisce il nuovo indice della riga (o null se non si puo' muovere).
 */
export function ManigliaRiordino({ indice, sposta, passo = 58 }: { indice: number; sposta: (indice: number, direzione: -1 | 1) => number | null; passo?: number }) {
  const [attiva, setAttiva] = useState(false);
  const corrente = useRef(indice);
  const consumato = useRef(0);
  const indiceProp = useRef(indice);
  indiceProp.current = indice;
  const spostaRef = useRef(sposta);
  spostaRef.current = sposta;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { corrente.current = indiceProp.current; consumato.current = 0; setAttiva(true); },
      onPanResponderMove: (_e, g) => {
        for (let giri = 0; giri < 6; giri++) {
          const scarto = g.dy - consumato.current;
          if (Math.abs(scarto) <= passo) break;
          const direzione: -1 | 1 = scarto > 0 ? 1 : -1;
          const nuovo = spostaRef.current(corrente.current, direzione);
          if (nuovo === null) { consumato.current = g.dy; break; }
          corrente.current = nuovo;
          consumato.current += direzione * passo;
        }
      },
      onPanResponderRelease: () => setAttiva(false),
      onPanResponderTerminate: () => setAttiva(false),
    }),
  ).current;

  return (
    <View
      {...pan.panHandlers}
      style={[s.maniglia, attiva && s.attiva, Platform.OS === "web" ? ({ touchAction: "none", cursor: "grab" } as object) : null]}
      accessibilityLabel="Trascina per cambiare l'ordine"
      accessibilityRole="adjustable"
    >
      <Ionicons name="reorder-three" size={24} color={attiva ? brand.colors.brand : brand.colors.muted} />
    </View>
  );
}

const s = StyleSheet.create({
  maniglia: { width: 36, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 10, marginLeft: -6 },
  attiva: { backgroundColor: "rgba(255,122,0,0.16)" },
});
