import { useRef, useState } from "react";
import { View, Text, Pressable, PanResponder, StyleSheet, type LayoutChangeEvent } from "react-native";
import { brand } from "@/src/config";
import type { Assegnazioni, Punto } from "@/src/lib/schemiGioco";

/** Un pallino sul campo: posizione in frazioni del campo (0-1), rete in alto. */
export interface Pallino {
  chiave: string;
  x: number;
  y: number;
  /** Testo dentro il pallino (numero di maglia o di posizione). */
  etichetta: string;
  /** Testo sotto il pallino (cognome). */
  sotto?: string;
  attivo?: boolean;
  /** Colore diverso, es. per il Libero o la palleggiatrice. */
  accento?: boolean;
}

function Sfondo() {
  return (
    <>
      <View pointerEvents="none" style={styles.rete}><Text style={styles.reteTesto}>RETE</Text></View>
      <View pointerEvents="none" style={styles.lineaAttacco} />
    </>
  );
}

function Disco({ p, lato, onPress }: { p: Pallino; lato: { w: number; h: number }; onPress?: () => void }) {
  const d = Math.max(30, Math.min(lato.w, lato.h) * 0.19);
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={{ position: "absolute", left: p.x * lato.w - d, top: p.y * lato.h - d / 2, width: d * 2, alignItems: "center" }}
    >
      <View style={[styles.pallino, { width: d, height: d, borderRadius: d / 2 }, p.accento && styles.pallinoAccento, p.attivo && styles.pallinoAttivo]}>
        <Text style={[styles.pallinoTesto, { fontSize: Math.max(11, d * 0.42) }, p.accento && !p.attivo && styles.pallinoTestoAccento]}>{p.etichetta}</Text>
      </View>
      {p.sotto ? <Text style={[styles.sotto, { fontSize: Math.max(9, d * 0.28) }]} numberOfLines={1}>{p.sotto}</Text> : null}
    </Pressable>
  );
}

/** Campo con i pallini: sola visualizzazione, ogni pallino si puo' toccare (scouting). */
export function CampoPallini({ pallini, onTapPallino }: { pallini: Pallino[]; onTapPallino?: (chiave: string) => void }) {
  const [lato, setLato] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => setLato({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  return (
    <View style={styles.campo} onLayout={onLayout}>
      <Sfondo />
      {lato.w > 0 && pallini.map((p) => <Disco key={p.chiave} p={p} lato={lato} onPress={onTapPallino ? () => onTapPallino(p.chiave) : undefined} />)}
    </View>
  );
}

const limita = (v: number) => Math.min(0.94, Math.max(0.06, v));

function PallinoTrascinabile({
  p, lato, onSposta, onTocco, onTrascina,
}: {
  p: Pallino;
  lato: { w: number; h: number };
  onSposta: (x: number, y: number) => void;
  onTocco: () => void;
  onTrascina?: (inCorso: boolean) => void;
}) {
  const stato = useRef({ p, lato, onSposta, onTocco, onTrascina });
  stato.current = { p, lato, onSposta, onTocco, onTrascina };
  const inizio = useRef({ x: 0, y: 0 });
  const mosso = useRef(false);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        inizio.current = { x: stato.current.p.x, y: stato.current.p.y };
        mosso.current = false;
        stato.current.onTrascina?.(true);
      },
      onPanResponderMove: (_e, g) => {
        if (!mosso.current && Math.abs(g.dx) + Math.abs(g.dy) > 5) mosso.current = true;
        if (!mosso.current) return;
        const { lato: l } = stato.current;
        if (l.w === 0 || l.h === 0) return;
        stato.current.onSposta(limita(inizio.current.x + g.dx / l.w), limita(inizio.current.y + g.dy / l.h));
      },
      onPanResponderRelease: () => {
        if (!mosso.current) stato.current.onTocco();
        stato.current.onTrascina?.(false);
      },
      onPanResponderTerminate: () => stato.current.onTrascina?.(false),
    }),
  ).current;

  const d = Math.max(30, Math.min(lato.w, lato.h) * 0.19);
  return (
    <View
      {...pan.panHandlers}
      style={[{ position: "absolute", left: p.x * lato.w - d / 2, top: p.y * lato.h - d / 2, width: d, height: d }, { touchAction: "none" } as any]}
    >
      <View style={[styles.pallino, { width: d, height: d, borderRadius: d / 2 }, p.accento && styles.pallinoAccento, p.attivo && styles.pallinoAttivo]}>
        <Text style={[styles.pallinoTesto, { fontSize: Math.max(11, d * 0.42) }, p.accento && !p.attivo && styles.pallinoTestoAccento]}>{p.etichetta}</Text>
      </View>
    </View>
  );
}

