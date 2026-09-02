import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { brand, uiStrings } from "@/src/config";

export default function CreaSquadra() {
  const { session, creaPrimaSquadra, squadreDisponibili } = useAuth();
  const [nome, setNome] = useState("");
  const [inCorso, setInCorso] = useState(false);

  async function conferma() {
    if (!nome.trim()) return;
    setInCorso(true);
    try {
      await creaPrimaSquadra(nome.trim());
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
      {session?.user.email && <Text style={styles.account}>Connesso come: {session.user.email}</Text>}

      {/* Rete di sicurezza: se per qualunque motivo sei arrivata qui pur
          avendo già delle squadre (bug, dato non ancora ricaricato...),
          non sei costretta a crearne una nuova per sbaglio. */}
      {squadreDisponibili.length > 0 && (
        <Pressable style={styles.bottoneSecondario} onPress={() => router.push("/seleziona-squadra")}>
          <Text style={styles.bottoneSecondarioTesto}>Ho già {squadreDisponibili.length === 1 ? "una squadra" : "delle squadre"} — falla vedere</Text>
        </Pressable>
      )}

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
  account: { color: brand.colors.muted, fontSize: 12 },
  bottoneSecondario: { borderColor: brand.colors.brandSecondary, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  bottoneSecondarioTesto: { color: brand.colors.brandSecondary, fontWeight: "600", fontSize: 13 },
  input: { width: "100%", maxWidth: 360, backgroundColor: brand.colors.surfaceSecondary, color: brand.colors.onSurface, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: brand.colors.border },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, marginTop: 4 },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
});
