import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { supabaseClient } from "@/src/lib/supabase";
import { agganciaScoutQr } from "@/src/services/scoutQr";
import { brand } from "@/src/config";

const CHIAVE_NOME_SCOUT = "scout_qr_nome";

function nomeSalvato(): string {
  try { return (typeof window !== "undefined" && window.localStorage.getItem(CHIAVE_NOME_SCOUT)) || ""; } catch { return ""; }
}

/**
 * Ingresso dello scout SENZA account: si arriva dal QR (o dal link) della partita,
 * si scrive il proprio nome e si entra con un accesso anonimo, valido per quella partita
 * finche' non e' conclusa.
 */
export default function IngressoScout() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session, caricamento, esci } = useAuth();
  const [nome, setNome] = useState(nomeSalvato());
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const haAccountVero = !!session && !(session.user as { is_anonymous?: boolean }).is_anonymous;

  async function entra() {
    if (!token) return;
    setErrore(null);
    if (nome.trim().length < 2) { setErrore("Scrivi il tuo nome (almeno 2 lettere)."); return; }
    setInCorso(true);
    try {
      if (!session) {
        const { error } = await supabaseClient.auth.signInAnonymously();
        if (error) throw new Error(error.message.toLowerCase().includes("anonymous") ? "L'accesso senza account non è attivo: avvisa l'allenatore." : error.message);
      }
      const matchId = await agganciaScoutQr(String(token), nome.trim());
      try { if (typeof window !== "undefined") window.localStorage.setItem(CHIAVE_NOME_SCOUT, nome.trim()); } catch { /* il nome non si ricorda, pazienza */ }
      router.replace(`/partita/${matchId}?ospite=1`);
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setInCorso(false);
    }
  }

  if (caricamento) return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} /></View>;

  if (haAccountVero) {
    return (
      <View style={styles.container}>
        <Text style={styles.titolo}>Sei già collegato</Text>
        <Text style={styles.testo}>
          Su questo dispositivo sei entrato con l'account {session?.user.email ?? ""}. Per fare lo scout senza account devi uscire,
          oppure aprire il link in una finestra privata.
        </Text>
        <Pressable style={styles.bottone} onPress={esci}>
          <Text style={styles.bottoneTesto}>Esci e continua come scout</Text>
        </Pressable>
        <Pressable onPress={() => router.replace("/")}><Text style={styles.link}>Torna all'app</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.titolo}>Scout della partita</Text>
      <Text style={styles.testo}>
        Sei stato invitato a registrare una partita. Scrivi il tuo nome: lo staff vedrà chi sta registrando. Non serve nessun account.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Il tuo nome"
        placeholderTextColor={brand.colors.muted}
        value={nome}
        onChangeText={setNome}
        maxLength={40}
        autoFocus
        onSubmitEditing={entra}
      />
      {errore && <Text style={styles.errore}>{errore}</Text>}
      <Pressable style={[styles.bottone, inCorso && { opacity: 0.6 }]} onPress={entra} disabled={inCorso}>
        <Text style={styles.bottoneTesto}>{inCorso ? "Un attimo…" : "Entra"}</Text>
      </Pressable>
      <Text style={styles.nota}>L'accesso vale solo per questa partita e finisce quando l'allenatore la chiude.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surface, padding: 24, gap: 14 },
  titolo: { color: brand.colors.onSurface, fontSize: 24, fontWeight: "700", textAlign: "center" },
  testo: { color: brand.colors.muted, textAlign: "center", maxWidth: 340, lineHeight: 20 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 10, padding: 14, width: "100%", maxWidth: 340, fontSize: 16 },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 10, alignItems: "center", width: "100%", maxWidth: 340 },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
  errore: { color: brand.colors.error, textAlign: "center", maxWidth: 340 },
  nota: { color: brand.colors.muted, fontSize: 12, textAlign: "center", maxWidth: 340 },
  link: { color: brand.colors.brandSecondary, textDecorationLine: "underline" },
});
