import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaSquadreSocieta } from "@/src/services/societa";
import { avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";

interface VoceRubrica {
  email: string;
  ruoli: { squadra: string; ruolo: string }[];
}

/**
 * Rubrica dello staff della società: raggruppa per email chi allena o
 * fa da vice in quali squadre, usando i dati già raccolti da
 * elenca_squadre_societa — nessun nuovo dato di contatto, solo una
 * vista d'insieme comoda quando le squadre sono tante.
 */
export default function RubricaStaff() {
  const { societaPresidenza } = useAuth();
  const [voci, setVoci] = useState<VoceRubrica[]>([]);
  const [caricamento, setCaricamento] = useState(true);

  const carica = useCallback(async () => {
    if (!societaPresidenza) return;
    setCaricamento(true);
    try {
      const squadre = await elencaSquadreSocieta(societaPresidenza.societa_id);
      const mappa = new Map<string, VoceRubrica>();
      for (const s of squadre) {
        if (s.allenatore_email) {
          const voce = mappa.get(s.allenatore_email) ?? { email: s.allenatore_email, ruoli: [] };
          voce.ruoli.push({ squadra: s.nome, ruolo: "Allenatore" });
          mappa.set(s.allenatore_email, voce);
        }
        if (s.vice_allenatore_email) {
          const voce = mappa.get(s.vice_allenatore_email) ?? { email: s.vice_allenatore_email, ruoli: [] };
          voce.ruoli.push({ squadra: s.nome, ruolo: "Vice-allenatore" });
          mappa.set(s.vice_allenatore_email, voce);
        }
      }
      setVoci(Array.from(mappa.values()).sort((a, b) => a.email.localeCompare(b.email)));
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCaricamento(false);
    }
  }, [societaPresidenza]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  if (!societaPresidenza) {
    return (
      <View style={styles.container}>
        <Text style={styles.nota}>Questa sezione è riservata al presidente di una società.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← Profilo</Text></Pressable>
        <Text style={styles.titolo}>Rubrica staff</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }}>
        {caricamento ? (
          <ActivityIndicator color={brand.colors.brand} />
        ) : voci.length === 0 ? (
          <Text style={styles.nota}>Nessun allenatore o vice ancora assegnato in nessuna squadra della società.</Text>
        ) : (
          voci.map((voce) => (
            <View key={voce.email} style={styles.card}>
              <Text style={styles.email}>{voce.email}</Text>
              {voce.ruoli.map((r, i) => (
                <Text key={i} style={styles.riga}>{r.ruolo} · {r.squadra}</Text>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 4 },
  email: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  riga: { color: brand.colors.muted, fontSize: 12.5 },
  nota: { color: brand.colors.muted, fontSize: 12, lineHeight: 17 },
});
