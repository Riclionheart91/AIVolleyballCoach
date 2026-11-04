import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaSquadreSocieta } from "@/src/services/societa";
import { avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import { TitoloGrande } from "@/src/components/TitoloGrande";

interface VoceRubrica {
  email: string;
  nome: string;
  ruoli: { squadra: string; ruolo: string }[];
}

/**
 * Rubrica dello staff della società: raggruppa per email (identificatore
 * univoco) chi allena o fa da vice in quali squadre, mostrando il nome
 * reale recuperato da Google — usando dati già raccolti da
 * elenca_squadre_societa, nessun nuovo dato di contatto, solo una vista
 * d'insieme comoda quando le squadre sono tante.
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
          const voce = mappa.get(s.allenatore_email) ?? { email: s.allenatore_email, nome: s.allenatore_nome ?? s.allenatore_email, ruoli: [] };
          voce.ruoli.push({ squadra: s.nome, ruolo: "Allenatore" });
          mappa.set(s.allenatore_email, voce);
        }
        if (s.vice_allenatore_email) {
          const voce = mappa.get(s.vice_allenatore_email) ?? { email: s.vice_allenatore_email, nome: s.vice_allenatore_nome ?? s.vice_allenatore_email, ruoli: [] };
          voce.ruoli.push({ squadra: s.nome, ruolo: "Vice-allenatore" });
          mappa.set(s.vice_allenatore_email, voce);
        }
      }
      setVoci(Array.from(mappa.values()).sort((a, b) => a.nome.localeCompare(b.nome)));
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
        <Text style={[styles.nota, { padding: 16 }]}>Questa sezione è riservata al presidente di una società.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.indietroArea}><Text style={styles.indietro}>← Profilo</Text></Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.contenuto}>
        <TitoloGrande titolo="Rubrica staff" />
        {caricamento ? (
          <ActivityIndicator color={brand.colors.brand} />
        ) : voci.length === 0 ? (
          <Text style={styles.nota}>Nessun allenatore o vice ancora assegnato in nessuna squadra della società.</Text>
        ) : (
          <View style={styles.scheda}>
            {voci.map((voce, idx) => (
              <View key={voce.email}>
                {idx > 0 && <View style={styles.separatore} />}
                <View style={styles.voce}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarTesto}>{(voce.nome.replace(/[^a-zA-Z]/g, "").slice(0, 2) || "?").toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.email}>{voce.nome}</Text>
                    {voce.nome !== voce.email && <Text style={styles.riga}>{voce.email}</Text>}
                    {voce.ruoli.map((r, i) => (
                      <Text key={i} style={styles.riga}>{r.ruolo} · {r.squadra}</Text>
                    ))}
                  </View>
                </View>
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
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8 },
  indietroArea: { minHeight: 44, justifyContent: "center" },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  contenuto: { padding: 16, paddingBottom: 60, gap: 12, width: "100%", maxWidth: 900, alignSelf: "center" },
  scheda: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, overflow: "hidden" },
  voce: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 12, paddingHorizontal: 14, minHeight: 56 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  avatarTesto: { color: brand.colors.brand, fontSize: 14, fontWeight: "800" },
  separatore: { height: 1, backgroundColor: brand.colors.border, marginLeft: 66 },
  email: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  riga: { color: brand.colors.muted, fontSize: 14 },
  nota: { color: brand.colors.muted, fontSize: 13, lineHeight: 18 },
});
