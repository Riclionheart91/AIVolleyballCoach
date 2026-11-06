import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Animated, Platform, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { brand } from "@/src/config";

/** Altezza della barra con il titolo piccolo che compare scorrendo (le parti fisse si appoggiano sotto). */
export const ALTEZZA_TITOLO_COMPATTO = 40;

/** Stile (solo web) per un blocco che resta fissato sotto il titolo piccolo mentre si scorre: ricerca, filtri. */
export const stileFisso = (Platform.OS === "web"
  ? { position: "sticky", top: ALTEZZA_TITOLO_COMPATTO, zIndex: 6, backgroundColor: "rgba(11,18,32,0.92)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }
  : { backgroundColor: brand.colors.surface }) as object;

const SOGLIA = 64;
const MASSIMO = 110;

/**
 * Comportamento da app iPhone per una lista:
 *  - `scrollY`: posizione dello scorrimento (per il titolo piccolo che compare);
 *  - `propsLista`: da passare a ScrollView/FlatList/SectionList (traccia lo scorrimento e il "tira per aggiornare");
 *  - `indicatore`: da mettere nella schermata (sopra la lista), mostra la rotellina mentre si tira.
 * Il "tira per aggiornare" parte solo dalla cima della lista, con un tiro verso il basso di circa 64 px.
 */
export function useScorrimentoIOS(aggiorna?: () => unknown) {
  const scrollY = useRef(new Animated.Value(0)).current;
  const offset = useRef(0);
  const partenza = useRef<number | null>(null);
  const tiroRef = useRef(0);
  const [tiro, setTiro] = useState(0);
  const [aggiornando, setAggiornando] = useState(false);
  const aggiornaRef = useRef(aggiorna);
  aggiornaRef.current = aggiorna;
  const inCorso = useRef(false);

  const impostaTiro = (v: number) => { tiroRef.current = v; setTiro(v); };

  const onScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y;
    offset.current = y;
    scrollY.setValue(y);
  }, [scrollY]);

  const posizioneY = (e: { nativeEvent: { touches?: { pageY: number }[]; pageY?: number } }) => e.nativeEvent.touches?.[0]?.pageY ?? e.nativeEvent.pageY ?? 0;

  const onTouchStart = (e: never) => { partenza.current = aggiornaRef.current && offset.current <= 0 && !inCorso.current ? posizioneY(e) : null; };
  const onTouchMove = (e: never) => {
    if (partenza.current === null) return;
    if (offset.current > 0) { partenza.current = null; impostaTiro(0); return; }
    const dy = posizioneY(e) - partenza.current;
    impostaTiro(dy > 0 ? Math.min(MASSIMO, dy * 0.45) : 0);
  };
  const onTouchEnd = () => {
    const fatto = tiroRef.current >= SOGLIA * 0.7;
    partenza.current = null;
    if (!fatto || inCorso.current) { impostaTiro(0); return; }
    inCorso.current = true;
    setAggiornando(true);
    impostaTiro(0);
    const inizio = Date.now();
    Promise.resolve()
      .then(() => aggiornaRef.current?.())
      .catch(() => { /* l'errore lo mostra la schermata */ })
      .then(() => new Promise((r) => setTimeout(r, Math.max(0, 600 - (Date.now() - inizio)))))
      .then(() => { inCorso.current = false; setAggiornando(false); });
  };

  const propsLista = {
    onScroll,
    scrollEventThrottle: 16,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: onTouchEnd,
  } as object;

  const visibile = aggiornando || tiro > 4;
  const indicatore = visibile ? (
    <View pointerEvents="none" style={[s.indicatore, { transform: [{ translateY: aggiornando ? 12 : Math.min(tiro, 70) * 0.7 }], opacity: aggiornando ? 1 : Math.min(1, tiro / 40) }]}>
      {aggiornando
        ? <ActivityIndicator color={brand.colors.brand} />
        : <Ionicons name="arrow-down" size={18} color={brand.colors.brand} style={{ transform: [{ rotate: tiro >= SOGLIA * 0.7 ? "180deg" : "0deg" }] }} />}
    </View>
  ) : null;

  return { scrollY, propsLista, indicatore };
}

/** Titolo piccolo al centro che compare (con sfondo sfocato) quando il titolo grande esce dallo schermo. */
export function TitoloCompatto({ titolo, scrollY }: { titolo: string; scrollY: Animated.Value }) {
  const opacita = scrollY.interpolate({ inputRange: [24, 58], outputRange: [0, 1], extrapolate: "clamp" });
  return (
    <Animated.View pointerEvents="none" style={[s.compatto, { opacity: opacita }]}>
      <Animated.Text numberOfLines={1} style={s.compattoTesto}>{titolo}</Animated.Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  indicatore: { position: "absolute", top: 6, alignSelf: "center", zIndex: 30, width: 36, height: 36, borderRadius: 18, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  compatto: {
    position: "absolute", top: 0, left: 0, right: 0, height: ALTEZZA_TITOLO_COMPATTO, zIndex: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(11,18,32,0.78)", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.14)",
    ...(Platform.OS === "web" ? ({ backdropFilter: "blur(24px) saturate(170%)", WebkitBackdropFilter: "blur(24px) saturate(170%)" } as object) : null),
  },
  compattoTesto: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "600" },
});
