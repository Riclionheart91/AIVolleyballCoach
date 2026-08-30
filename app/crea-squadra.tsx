import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { brand, uiStrings } from "@/src/config";

export default function CreaSquadra() {
  const { creaPrimaSquadra } = useAuth();
  const [nome, setNome] = useState("");
  const [inCorso, setInCorso] = useState(false);

  async function conferma() {
    if (!nome.trim()) return;
    setInCorso(true);
    try {
      await creaPrimaSquadra(nome.trim());
      // Reindirizza a "/" e non direttamente a "/(tabs)": è app/index.tsx
      // a decidere il prossimo passo in base a stagioneAttiva. Andare
      // dritti alle tabs qui saltava del tutto il gate "apri una
      // stagione prima di entrare" — la causa esatta del bug segnalato.
      router.replace("/");
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    } finally {
      setInCorso(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{uiStrings.auth.createTeam}</Text>
      <Text style={styles.sottotitolo}>{uiStrings.auth.noTeam} Diventerai automaticamente allenatore.</Text>
      <TextInput
        style={styles.input}
        placeholder="Nome squadra (es. Volley Bologna U18)"
        placeholderTextColor={brand.colors.muted}
        value={nome}
        onChangeText={setNome}
      />
      <Pressable style={styles.bottone} onPress={conferma} disabled={inCorso}>
        <Text style={styles.bottoneTesto}>{inCorso ? uiStrings.common.loading : "Crea squadra"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surface, padding: 24, gap: 16 },
  title: { color: brand.colors.onSurface, fontSize: 24, fontWeight: "700", textAlign: "center" },
  sottotitolo: { color: brand.colors.muted, textAlign: "center", maxWidth: 320 },
  input: { width: "100%", maxWidth: 360, backgroundColor: brand.colors.surfaceSecondary, color: brand.colors.onSurface, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: brand.colors.border },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, marginTop: 4 },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
});
