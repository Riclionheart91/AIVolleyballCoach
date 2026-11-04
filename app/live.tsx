import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { elencaPartiteLive, type PartitaLive } from "@/src/services/live";
import { brand } from "@/src/config";
import { TitoloGrande } from "@/src/components/TitoloGrande";

/** Iniziali del nome di una squadra, per il cerchio al posto dello stemma. */
function iniziali(nome: string): string {
  const parti = nome.trim().split(/\s+/).filter(Boolean);
  if (parti.length === 0) return "?";
  return (parti.length === 1 ? parti[0].slice(0, 2) : parti[0][0] + parti[1][0]).toUpperCase();
}

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
      <ScrollView contentContainerStyle={s.contenuto}>
        <Pressable onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/"); }} hitSlop={12} style={s.tastoIndietro}>
          <Text style={s.indietro}>‹ Indietro</Text>
        </Pressable>
        <TitoloGrande titolo="Partite in corso" />

        {partite === null && <ActivityIndicator color={brand.colors.brand} />}
        {errore && <Text style={s.errore}>Non riesco ad aggiornare l'elenco ({errore}). Riprovo…</Text>}
        {partite !== null && partite.length === 0 && !errore && (
          <Text style={s.nota}>In questo momento nessuna partita della tua società è in corso.</Text>
        )}
        {(partite ?? []).map((p) => (
          <Pressable key={p.match_id} style={s.card} onPress={() => router.push(`/partita/${p.match_id}?live=1`)}>
            <View style={s.rigaTesta}>
              <View style={s.live}>
                <View style={s.puntoLive} />
                <Text style={s.liveTesto}>IN DIRETTA</Text>
              </View>
              <Text style={s.nota} numberOfLines={1}>Set {p.set_corrente}</Text>
            </View>
            <View style={s.rigaPunteggio}>
              <View style={s.squadra}>
                <View style={[s.stemma, { backgroundColor: brand.colors.surfaceTertiary }]}><Text style={[s.stemmaTesto, { color: brand.colors.brand }]}>{iniziali(p.team_nome)}</Text></View>
                <Text style={s.nomi} numberOfLines={2}>{p.team_nome}</Text>
              </View>
              <View style={{ alignItems: "center" }}>
                <Text style={s.punteggio}>{p.punti_noi} – {p.punti_avversario}</Text>
                <Text style={s.nota}>set vinti {p.set_vinti_noi}-{p.set_vinti_avversario}</Text>
              </View>
              <View style={s.squadra}>
                <View style={[s.stemma, { backgroundColor: brand.colors.border }]}><Text style={[s.stemmaTesto, { color: brand.colors.onSurfaceSecondary }]}>{iniziali(p.avversario)}</Text></View>
                <Text style={s.nomi} numberOfLines={2}>{p.avversario}</Text>
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
  contenuto: { padding: 16, gap: 14, paddingBottom: 60, width: "100%", maxWidth: 900, alignSelf: "center" },
  tastoIndietro: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  indietro: { color: brand.colors.brand, fontWeight: "600", fontSize: 17 },
  errore: { color: brand.colors.warning, fontSize: 13 },
  nota: { color: brand.colors.muted, fontSize: 13 },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 22, padding: 16, gap: 14, borderWidth: 1, borderColor: brand.colors.border },
  rigaTesta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  live: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: brand.colors.error, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 },
  puntoLive: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  liveTesto: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  rigaPunteggio: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  squadra: { flex: 1, alignItems: "center", gap: 6 },
  stemma: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  stemmaTesto: { fontSize: 17, fontWeight: "800" },
  nomi: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "700", textAlign: "center" },
  punteggio: { color: brand.colors.onSurface, fontSize: 40, fontWeight: "800", letterSpacing: -1, lineHeight: 46 },
});
