import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { elencaPartiteLive, type PartitaLive } from "@/src/services/live";
import { brand } from "@/src/config";

const INTERVALLO_MS = 10000;

/** Le partite in corso della propria societa': tocca una partita per seguirla punto per punto, in sola lettura. */
export default function ElencoLive() {
  const [partite, setPartite] = useState<PartitaLive[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  // Se la lettura fallisce NON si mostra "nessuna partita": si tiene l'elenco precedente, si segnala l'errore e si riprova.
  const carica = useCallback(async () => {
    try { setPartite(await elencaPartiteLive()); setErrore(null); }
    catch (e) { setErrore(e instanceof Error ? e.message : "Errore di rete"); }
  }, []);
  useFocusEffect(useCallback(() => { carica(); }, [carica]));
  useEffect(() => {
    const t = setInterval(carica, errore ? 2500 : INTERVALLO_MS);
    return () => clearInterval(t);
  }, [carica, errore]);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Pressable onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/"); }} hitSlop={12}>
          <Text style={s.indietro}>← Indietro</Text>
        </Pressable>
        <Text style={s.titolo}>Partite in corso</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }}>
        {partite === null && <ActivityIndicator color={brand.colors.brand} />}
        {errore && <Text style={s.errore}>Non riesco ad aggiornare l'elenco ({errore}). Riprovo…</Text>}
        {partite !== null && partite.length === 0 && !errore && (
          <Text style={s.nota}>In questo momento nessuna partita della tua società è in corso.</Text>
        )}
        {(partite ?? []).map((p) => (
          <Pressable key={p.match_id} style={s.card} onPress={() => router.push(`/partita/${p.match_id}?live=1`)}>
            <View style={s.rigaTesta}>
              <View style={s.live}><Text style={s.liveTesto}>● LIVE</Text></View>
              <Text style={s.nota} numberOfLines={1}>{p.team_nome}</Text>
            </View>
            <View style={s.rigaPunteggio}>
              <Text style={s.nomi} numberOfLines={1}>{p.team_nome} – {p.avversario}</Text>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={s.punteggio}>{p.punti_noi}-{p.punti_avversario}</Text>
                <Text style={s.nota}>Set {p.set_corrente} · set vinti {p.set_vinti_noi}-{p.set_vinti_avversario}</Text>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  errore: { color: brand.colors.warning, fontSize: 13 },
  nota: { color: brand.colors.muted, fontSize: 13 },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: brand.colors.border },
  rigaTesta: { flexDirection: "row", alignItems: "center", gap: 10 },
  live: { backgroundColor: brand.colors.error, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  liveTesto: { color: "#fff", fontSize: 11, fontWeight: "800" },
  rigaPunteggio: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  nomi: { flex: 1, color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  punteggio: { color: brand.colors.brand, fontSize: 30, fontWeight: "800" },
});