/**
 * Campo per disegnare uno schema: i pallini si trascinano col dito, oppure
 * si tocca un pallino e poi il punto del campo dove metterlo.
 */
export function CampoSchemaEditor({
  posizioni, slotPalleggio, selezionato, onSeleziona, onSposta, onTrascina,
}: {
  posizioni: Assegnazioni;
  slotPalleggio: number;
  selezionato: number | null;
  onSeleziona: (slot: number | null) => void;
  onSposta: (slot: number, punto: Punto) => void;
  onTrascina?: (inCorso: boolean) => void;
}) {
  const [lato, setLato] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => setLato({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  return (
    <Pressable
      style={styles.campoEditor}
      onLayout={onLayout}
      onPress={(e) => {
        if (selezionato === null || lato.w === 0) return;
        const { locationX, locationY } = e.nativeEvent;
        onSposta(selezionato, { x: limita(locationX / lato.w), y: limita(locationY / lato.h) });
      }}
    >
      <Sfondo />
      {lato.w > 0 && [1, 2, 3, 4, 5, 6].map((slot) => {
        const pt = posizioni[String(slot)];
        return (
          <PallinoTrascinabile
            key={slot}
            lato={lato}
            p={{ chiave: String(slot), x: pt.x, y: pt.y, etichetta: slot === slotPalleggio ? `${slot}·P` : String(slot), attivo: selezionato === slot, accento: slot === slotPalleggio }}
            onSposta={(x, y) => onSposta(slot, { x, y })}
            onTocco={() => onSeleziona(selezionato === slot ? null : slot)}
            onTrascina={onTrascina}
          />
        );
      })}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  campo: { flex: 1, width: "100%", backgroundColor: "#1a3a2a", borderRadius: 12, borderWidth: 2, borderColor: brand.colors.brand, overflow: "hidden", position: "relative" },
  campoEditor: { width: "100%", aspectRatio: 1, maxWidth: 440, alignSelf: "center", backgroundColor: "#1a3a2a", borderRadius: 12, borderWidth: 2, borderColor: brand.colors.brand, overflow: "hidden", position: "relative" },
  rete: { position: "absolute", top: 0, left: 0, right: 0, height: 16, alignItems: "center", justifyContent: "center", borderBottomWidth: 3, borderBottomColor: "#fff" },
  reteTesto: { color: "#fff", fontSize: 9, fontWeight: "700", letterSpacing: 2 },
  lineaAttacco: { position: "absolute", top: "33%", left: 0, right: 0, height: 1, backgroundColor: "rgba(255,255,255,0.35)" },
  pallino: { backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  pallinoAccento: { backgroundColor: brand.colors.brandSecondary, borderColor: brand.colors.brandSecondary },
  pallinoAttivo: { backgroundColor: brand.colors.brand, borderColor: "#fff", borderWidth: 3 },
  pallinoTesto: { color: "#111", fontWeight: "800" },
  pallinoTestoAccento: { color: "#000" },
  sotto: { color: "#fff", fontWeight: "600", marginTop: 1, textAlign: "center" },
});
