import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { aggiornaEsercizio, eliminaEsercizio, leggiEsercizio } from "@/src/services/exercises";
import { confermaAzione } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import type { Exercise } from "@/src/types/database";

export default function SchedaEsercizio() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { puoScrivere } = useAuth();
  const [esercizio, setEsercizio] = useState<Exercise | null>(null);
  const [inModifica, setInModifica] = useState(false);
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [salvataggio, setSalvataggio] = useState(false);

  useEffect(() => {
    if (!id) return;
    leggiEsercizio(id).then((e) => {
      setEsercizio(e);
      setNome(e.nome); setCategoria(e.categoria ?? ""); setDescrizione(e.descrizione ?? "");
    }).catch((err) => Alert.alert("Errore", err.message));
  }, [id]);

  const haModifiche = !!esercizio && (nome !== esercizio.nome || categoria !== (esercizio.categoria ?? "") || descrizione !== (esercizio.descrizione ?? ""));

  function tornaIndietro() {
    if (inModifica && haModifiche) {
      confermaAzione("Modifiche non salvate", "Vuoi scartare le modifiche fatte a questo esercizio?", "Scarta", () => router.back(), true);
    } else {
      router.back();
    }
  }

  async function salva() {
    if (!esercizio || !nome.trim()) return;
    setSalvataggio(true);
    try {
      const aggiornato = await aggiornaEsercizio(esercizio.id, { nome: nome.trim(), categoria: categoria.trim() || null, descrizione: descrizione.trim() });
      setEsercizio(aggiornato);
      setInModifica(false);
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    } finally {
      setSalvataggio(false);
    }
  }

  function chiediEliminazione() {
    if (!esercizio) return;
    confermaAzione(
      "Eliminare l'esercizio?",
      `"${esercizio.nome}" verrà eliminato definitivamente. Se è già usato in qualche allenamento, l'eliminazione verrà bloccata per non rompere lo storico.`,
      "Elimina",
      async () => {
        try {
          await eliminaEsercizio(esercizio.id);
          router.back();
        } catch (e) {
          Alert.alert("Impossibile eliminare", "Questo esercizio è probabilmente già usato in uno o più allenamenti — rimuovilo prima da lì, oppure lascialo nel catalogo senza usarlo più.");
        }
      },
      true,
    );
  }

  if (!esercizio) return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={tornaIndietro} hitSlop={12}>
          <Text style={styles.indietro}>← Esercizi</Text>
        </Pressable>
        {inModifica && (
          <Pressable onPress={chiediEliminazione}>
            <Text style={styles.elimina}>Elimina</Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {inModifica ? (
          <>
            <TextInput style={styles.input} placeholder="Nome" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} />
            <TextInput style={styles.input} placeholder="Categoria" placeholderTextColor={brand.colors.muted} value={categoria} onChangeText={setCategoria} />
            <TextInput style={[styles.input, { minHeight: 100, textAlignVertical: "top" }]} placeholder="Descrizione / istruzioni" placeholderTextColor={brand.colors.muted} multiline value={descrizione} onChangeText={setDescrizione} />
            <Pressable style={styles.bottone} onPress={salva} disabled={salvataggio || !nome.trim()}>
              {salvataggio ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Salva</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.titolo}>{esercizio.nome}</Text>
            {!!esercizio.categoria && <Text style={styles.categoria}>{esercizio.categoria}</Text>}
            <Text style={styles.descrizione}>{esercizio.descrizione || "Nessuna descrizione."}</Text>
          </>
        )}
      </ScrollView>

      {puoScrivere && !inModifica && (
        <Pressable style={styles.fabModifica} onPress={() => setInModifica(true)}>
          <Text style={styles.fabModificaTesto}>✎</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  elimina: { color: brand.colors.error, fontWeight: "600" },
  titolo: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700" },
  categoria: { color: brand.colors.brandSecondary, fontSize: 14, fontWeight: "600" },
  descrizione: { color: brand.colors.onSurfaceSecondary, fontSize: 15, lineHeight: 22 },
  input: { backgroundColor: brand.colors.surfaceSecondary, color: brand.colors.onSurface, borderRadius: 8, padding: 12 },
  bottone: { backgroundColor: brand.colors.brand, padding: 12, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  fabModifica: {
    position: "absolute", right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28,
    backgroundColor: brand.colors.brandSecondary, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 5,
  },
  fabModificaTesto: { color: "#000", fontSize: 22, fontWeight: "700" },
});
