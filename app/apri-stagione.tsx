import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, FlatList, Alert } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { attivaStagione, creaStagione, elencaStagioni } from "@/src/services/seasons";
import { confermaAzione } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import type { Season } from "@/src/types/database";

/**
 * Gate obbligatorio: senza una stagione attiva, l'allenatore/vice deve
 * aprirne una prima di entrare nell'app operativa. Prima questa
 * schermata offriva solo "creane una nuova" anche quando esisteva già
 * una stagione creata in precedenza (stato "pianificata") mai attivata
 * — costringendo a passare dalla tab Stagioni per trovarla. Ora, se ce
 * n'è una, la propone direttamente qui con un pulsante "Attiva questa".
 */
export default function ApriStagione() {
  const { team, puoScrivere, ricaricaContesto } = useAuth();
  const [stagioni, setStagioni] = useState<Season[]>([]);
  const [nome, setNome] = useState("");
  const [inCorso, setInCorso] = useState(false);
  const [mostraFormNuova, setMostraFormNuova] = useState(false);

  const carica = useCallback(async () => {
    if (!team) return;
    setStagioni(await elencaStagioni(team.id));
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  const stagioniPianificate = stagioni.filter((s) => s.stato === "pianificata");
  const stagioniConcluse = stagioni.filter((s) => s.stato === "conclusa");

  async function aprineUnaNuova() {
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

  function chiediAttivazione(stagione: Season) {
    confermaAzione(
      "Attivare questa stagione?",
      `"${stagione.nome}" era già stata creata ma non ancora attivata. Attivarla ora renderà l'app operativa per registrare allenamenti e valutazioni.`,
      "Attiva",
      async () => {
        setInCorso(true);
        try {
          await attivaStagione(stagione.id);
          await ricaricaContesto();
          router.replace("/(tabs)");
        } catch (e) {
          Alert.alert("Errore", (e as Error).message);
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
      <Text style={styles.title}>Nessuna stagione attiva</Text>

      {puoScrivere ? (
        <>
          {stagioniPianificate.length > 0 && (
            <View style={styles.form}>
              <Text style={styles.sottotitolo}>Hai già {stagioniPianificate.length === 1 ? "una stagione creata" : "delle stagioni create"} ma non ancora attivata. Vuoi usare questa, o preferisci crearne una nuova?</Text>
              {stagioniPianificate.map((s) => (
                <Pressable key={s.id} style={styles.rigaPianificata} onPress={() => chiediAttivazione(s)} disabled={inCorso}>
                  <Text style={styles.rigaStagioneTesto}>{s.nome}</Text>
                  <Text style={styles.bottoneAttivaInline}>Attiva questa →</Text>
                </Pressable>
              ))}
            </View>
          )}

          {(mostraFormNuova || stagioniPianificate.length === 0) ? (
            <View style={styles.form}>
              <Text style={styles.sottotitolo}>{stagioniPianificate.length > 0 ? "Oppure crea una nuova stagione:" : "Apri una nuova stagione per iniziare a registrare allenamenti e valutazioni."}</Text>
              <TextInput style={styles.input} placeholder="Nome stagione (es. 2026/2027)" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} />
              <Pressable style={styles.bottone} onPress={aprineUnaNuova} disabled={inCorso || !nome.trim()}>
                <Text style={styles.bottoneTesto}>{inCorso ? "Apertura…" : "Crea e attiva"}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setMostraFormNuova(true)}>
              <Text style={styles.linkCreaNuova}>Preferisco crearne una nuova</Text>
            </Pressable>
          )}
        </>
      ) : (
        <Text style={styles.sottotitolo}>L'allenatore non ha ancora aperto la stagione corrente. Puoi consultare in sola lettura le stagioni passate qui sotto.</Text>
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
  linkCreaNuova: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "600" },
  sezione: { color: brand.colors.muted, fontSize: 13, textTransform: "uppercase", marginTop: 8 },
  rigaStagione: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, padding: 12, marginBottom: 8 },
  rigaPianificata: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: brand.colors.surfaceTertiary, borderRadius: 10, padding: 12, marginTop: 4 },
  rigaStagioneTesto: { color: brand.colors.onSurface, fontWeight: "600" },
  rigaStagioneSotto: { color: brand.colors.muted, fontSize: 12 },
  bottoneAttivaInline: { color: brand.colors.brand, fontWeight: "700", fontSize: 13 },
});
