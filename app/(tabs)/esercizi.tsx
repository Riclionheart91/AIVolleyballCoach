import { useCallback, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, RefreshControl } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { creaEsercizio, elencaEsercizi } from "@/src/services/exercises";
import { FabAggiungi } from "@/src/components/Fab";
import { PopupForm } from "@/src/components/PopupForm";
import { brand } from "@/src/config";
import type { Exercise } from "@/src/types/database";

export default function Esercizi() {
  const { team, puoScrivere } = useAuth();
  const [esercizi, setEsercizi] = useState<Exercise[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [popupAperto, setPopupAperto] = useState(false);
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
    setNome(""); setCategoria(""); setPopupAperto(false);
    carica();
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={esercizi}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
        refreshControl={<RefreshControl refreshing={caricamento} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListEmptyComponent={!caricamento ? <Text style={styles.vuoto}>Nessun esercizio ancora. Usa il pulsante + qui sotto.</Text> : null}
        renderItem={({ item }) => (
          <Pressable style={styles.riga} onPress={() => router.push(`/esercizio/${item.id}`)}>
            <Text style={styles.rigaNome}>{item.nome}</Text>
            {!!item.categoria && <Text style={styles.rigaSotto}>{item.categoria}</Text>}
          </Pressable>
        )}
      />

      {puoScrivere && <FabAggiungi onPress={() => setPopupAperto(true)} />}

      <PopupForm visibile={popupAperto} titolo="Nuovo esercizio" haModifiche={!!(nome.trim() || categoria.trim())} onChiudi={() => { setPopupAperto(false); setNome(""); setCategoria(""); }}>
        <TextInput style={styles.input} placeholder="Nome esercizio" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} autoFocus />
        <TextInput style={styles.input} placeholder="Categoria (es. tecnica, atletica, tattica)" placeholderTextColor={brand.colors.muted} value={categoria} onChangeText={setCategoria} />
        <Pressable style={styles.bottone} onPress={aggiungi} disabled={!nome.trim()}>
          <Text style={styles.bottoneTesto}>Aggiungi esercizio</Text>
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
  riga: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaNome: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  rigaSotto: { color: brand.colors.muted, fontSize: 13 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
});
