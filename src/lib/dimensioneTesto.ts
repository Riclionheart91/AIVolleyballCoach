import { Platform, StyleSheet, Text, TextInput } from "react-native";

/**
 * Dimensione del testo (solo web): l'app usa dimensioni in pixel, che il telefono non ingrandisce da solo.
 * Qui si calcola un fattore e lo si applica a tutti i testi:
 *  - automatico: parte da una base leggermente ridotta (0,9) e la moltiplica per la dimensione del testo scelta
 *    nelle impostazioni del telefono (iPhone/iPad: Dimensione testo; Android/Chrome: Dimensione carattere);
 *  - manuale: Piccolo / Medio / Grande / Molto grande, scelto in Impostazioni e ricordato su questo dispositivo.
 */
export type ScelteDimensioneTesto = "auto" | "piccolo" | "medio" | "grande" | "moltoGrande";

export const etichetteDimensioneTesto: Record<ScelteDimensioneTesto, string> = {
  auto: "Automatica (segue il telefono)",
  piccolo: "Piccolo",
  medio: "Medio",
  grande: "Grande",
  moltoGrande: "Molto grande",
};

const CHIAVE = "dimensioneTesto";
const BASE_AUTOMATICA = 0.9;
const FATTORI: Record<Exclude<ScelteDimensioneTesto, "auto">, number> = { piccolo: 0.82, medio: 0.9, grande: 1.0, moltoGrande: 1.15 };

export function leggiScelta(): ScelteDimensioneTesto {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(CHIAVE) : null;
    if (v === "piccolo" || v === "medio" || v === "grande" || v === "moltoGrande") return v;
  } catch { /* archivio non disponibile: resta automatica */ }
  return "auto";
}

export function salvaScelta(scelta: ScelteDimensioneTesto) {
  try { localStorage.setItem(CHIAVE, scelta); } catch { /* ignora */ }
}

/** Dimensione del testo impostata sul telefono, come rapporto (1 = standard). */
function scalaDelTelefono(): number {
  try {
    const prova = document.createElement("div");
    const apple = typeof CSS !== "undefined" && CSS.supports?.("font", "-apple-system-body");
    // iPhone/iPad: il carattere di sistema "body" segue la dimensione scelta dall'utente (standard = 17 px).
    prova.style.cssText = apple ? "position:absolute;visibility:hidden;font:-apple-system-body" : "position:absolute;visibility:hidden;font-size:1rem";
    document.body.appendChild(prova);
    const px = parseFloat(getComputedStyle(prova).fontSize);
    document.body.removeChild(prova);
    if (!isFinite(px) || px <= 0) return 1;
    return Math.min(1.5, Math.max(0.85, px / (apple ? 17 : 16)));
  } catch { return 1; }
}

export function fattoreTesto(): number {
  const scelta = leggiScelta();
  return scelta === "auto" ? BASE_AUTOMATICA * scalaDelTelefono() : FATTORI[scelta];
}

let applicata = false;

/** Da chiamare una sola volta all'avvio (app/_layout.tsx). */
export function applicaDimensioneTesto() {
  if (Platform.OS !== "web" || typeof document === "undefined" || applicata) return;
  applicata = true;
  const k = fattoreTesto();
  if (Math.abs(k - 1) < 0.01) return;
  for (const Componente of [Text, TextInput] as unknown as { render?: (props: any, ref: any) => unknown }[]) {
    const originale = Componente.render;
    if (typeof originale !== "function") continue;
    Componente.render = function (props: any, ref: any) {
      const s = StyleSheet.flatten(props?.style) as { fontSize?: number; lineHeight?: number; fontFamily?: string } | undefined;
      // Le icone sono caratteri di un font speciale: non vanno rimpicciolite.
      if (s && typeof s.fontSize === "number" && !(s.fontFamily && /icon/i.test(String(s.fontFamily)))) {
        const extra: { fontSize: number; lineHeight?: number } = { fontSize: s.fontSize * k };
        if (typeof s.lineHeight === "number") extra.lineHeight = s.lineHeight * k;
        props = { ...props, style: [props.style, extra] };
      }
      return originale.call(this, props, ref);
    };
  }
}
