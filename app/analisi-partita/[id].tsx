import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import {
  analisiFondamentaliPartita, analisiPersonePartita, andamentoTraPartite,
  type AnalisiFondamentale, type AnalisiPersona, type AndamentoPartita,
} from "@/src/services/matches";
import { supabaseClient } from "@/src/lib/supabase";
import { avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import type { Match } from "@/src/types/database";

/**
 * Analisi ricca di una partita (F4): non solo il punteggio, ma dove
 * si vince e si perde davvero. L'efficienza (punti meno errori sulle
 * azioni) è la misura che conta in uno scouting reale — dice quanto
 * un fondamentale RENDE, non solo quante volte è stato usato.
 */
export default function AnalisiPartita() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { team } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const [fondamentali, setFondamentali] = useState<AnalisiFondamentale[]>([]);
  const [persone, setPersone] = useState<AnalisiPersona[]>([]);
  const [andamento, setAndamento] = useState<AndamentoPartita[]>([]);
  const [caricamento, setCaricamento] = useState(true);

  const carica = useCallback(async () => {
    if (!id || !team) return;
    setCaricamento(true);
    try {
      const { data: m } = await supabaseClient.from("matches").select("*").eq("id", id).single();
      setMatch(m ?? null);
      const [f, p, a] = await Promise.all([
        analisiFondamentaliPartita(id).catch(() => []),
        analisiPersonePartita(id).catch(() => []),
        andamentoTraPartite(team.id, 8).catch(() => []),
      ]);
      setFondamentali(f);
      setPersone(p);
      setAndamento(a);
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCaricamento(false);
    }
  }, [id, team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  function coloreEfficienza(v: number | null): string {
    if (v === null) return brand.colors.muted;
    if (v >= 0.3) return brand.colors.success;
    if (v >= 0) return brand.colors.brand;
    if (v >= -0.3) return brand.colors.warning;
    return brand.colors.error;
  }

  if (caricamento) return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} /></View>;
  if (!match) return <View style={styles.container}><Text style={styles.nota}>Partita non trovata.</Text></View>;

  const massimoAzioni = Math.max(1, ...fondamentali.map((f) => f.azioni));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← Partite</Text></Pressable>
        <Text style={styles.titolo} numberOfLines={1}>vs {match.avversario}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 60 }}>
        <View>
          <Text style={styles.sezione}>Efficienza per fondamentale</Text>
          <Text style={styles.nota}>Punti meno errori sulle azioni totali: dice quanto un fondamentale rende, non solo quante volte è stato usato.</Text>
          {fondamentali.length === 0 ? (
            <Text style={styles.vuoto}>Nessun evento registrato in questa partita.</Text>
          ) : (
            fondamentali.map((f) => (
              <View key={f.fondamentale} style={styles.rigaFondamentale}>
                <View style={styles.rigaTitoloFondamentale}>
                  <Text style={styles.nomeFondamentale}>{f.fondamentale === "Punto_avversario" ? "Punto avversario" : f.fondamentale}</Text>
                  <Text style={[styles.valoreEfficienza, { color: coloreEfficienza(f.efficienza) }]}>
                    {f.efficienza !== null ? (f.efficienza >= 0 ? "+" : "") + f.efficienza.toFixed(2) : "—"}
                  </Text>
                </View>
                <View style={styles.barraSfondo}>
                  <View style={[styles.barraRiempimento, { width: `${(f.azioni / massimoAzioni) * 100}%`, backgroundColor: coloreEfficienza(f.efficienza) }]} />
                </View>
                <Text style={styles.dettaglioFondamentale}>
                  {f.azioni} azioni ({f.quota_sul_totale ?? 0}% del totale) · {f.punti} punti, {f.errori} errori
                </Text>
              </View>
            ))
          )}
        </View>

        <View>
          <Text style={styles.sezione}>Contributo individuale</Text>
          <Text style={styles.nota}>Ordinate dal saldo migliore. Con "punto di forza" e "punto debole" nella partita.</Text>
          {persone.length === 0 ? (
            <Text style={styles.vuoto}>Nessun dato individuale disponibile.</Text>
          ) : (
            persone.map((p, i) => (
              <View key={p.athlete_id} style={styles.rigaPersona}>
                <Text style={styles.posizionePersona}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.nomePersona}>{p.nome_completo}</Text>
                  <Text style={styles.dettaglioPersona}>
                    {p.azioni} azioni · {p.punti}+/{p.errori}-
                    {p.fondamentale_migliore ? ` · forte in ${p.fondamentale_migliore}` : ""}
                    {p.fondamentale_peggiore && p.fondamentale_peggiore !== p.fondamentale_migliore ? ` · da curare: ${p.fondamentale_peggiore}` : ""}
                  </Text>
                </View>
                <Text style={[styles.saldoPersona, { color: p.saldo >= 0 ? brand.colors.success : brand.colors.error }]}>
                  {p.saldo >= 0 ? "+" : ""}{p.saldo}
                </Text>
              </View>
            ))
          )}
        </View>

        {andamento.length > 1 && (
          <View>
            <Text style={styles.sezione}>Tendenza nelle ultime partite</Text>
            <Text style={styles.nota}>Efficienza complessiva partita per partita: se scende per più gare di fila è un segnale da guardare in allenamento.</Text>
            {andamento.map((a) => (
              <View key={a.match_id} style={styles.rigaAndamento}>
                <Text style={styles.rigaAndamentoTesto} numberOfLines={1}>
                  vs {a.avversario} ({new Date(a.data).toLocaleDateString("it-IT")}) — set {a.set_vinti_noi}-{a.set_vinti_avversario}
                </Text>
                <Text style={[styles.valoreEfficienza, { color: coloreEfficienza(a.efficienza) }]}>
                  {a.efficienza !== null ? (a.efficienza >= 0 ? "+" : "") + a.efficienza.toFixed(2) : "—"}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700", flex: 1 },
  sezione: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "800", textTransform: "uppercase", marginBottom: 4 },
  nota: { color: brand.colors.muted, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  vuoto: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 12 },
  rigaFondamentale: { marginBottom: 12, gap: 4 },
  rigaTitoloFondamentale: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  nomeFondamentale: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "700" },
  valoreEfficienza: { fontSize: 14, fontWeight: "800" },
  barraSfondo: { height: 8, backgroundColor: brand.colors.surfaceTertiary, borderRadius: 4, overflow: "hidden" },
  barraRiempimento: { height: "100%", borderRadius: 4 },
  dettaglioFondamentale: { color: brand.colors.muted, fontSize: 11 },
  rigaPersona: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  posizionePersona: { color: brand.colors.muted, fontSize: 13, fontWeight: "700", width: 20 },
  nomePersona: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "600" },
  dettaglioPersona: { color: brand.colors.muted, fontSize: 11, marginTop: 2 },
  saldoPersona: { fontSize: 16, fontWeight: "800" },
  rigaAndamento: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: brand.colors.border, gap: 8 },
  rigaAndamentoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12, flex: 1 },
});
