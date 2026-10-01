import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { leggiCaricoAtleta, type CaricoAtleta, type LivelloCarico } from "@/src/services/carico";
import { brand } from "@/src/config";

const ETICHETTE: Record<LivelloCarico, string> = {
  insufficiente: "Dati insufficienti",
  basso: "Carico basso",
  normale: "Nella norma",
  da_monitorare: "Da monitorare",
  alto: "Rischio alto",
};

function colore(livello: LivelloCarico): string {
  switch (livello) {
    case "normale": return brand.colors.success;
    case "da_monitorare": return brand.colors.warning;
    case "alto": return brand.colors.error;
    case "basso": return brand.colors.brandSecondary;
    default: return brand.colors.muted;
  }
}

/**
 * Rapporto acuto:cronico (ACWR) calcolato da durata×RPE delle sedute
 * già registrate — vedi src/services/carico.ts per il metodo. Nessun
 * nuovo dato da compilare: si appoggia a RPE e durata che l'app
 * raccoglie già.
 */
export function CaricoAllenamento({ athleteId }: { athleteId: string }) {
  const [carico, setCarico] = useState<CaricoAtleta | null>(null);
  const [caricamento, setCaricamento] = useState(true);

  const carica = useCallback(async () => {
    setCaricamento(true);
    try {
      setCarico(await leggiCaricoAtleta(athleteId));
    } catch {
      setCarico(null);
    } finally {
      setCaricamento(false);
    }
  }, [athleteId]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  if (caricamento) return <ActivityIndicator color={brand.colors.brand} style={{ marginTop: 12 }} />;
  if (!carico) return null;

  return (
    <View style={styles.card}>
      <View style={styles.riga}>
        <Text style={styles.titolo}>Carico di allenamento</Text>
        <View style={[styles.badge, { backgroundColor: colore(carico.livello) }]}>
          <Text style={styles.badgeTesto}>{ETICHETTE[carico.livello]}</Text>
        </View>
      </View>
      {carico.rapporto !== null ? (
        <Text style={styles.nota}>
          Rapporto acuto:cronico {carico.rapporto.toFixed(2)} — ultimi 7 giorni ({Math.round(carico.caricoAcuto)}) contro la media settimanale delle ultime 4 ({Math.round(carico.caricoCronicoSettimanale)}). Nella norma tra 0.8 e 1.3; sopra 1.5 il rischio di infortunio da sovraccarico sale.
        </Text>
      ) : (
        <Text style={styles.nota}>
          Servono almeno due settimane di RPE registrati con continuità per un rapporto affidabile ({carico.giorniStorico} giorni di storico finora).
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 8, marginTop: 12 },
  riga: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titolo: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  badge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  badgeTesto: { color: "#000", fontWeight: "700", fontSize: 12 },
  nota: { color: brand.colors.muted, fontSize: 12, lineHeight: 17 },
});
