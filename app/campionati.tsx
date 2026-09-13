import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { DEFAULT_CAMPIONATO, creaCampionato, disattivaCampionato, elencaCampionati } from "@/src/services/championships";
import { brand } from "@/src/config";
import type { Campionato } from "@/src/types/database";
import { avvisa } from "@/src/lib/confermaAzione";

export default function Campionati() {
  const { team } = useAuth();
  const [campionati, setCampionati] = useState<Campionato[]>([]);
  const [nome, setNome] = useState("");
  const [federazione, setFederazione] = useState<Campionato["federazione"]>("FIPAV");
  const [dataInizio, setDataInizio] = useState("");
  const [dataFine, setDataFine] = useState("");

  const carica = useCallback(async () => {
    if (!team) return;
    setCampionati(await elencaCampionati(team.id).catch(() => []));
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function aggiungi() {
    if (!team || !nome.trim()) return;
    try {
      await creaCampionato(team.id, { ...DEFAULT_CAMPIONATO, nome: nome.trim(), federazione, data_inizio: dataInizio || null, data_fine: dataFine || null });
      setNome(""); setDataInizio(""); setDataFine("");
      carica();
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  async function rimuovi(id: string) {
    try { await disattivaCampionato(id); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← Profilo</Text></Pressable>
        <Text style={styles.titolo}>Campionati</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={styles.nota}>Una squadra può giocare più campionati/federazioni insieme (es. FIPAV e CSI): ogni partita sceglie il proprio quando la crei nella tab Partite. Regole di base precompilate (25 punti/set, 15 al 5°, 6 sostituzioni, 2 Libero) — modificabili dopo la creazione se servisse.</Text>

        <View style={styles.card}>
          {campionati.map((c) => (
            <View key={c.id} style={styles.riga}>
              <Text style={styles.rigaTesto}>
                {c.nome} ({c.federazione}) — distinta {c.distinta_min_giocatrici}-{c.distinta_max_giocatrici}
                {c.data_inizio || c.data_fine ? `\nPeriodo: ${c.data_inizio ?? "?"} → ${c.data_fine ?? "?"}` : ""}
              </Text>
              <Pressable onPress={() => rimuovi(c.id)}><Text style={styles.rimuovi}>Rimuovi</Text></Pressable>
            </View>
          ))}
          {campionati.length === 0 && <Text style={styles.nota}>Nessun campionato ancora.</Text>}

          <TextInput style={styles.input} placeholder="Nome campionato (es. Serie C 2026/27)" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} />
          <Text style={styles.etichettaCampo}>Periodo (facoltativo — le partite importate da SportEasy in questo intervallo verranno assegnate qui in automatico, sempre modificabile dopo)</Text>
          <View style={styles.selettoreRiga}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="Inizio AAAA-MM-GG" placeholderTextColor={brand.colors.muted} value={dataInizio} onChangeText={setDataInizio} />
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="Fine AAAA-MM-GG" placeholderTextColor={brand.colors.muted} value={dataFine} onChangeText={setDataFine} />
          </View>
          <View style={styles.selettoreRiga}>
            {(["FIPAV", "PGS", "CSI", "ALTRO"] as const).map((f) => (
              <Pressable key={f} onPress={() => setFederazione(f)} style={[styles.chip, federazione === f && styles.chipAttivo]}>
                <Text style={[styles.chipTesto, federazione === f && styles.chipTestoAttivo]}>{f}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.bottone} onPress={aggiungi} disabled={!nome.trim()}>
            <Text style={styles.bottoneTesto}>Aggiungi campionato</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  nota: { color: brand.colors.muted, fontSize: 12 },
  etichettaCampo: { color: brand.colors.muted, fontSize: 11 },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 10 },
  riga: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaTesto: { color: brand.colors.onSurface, fontSize: 13, flex: 1 },
  rimuovi: { color: brand.colors.error, fontSize: 12, fontWeight: "600" },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  selettoreRiga: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  chip: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 14, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  bottone: { backgroundColor: brand.colors.brand, padding: 12, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
});
