import { useCallback, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, Alert, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { attivaStagione, concludiStagione, creaStagione, elencaStagioni, generaBaselineStagione } from "@/src/services/seasons";
import { confermaAzione } from "@/src/lib/confermaAzione";
import { FabAggiungi } from "@/src/components/Fab";
import { PopupForm } from "@/src/components/PopupForm";
import { brand } from "@/src/config";
import type { Season } from "@/src/types/database";

export default function Stagioni() {
  const { team, puoScrivere } = useAuth();
  const [stagioni, setStagioni] = useState<Season[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [popupAperto, setPopupAperto] = useState(false);
  const [nome, setNome] = useState("");

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      setStagioni(await elencaStagioni(team.id));
    } finally {
      setCaricamento(false);
    }
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function crea() {
    if (!team || !nome.trim()) return;
    try {
      await creaStagione(team.id, { nome: nome.trim(), data_apertura: new Date().toISOString().slice(0, 10) });
      setNome("");
      setPopupAperto(false);
      carica();
    } catch (e) {
      Alert.alert("Errore nella creazione della stagione", (e as Error).message);
    }
  }

  async function attiva(id: string) {
    try {
      await attivaStagione(id);
      carica();
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    }
  }

  async function generaBaseline(id: string) {
    try {
      const n = await generaBaselineStagione(id);
      if (n === 0) {
        Alert.alert(
          "Nessuna valutazione da usare come punto di partenza",
          "\"Genera baseline\" prende l'ultima valutazione già registrata per ogni atleta/fondamentale (fino alla data di apertura di questa stagione) e la fissa come punto di riferimento iniziale della stagione, per poter poi misurare i progressi nel tempo. Non ha trovato nessuna valutazione precedente da usare: è normale se è la prima stagione della squadra o se non hai ancora registrato valutazioni. Puoi rilanciarla più avanti, appena avrai le prime valutazioni.",
        );
      } else {
        Alert.alert("Baseline generata", `${n} valori di riferimento creati (uno per atleta/fondamentale), presi dall'ultima valutazione disponibile prima dell'apertura della stagione.`);
      }
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    }
  }

  function conferimaConclusione(id: string, nomeStagione: string) {
    confermaAzione(
      "Terminare la stagione?",
      `"${nomeStagione}" verrà segnata come conclusa. Resta consultabile in sola lettura, ma per registrare nuovi allenamenti/valutazioni dovrai aprirne un'altra.`,
      "Termina",
      async () => { try { await concludiStagione(id); carica(); } catch (e) { Alert.alert("Errore", (e as Error).message); } },
      true,
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={stagioni}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
        refreshControl={<RefreshControl refreshing={caricamento} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListEmptyComponent={!caricamento ? <Text style={styles.vuoto}>Nessuna stagione ancora. Usa il pulsante + qui sotto.</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={styles.cardTitolo}>{item.nome}</Text>
              <Text style={[styles.badge, item.stato === "attiva" && styles.badgeAttiva]}>{item.stato}</Text>
            </View>
            <Text style={styles.cardSotto}>Apertura: {item.data_apertura}</Text>
            {puoScrivere && (
              <View style={styles.azioni}>
                {item.stato !== "attiva" && item.stato !== "conclusa" && (
                  <Pressable style={styles.bottoneSecondario} onPress={() => attiva(item.id)}>
                    <Text style={styles.bottoneSecondarioTesto}>Attiva</Text>
                  </Pressable>
                )}
                <Pressable style={styles.bottoneSecondario} onPress={() => generaBaseline(item.id)}>
                  <Text style={styles.bottoneSecondarioTesto}>Genera baseline</Text>
                </Pressable>
                {item.stato !== "conclusa" && (
                  <Pressable style={styles.bottoneSecondarioDistruttivo} onPress={() => conferimaConclusione(item.id, item.nome)}>
                    <Text style={styles.bottoneSecondarioDistruttivoTesto}>Termina</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        )}
      />

      {puoScrivere && <FabAggiungi onPress={() => setPopupAperto(true)} />}

      <PopupForm visibile={popupAperto} titolo="Nuova stagione" haModifiche={nome.trim().length > 0} onChiudi={() => { setPopupAperto(false); setNome(""); }}>
        <TextInput style={styles.input} placeholder="Nome stagione (es. 2026/2027)" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} autoFocus />
        <Pressable style={styles.bottone} onPress={crea} disabled={!nome.trim()}>
          <Text style={styles.bottoneTesto}>Crea stagione</Text>
        </Pressable>
      </PopupForm>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 12 },
  bottone: { backgroundColor: brand.colors.brand, padding: 12, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, marginBottom: 10, gap: 4 },
  cardTitolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  cardSotto: { color: brand.colors.muted, fontSize: 13 },
  badge: { color: brand.colors.muted, fontSize: 12, textTransform: "uppercase" },
  badgeAttiva: { color: brand.colors.success, fontWeight: "700" },
  azioni: { flexDirection: "row", gap: 8, marginTop: 8 },
  bottoneSecondario: { borderColor: brand.colors.brand, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "600", fontSize: 13 },
  bottoneSecondarioDistruttivo: { borderColor: brand.colors.error, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  bottoneSecondarioDistruttivoTesto: { color: brand.colors.error, fontWeight: "600", fontSize: 13 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
});
