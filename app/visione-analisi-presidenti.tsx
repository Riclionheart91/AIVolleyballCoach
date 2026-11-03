import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaPresidentiAtleti, impostaVisioneAnalisiPresidente, type PresidenteAtleta } from "@/src/services/societa";
import { avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";

/**
 * Riservata all'amministratore della piattaforma. Un presidente che gioca in una squadra della sua società
 * è, in quella squadra, un'atleta come le altre: vede la partita dal vivo e solo le proprie azioni nelle analisi.
 * Da qui l'amministratore gli attiva (o gli toglie, in qualsiasi momento) la visione completa delle analisi di
 * quella squadra, per esempio a fine stagione. Nelle altre squadre della società il presidente vede già tutto.
 */
export default function VisioneAnalisiPresidenti() {
  const { isSuperuser } = useAuth();
  const [elenco, setElenco] = useState<PresidenteAtleta[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [inCorso, setInCorso] = useState<string | null>(null);

  const carica = useCallback(async () => {
    if (!isSuperuser) { setCaricamento(false); return; }
    try {
      setElenco(await elencaPresidentiAtleti());
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCaricamento(false);
    }
  }, [isSuperuser]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function cambia(r: PresidenteAtleta) {
    const chiave = `${r.team_id}:${r.user_id}`;
    setInCorso(chiave);
    try {
      await impostaVisioneAnalisiPresidente(r.team_id, r.user_id, !r.visione_analisi);
      setElenco((prima) => prima.map((x) => (x.team_id === r.team_id && x.user_id === r.user_id ? { ...x, visione_analisi: !r.visione_analisi } : x)));
    } catch (e) {
      avvisa("Non riuscito", (e as Error).message);
    } finally {
      setInCorso(null);
    }
  }

  if (!isSuperuser) {
    return (
      <View style={styles.container}>
        <Text style={styles.nota}>Questa sezione è riservata all'amministratore della piattaforma.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← Profilo</Text></Pressable>
        <Text style={styles.titolo}>Presidenti che giocano</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }}>
        <Text style={styles.nota}>
          Un presidente che gioca in una squadra è, in quella squadra, un'atleta come le altre: durante la partita vede tutto, nelle analisi
          solo le proprie azioni. Qui puoi dargli la visione completa delle analisi di quella squadra e toglierla quando vuoi.
          Nelle altre squadre della società il presidente vede già tutto.
        </Text>

        {caricamento && <ActivityIndicator color={brand.colors.brand} />}
        {!caricamento && elenco.length === 0 && (
          <Text style={styles.nota}>Nessun presidente risulta anche atleta di una squadra della propria società.</Text>
        )}

        {elenco.map((r) => {
          const chiave = `${r.team_id}:${r.user_id}`;
          return (
            <View key={chiave} style={styles.card}>
              <Text style={styles.nome}>{r.atleta_nome || r.email || "Presidente"}</Text>
              <Text style={styles.nota}>{r.societa_nome} · {r.team_nome}{r.email ? ` · ${r.email}` : ""}</Text>
              <Text style={[styles.stato, r.visione_analisi && { color: brand.colors.brand }]}>
                {r.visione_analisi ? "Visione completa delle analisi: ATTIVA" : "Vede solo le proprie azioni (come le atlete)"}
              </Text>
              <Pressable
                style={[styles.bottone, r.visione_analisi && styles.bottoneSpento, inCorso === chiave && { opacity: 0.6 }]}
                disabled={inCorso === chiave}
                onPress={() => cambia(r)}
              >
                <Text style={[styles.bottoneTesto, r.visione_analisi && { color: brand.colors.brand }]}>
                  {inCorso === chiave ? "Un attimo…" : r.visione_analisi ? "Togli la visione completa" : "Attiva la visione completa"}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 6 },
  nome: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  nota: { color: brand.colors.muted, fontSize: 13, lineHeight: 18 },
  stato: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "600", marginTop: 4 },
  bottone: { backgroundColor: brand.colors.brand, padding: 10, borderRadius: 8, alignItems: "center", marginTop: 8 },
  bottoneSpento: { backgroundColor: "transparent", borderColor: brand.colors.brand, borderWidth: 1 },
  bottoneTesto: { color: "#000", fontWeight: "700" },
});
