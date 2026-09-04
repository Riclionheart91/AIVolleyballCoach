import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, FlatList, Alert } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { attivaStagione, creaStagione, elencaStagioni } from "@/src/services/seasons";
import { brand } from "@/src/config";
import type { Season } from "@/src/types/database";

/**
 * Gate obbligatorio: senza una stagione attiva, l'allenatore/vice deve
 * aprirne una prima di entrare nell'app operativa — non ha senso
 * registrare allenamenti/valutazioni "fuori stagione". Chi non può
 * scrivere (presidente, atleta) può invece solo *consultare* una
 * stagione passata in lettura, senza attivarla (l'attivazione resta una
 * decisione dell'allenatore).
 */
export default function ApriStagione() {
  const { team, puoScrivere, ricaricaContesto } = useAuth();
  const [stagioni, setStagioni] = useState<Season[]>([]);
  const [nome, setNome] = useState("");
  const [inCorso, setInCorso] = useState(false);

  const carica = useCallback(async () => {
    if (!team) return;
    setStagioni(await elencaStagioni(team.id));
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function aprine1nuova() {
    if (!team || !nome.trim()) return;
    setInCorso(true);
    try {
      const stagione = await creaStagione(team.id, { nome: nome.trim(), data_apertura: new Date().toISOString().slice(0, 10) });
      await attivaStagione(stagione.id);
      await ricaricaContesto();
      router.replace("/(tabs)");
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    } finally {
      setInCorso(false);
    }
  }

  async function consultaInLettura(stagioneId: string) {
    // Consultazione: naviga direttamente alla tab Stagioni, dove trova
    // il dettaglio/baseline di quella stagione — senza attivarla.
    void stagioneId;
    router.replace("/(tabs)/stagioni");
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Nessuna stagione attiva</Text>

      {puoScrivere ? (
        <>
          <Text style={styles.sottotitolo}>Apri una nuova stagione per iniziare a registrare allenamenti e valutazioni.</Text>
          <View style={styles.form}>
            <TextInput style={styles.input} placeholder="Nome stagione (es. 2026/2027)" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} />
            <Pressable style={styles.bottone} onPress={aprine1nuova} disabled={inCorso}>
              <Text style={styles.bottoneTesto}>{inCorso ? "Apertura…" : "Apri stagione"}</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <Text style={styles.sottotitolo}>L'allenatore non ha ancora aperto la stagione corrente. Puoi consultare in sola lettura una stagione passata qui sotto.</Text>
      )}

      {stagioni.length > 0 && (
        <>
          <Text style={styles.sezione}>Stagioni passate (sola lettura)</Text>
          <FlatList
            data={stagioni}
            keyExtractor={(s) => s.id}
            renderItem={({ item }) => (
              <Pressable style={styles.rigaStagione} onPress={() => consultaInLettura(item.id)}>
                <Text style={styles.rigaStagioneTesto}>{item.nome}</Text>
                <Text style={styles.rigaStagioneSotto}>{item.data_apertura} — {item.stato}</Text>
              </Pressable>
            )}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface, padding: 24, gap: 16 },
  title: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700" },
  sottotitolo: { color: brand.colors.muted },
  form: { gap: 8, backgroundColor: brand.colors.surfaceSecondary, padding: 12, borderRadius: 12 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  bottone: { backgroundColor: brand.colors.brand, padding: 12, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  sezione: { color: brand.colors.muted, fontSize: 13, textTransform: "uppercase", marginTop: 8 },
  rigaStagione: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, padding: 12, marginBottom: 8 },
  rigaStagioneTesto: { color: brand.colors.onSurface, fontWeight: "600" },
  rigaStagioneSotto: { color: brand.colors.muted, fontSize: 12 },
});
