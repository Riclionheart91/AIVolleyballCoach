import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { brand, contattoAmministratore } from "@/src/config";
import { avvisa } from "@/src/lib/confermaAzione";

/**
 * Prima creare una squadra era libero per chiunque avesse fatto
 * l'accesso: un problema di sicurezza reale, visto che chi crea una
 * squadra ne diventa automaticamente allenatore a pieni poteri. Ora
 * può farlo solo chi è presidente di una società — e una società
 * nasce solo per mano dell'amministratore della piattaforma.
 */
export default function CreaSquadra() {
  const { session, societaPresidenza, creaPrimaSquadra, squadreDisponibili } = useAuth();
  const [nome, setNome] = useState("");
  const [inCorso, setInCorso] = useState(false);

  async function conferma() {
    if (!nome.trim()) return;
    setInCorso(true);
    try {
      await creaPrimaSquadra(nome.trim());
      router.replace("/");
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setInCorso(false);
    }
  }

  if (!societaPresidenza) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Nessuna squadra collegata</Text>
        <Text style={styles.sottotitolo}>
          Solo il presidente di una società può creare una nuova squadra. Se dovresti far parte di una squadra già esistente, chiedi un invito a chi la gestisce; se dovresti fondarne una nuova, contatta l'amministratore della piattaforma: {contattoAmministratore.nome} ({contattoAmministratore.email}).
        </Text>
        {session?.user.email && <Text style={styles.account}>Connesso come: {session.user.email}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Nuova squadra</Text>
      <Text style={styles.sottotitolo}>Nella società "{societaPresidenza.nome}". Nascerà senza allenatore: lo assegni quando vuoi dalla Gestione società.</Text>
      {session?.user.email && <Text style={styles.account}>Connesso come: {session.user.email}</Text>}

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
        <Text style={styles.bottoneTesto}>{inCorso ? "Un attimo…" : "Crea squadra"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surface, padding: 24, gap: 16 },
  title: { color: brand.colors.onSurface, fontSize: 24, fontWeight: "700", textAlign: "center" },
  sottotitolo: { color: brand.colors.muted, textAlign: "center", maxWidth: 340, lineHeight: 20 },
  account: { color: brand.colors.muted, fontSize: 12 },
  bottoneSecondario: { borderColor: brand.colors.brandSecondary, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  bottoneSecondarioTesto: { color: brand.colors.brandSecondary, fontWeight: "600", fontSize: 13 },
  input: { width: "100%", maxWidth: 360, backgroundColor: brand.colors.surfaceSecondary, color: brand.colors.onSurface, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: brand.colors.border },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, marginTop: 4 },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
});
