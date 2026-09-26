import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { apriPrimaStagioneSocieta, attivaSquadraInStagione, elencaStagioniSocieta } from "@/src/services/seasons";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import type { Season } from "@/src/types/database";

/**
 * Gate obbligatorio: senza una stagione ATTIVA E la propria squadra
 * CONFERMATA per essa, non si entra nell'app operativa. Con il modello
 * di stagione a livello di società, ci sono due casi distinti da
 * distinguere chiaramente per non confondere l'utente:
 *  - non esiste ancora nessuna stagione per la società;
 *  - la società ha una stagione attiva, ma QUESTA squadra non è ancora
 *    stata confermata dal presidente per essa (il caso nuovo, introdotto
 *    apposta perché "nessuno deve poter accedere alla nuova stagione
 *    finché il presidente non riassegna le squadre").
 */
export default function ApriStagione() {
  const { team, puoGestireStagioni, stagioneSocietaEsiste, ricaricaContesto } = useAuth();
  const [stagioniConcluse, setStagioniConcluse] = useState<Season[]>([]);
  const [nome, setNome] = useState("");
  const [inCorso, setInCorso] = useState(false);

  const carica = useCallback(async () => {
    if (!team?.societaId) return;
    const tutte = await elencaStagioniSocieta(team.societaId);
    setStagioniConcluse(tutte.filter((s) => s.stato === "conclusa"));
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function apriPrima() {
    if (!team?.societaId || !nome.trim()) return;
    setInCorso(true);
    try {
      await apriPrimaStagioneSocieta(team.societaId, nome.trim());
      await attivaSquadraInStagione(team.id);
      await ricaricaContesto();
      router.replace("/(tabs)");
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setInCorso(false);
    }
  }

  function chiediAttivazione() {
    if (!team) return;
    confermaAzione(
      "Attivare questa squadra per la stagione in corso?",
      "Da questo momento allenatore, vice e atleti di questa squadra potranno registrare allenamenti e valutazioni nella nuova stagione.",
      "Attiva",
      async () => {
        setInCorso(true);
        try {
          await attivaSquadraInStagione(team.id);
          await ricaricaContesto();
          router.replace("/(tabs)");
        } catch (e) {
          avvisa("Errore", (e as Error).message);
        } finally {
          setInCorso(false);
        }
      },
    );
  }

  function consultaInLettura() {
    router.replace("/(tabs)/stagioni");
  }

  return (
    <View style={styles.container}>
      {puoGestireStagioni ? (
        stagioneSocietaEsiste ? (
          <>
            <Text style={styles.title}>Squadra non ancora attivata</Text>
            <Text style={styles.sottotitolo}>
              La società ha una stagione in corso, ma questa squadra non è ancora stata confermata per parteciparvi. Attivala per iniziare a registrare allenamenti e valutazioni.
            </Text>
            <Pressable style={styles.bottone} onPress={chiediAttivazione} disabled={inCorso}>
              <Text style={styles.bottoneTesto}>{inCorso ? "Un attimo…" : "Attiva questa squadra"}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.title}>Nessuna stagione attiva</Text>
            <View style={styles.form}>
              <Text style={styles.sottotitolo}>Apri la prima stagione della società per iniziare a registrare allenamenti e valutazioni.</Text>
              <TextInput style={styles.input} placeholder="Nome stagione (es. 2026/2027)" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} />
              <Pressable style={styles.bottone} onPress={apriPrima} disabled={inCorso || !nome.trim()}>
                <Text style={styles.bottoneTesto}>{inCorso ? "Apertura…" : "Apri e attiva la mia squadra"}</Text>
              </Pressable>
            </View>
          </>
        )
      ) : (
        <>
          <Text style={styles.title}>Nessuna stagione attiva</Text>
          <Text style={styles.sottotitolo}>
            {stagioneSocietaEsiste
              ? "Il presidente della società ha aperto la nuova stagione, ma non ha ancora attivato questa squadra. Aspetta la sua conferma: potrai registrare allenamenti e valutazioni non appena l'avrà fatto."
              : "Il presidente della società non ha ancora aperto la stagione corrente. Puoi consultare in sola lettura le stagioni passate qui sotto."}
          </Text>
        </>
      )}

      {stagioniConcluse.length > 0 && (
        <>
          <Text style={styles.sezione}>Stagioni concluse (sola lettura)</Text>
          <FlatList
            data={stagioniConcluse}
            keyExtractor={(s) => s.id}
            renderItem={({ item }) => (
              <Pressable style={styles.rigaStagione} onPress={consultaInLettura}>
                <Text style={styles.rigaStagioneTesto}>{item.nome}</Text>
                <Text style={styles.rigaStagioneSotto}>{item.data_apertura} — {item.stato}</Text>
              </Pressable>
            )}
          />
        </>
      )}

      {inCorso && <ActivityIndicator color={brand.colors.brand} />}
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
