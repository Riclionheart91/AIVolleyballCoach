import { useCallback, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { creaEsercizio, elencaEsercizi } from "@/src/services/exercises";
import { brand } from "@/src/config";
import type { Exercise } from "@/src/types/database";

export default function Esercizi() {
  const { team, puoScrivere } = useAuth();
  const [esercizi, setEsercizi] = useState<Exercise[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      setEsercizi(await elencaEsercizi(team.id));
    } finally {
      setCaricamento(false);
    }
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function aggiungi() {
    if (!team || !nome.trim()) return;
    await creaEsercizio(team.id, { nome: nome.trim(), categoria: categoria.trim() || null, descrizione: "" });
    setNome(""); setCategoria("");
    carica();
  }

  return (
    <View style={styles.container}>
      {puoScrivere && (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder="Nome esercizio" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} />
          <TextInput style={styles.input} placeholder="Categoria (es. tecnica, atletica, tattica)" placeholderTextColor={brand.colors.muted} value={categoria} onChangeText={setCategoria} />
          <Pressable style={styles.bottone} onPress={aggiungi}>
            <Text style={styles.bottoneTesto}>Aggiungi esercizio</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={esercizi}
        keyExtractor={(e) => e.id}
        refreshControl={<RefreshControl refreshing={caricamento} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListEmptyComponent={!caricamento ? <Text style={styles.vuoto}>Nessun esercizio ancora nel catalogo.</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.riga}>
            <Text style={styles.rigaNome}>{item.nome}</Text>
            {!!item.categoria && <Text style={styles.rigaSotto}>{item.categoria}</Text>}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface, padding: 16, gap: 16 },
  form: { gap: 8, backgroundColor: brand.colors.surfaceSecondary, padding: 12, borderRadius: 12 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  bottone: { backgroundColor: brand.colors.brand, padding: 10, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  riga: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaNome: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  rigaSotto: { color: brand.colors.muted, fontSize: 13 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
});
