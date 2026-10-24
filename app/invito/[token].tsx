import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/src/context/AuthContext";
import { CHIAVE_INVITO_LINK, accettaInvitoLink, anteprimaInvitoLink, type RuoloStaff } from "@/src/services/teamInvites";
import { brand, etichetteRuolo } from "@/src/config";

/**
 * Ingresso dello staff con link: chi lo riceve (su WhatsApp, per esempio) lo apre qui,
 * accede con il suo account Google e entra nella squadra con il ruolo indicato nel link.
 */
export default function IngressoInvito() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session, caricamento, accediConGoogle, esci, cambiaSquadra } = useAuth();
  const [anteprima, setAnteprima] = useState<{ team_nome: string; ruolo: RuoloStaff } | null | undefined>(undefined);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const haAccountVero = !!session && !(session.user as { is_anonymous?: boolean }).is_anonymous;

  useEffect(() => {
    if (!token) return;
    anteprimaInvitoLink(String(token)).then(setAnteprima).catch(() => setAnteprima(null));
  }, [token]);

  async function entraConGoogle() {
    if (!token) return;
    // Il giro di Google riporta alla home: il link si ricorda qui e viene usato appena l'accesso e' fatto.
    await AsyncStorage.setItem(CHIAVE_INVITO_LINK, String(token));
    await accediConGoogle();
  }

  async function entraConQuestoAccount() {
    if (!token) return;
    setErrore(null);
    setInCorso(true);
    try {
      const teamId = await accettaInvitoLink(String(token));
      await cambiaSquadra(teamId);
      router.replace("/");
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setInCorso(false);
    }
  }

  async function usaAltroAccount() {
    if (!token) return;
    await AsyncStorage.setItem(CHIAVE_INVITO_LINK, String(token));
    await esci();
    await accediConGoogle();
  }

  if (caricamento || anteprima === undefined) {
    return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} /></View>;
  }

  if (!anteprima) {
    return (
      <View style={styles.container}>
        <Text style={styles.titolo}>Invito non valido</Text>
        <Text style={styles.testo}>Questo link è scaduto, è già stato usato oppure non è corretto. Chiedi a chi ti ha invitato di mandartene uno nuovo.</Text>
        <Pressable style={styles.bottoneSecondario} onPress={() => router.replace("/")}>
          <Text style={styles.bottoneSecondarioTesto}>Vai all'app</Text>
        </Pressable>
      </View>
    );
  }

  const ruolo = (etichetteRuolo[anteprima.ruolo] ?? anteprima.ruolo).toLowerCase();

  return (
    <View style={styles.container}>
      <Text style={styles.titolo}>Sei stato invitato</Text>
      <Text style={styles.testo}>
        Entrerai nella squadra <Text style={styles.evidenza}>{anteprima.team_nome}</Text> come <Text style={styles.evidenza}>{ruolo}</Text>.
      </Text>

      {haAccountVero ? (
        <>
          <Text style={styles.testo}>Su questo dispositivo sei collegato come {session?.user.email}.</Text>
          <Pressable style={styles.bottone} onPress={entraConQuestoAccount} disabled={inCorso}>
            <Text style={styles.bottoneTesto}>{inCorso ? "Un attimo…" : `Entra come ${session?.user.email}`}</Text>
          </Pressable>
          <Pressable onPress={usaAltroAccount}><Text style={styles.link}>Usa un altro account Google</Text></Pressable>
        </>
      ) : (
        <>
          <Text style={styles.testo}>Accedi con il tuo account Google: l'invito si abbina da solo, qualunque sia la tua email.</Text>
          <Pressable style={styles.bottone} onPress={entraConGoogle}>
            <Text style={styles.bottoneTesto}>Accedi con Google ed entra</Text>
          </Pressable>
        </>
      )}
      {errore && <Text style={styles.errore}>{errore}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surface, padding: 24, gap: 14 },
  titolo: { color: brand.colors.onSurface, fontSize: 24, fontWeight: "700", textAlign: "center" },
  testo: { color: brand.colors.onSurfaceSecondary, textAlign: "center", maxWidth: 340, fontSize: 15 },
  evidenza: { color: brand.colors.onSurface, fontWeight: "700" },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, marginTop: 8 },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 16, textAlign: "center" },
  bottoneSecondario: { borderColor: brand.colors.brand, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "600" },
  link: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "600" },
  errore: { color: brand.colors.error, textAlign: "center", maxWidth: 340 },
});
