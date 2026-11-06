import { useRef, useState, type ReactNode } from "react";
import { PanResponder, Text, View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { brand } from "@/src/config";

/**
 * Barra delle schede in basso (solo telefono) con scorrimento del dito:
 * come l'indice A–Z della Rosa, si può appoggiare il dito su una voce e
 * trascinarlo da una voce all'altra; la schermata cambia mentre si scorre e
 * la voce sotto il dito è in evidenza (pillola + colore arancione).
 *
 * Si usa come `tabBar` di <Tabs>: riceve `state`, `descriptors`, `navigation`.
 * `nomi` è l'elenco (in ordine) delle rotte da mostrare.
 */
type Props = {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options: { title?: string; tabBarIcon?: (p: { color: string; size: number; focused: boolean }) => ReactNode } }>;
  navigation: { navigate: (nome: string) => void };
  nomi: string[];
};

export default function BarraTabScorrevole({ state, descriptors, navigation, nomi }: Props) {
  const insets = useSafeAreaInsets();
  const rotte = nomi.map((n) => state.routes.find((r) => r.name === n)).filter((r): r is { key: string; name: string } => !!r);
  const [sotto, setSotto] = useState<string | null>(null); // voce sotto il dito durante il trascinamento

  // Il PanResponder è creato una volta sola: legge sempre i valori correnti dai ref.
  const rotteRef = useRef(rotte);
  rotteRef.current = rotte;
  const navRef = useRef(navigation);
  navRef.current = navigation;
  const contenitore = useRef<View>(null);
  const finestra = useRef({ left: 0, larghezza: 1 });
  const corrente = useRef<string | null>(null);

  function selezionaDaX(x: number) {
    const lista = rotteRef.current;
    if (lista.length === 0) return;
    const { left, larghezza } = finestra.current;
    const i = Math.max(0, Math.min(lista.length - 1, Math.floor(((x - left) / Math.max(1, larghezza)) * lista.length)));
    const nome = lista[i].name;
    if (nome === corrente.current) return;
    corrente.current = nome;
    setSotto(nome);
    try { Haptics.selectionAsync().catch(() => { /* non supportato */ }); } catch { /* non supportato */ }
    navRef.current.navigate(nome);
  }

  const gesto = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        const x = evt.nativeEvent.pageX;
        corrente.current = null;
        const nodo = contenitore.current;
        if (!nodo) return;
        nodo.measureInWindow((left, _top, larghezza) => {
          finestra.current = { left, larghezza };
          selezionaDaX(x);
        });
      },
      onPanResponderMove: (_evt, g) => selezionaDaX(g.moveX),
      onPanResponderRelease: () => { corrente.current = null; setSotto(null); },
      onPanResponderTerminate: () => { corrente.current = null; setSotto(null); },
    }),
  ).current;

  const attiva = state.routes[state.index]?.name;
  const evidenziata = sotto ?? attiva;

  return (
    <View
      style={[styles.barra, { paddingBottom: Math.max(insets.bottom, 6) }, WEB_BARRA as object]}
      accessibilityRole="tablist"
    >
      <View ref={contenitore} style={[styles.riga, { touchAction: "none", userSelect: "none" } as object]} {...gesto.panHandlers}>
        {rotte.map((r) => {
          const opzioni = descriptors[r.key]?.options ?? {};
          const acceso = r.name === evidenziata;
          const colore = acceso ? brand.colors.brand : brand.colors.muted;
          return (
            <View
              key={r.key}
              style={styles.voce}
              pointerEvents="none"
              accessibilityRole="tab"
              accessibilityState={{ selected: r.name === attiva }}
              accessibilityLabel={opzioni.title ?? r.name}
            >
              <View style={[styles.pillola, acceso && styles.pillolaAccesa, acceso && sotto !== null && styles.pillolaTrascinata]}>
                {opzioni.tabBarIcon?.({ color: colore, size: 24, focused: acceso })}
                <Text style={[styles.etichetta, { color: colore }, acceso && styles.etichettaAccesa]} numberOfLines={1}>
                  {opzioni.title ?? r.name}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// Barra translucida sfocata (stile Apple Music); sul web vale il filtro, altrove resta il fondo scuro.
const WEB_BARRA = { backdropFilter: "blur(28px) saturate(170%)", WebkitBackdropFilter: "blur(28px) saturate(170%)" };

const styles = StyleSheet.create({
  barra: {
    backgroundColor: "rgba(11,18,32,0.78)",
    borderTopColor: "rgba(255,255,255,0.08)",
    borderTopWidth: 1,
    paddingTop: 6,
    paddingHorizontal: 4,
  },
  riga: { flexDirection: "row" },
  voce: { flex: 1, alignItems: "center" },
  pillola: { alignItems: "center", justifyContent: "center", paddingVertical: 4, paddingHorizontal: 6, borderRadius: 14, minWidth: 58, gap: 1 },
  pillolaAccesa: { backgroundColor: "rgba(255,122,0,0.16)" },
  pillolaTrascinata: { backgroundColor: "rgba(255,122,0,0.30)", transform: [{ scale: 1.06 }] },
  etichetta: { fontSize: 10, fontWeight: "500" },
  etichettaAccesa: { fontWeight: "700" },
});
