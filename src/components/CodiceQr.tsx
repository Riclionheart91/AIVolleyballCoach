import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { matriceQr } from "@/src/lib/qr";

/** QR code disegnato in locale (nessun servizio esterno): fondo bianco con il bordo richiesto per essere letto. */
export function CodiceQr({ testo, dimensione = 220 }: { testo: string; dimensione?: number }) {
  const matrice = useMemo(() => matriceQr(testo), [testo]);
  const bordo = 4;
  const n = matrice.length + bordo * 2;
  return (
    <View style={{ width: dimensione, height: dimensione, backgroundColor: "#fff", alignSelf: "center" }}>
      <Svg width={dimensione} height={dimensione} viewBox={`0 0 ${n} ${n}`}>
        <Rect x={0} y={0} width={n} height={n} fill="#fff" />
        {matrice.flatMap((riga, r) => riga.map((scuro, c) => (scuro ? <Rect key={`${r}-${c}`} x={c + bordo} y={r + bordo} width={1.02} height={1.02} fill="#000" /> : null)))}
      </Svg>
    </View>
  );
}
