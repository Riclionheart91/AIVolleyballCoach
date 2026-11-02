import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, TextInput, ScrollView } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { anteprimaLinkAccesso, attivaAccesso, ERRORE_USA_GOOGLE, type AnteprimaLinkAccesso } from "@/src/services/accessi";
import { brand, etichetteRuolo } from "@/src/config";

const LUNGHEZZA_MINIMA = 8;

/**
 * Pagina del link personale mandato su WhatsApp: chi lo apre sceglie la password.
 * L'email e' quella dell'anagrafica e non si cambia (si scrive solo quando lo staff e' stato invitato senza email).
 */
export default function AccessoDaLink() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { caricamento, accediConGoogle, accediConPassword, cambiaSquadra } = useAuth();
  const [anteprima, setAnteprima] = useState<AnteprimaLinkAccesso | null | undefined>(undefined);
  const [emailLibera, setEmailLibera] = useState("");
  const [password, setPassword] = useState("");
  const [conferma, setConferma] = useState("");
  const [mostra, setMostra] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [usaGoogle, setUsaGoogle] = useState(false);
  const [inCorso, setInCorso] = useState(false);

  useEffect(() => {
    if (!token) return;
    anteprimaLinkAccesso(String(token)).then(setAnteprima).catch(() => setAnteprima(null));
  }, [token]);

  if (caricamento || anteprima === undefined) {
    return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} /></View>;
  }

  if (!anteprima) {
    return (
      <View style={styles.container}>
        <Text style={styles.titolo}>Link non valido</Text>
        <Text style={styles.testo}>Questo link è scaduto, è già stato usato oppure non è corretto. Chiedi a chi te lo ha mandato un nuovo link di accesso.</Text>
        <Pressable style={styles.bottoneSecondario} onPress={() => router.replace("/login")}>
          <Text style={styles.bottoneSecondarioTesto}>Vai all'accesso</Text>
        </Pressable>
      </View>
    );
  }

  const info = anteprima;
  const eReset = info.tipo === "reset";
  const ruolo = (etichetteRuolo[info.ruolo] ?? info.ruolo).toLowerCase();
  const emailUsata = info.email_libera ? emailLibera.trim().toLowerCase() : (info.email ?? "");
  const emailValida = /^\S+@\S+\.\S+$/.test(emailUsata);
  const passwordValida = password.length >= LUNGHEZZA_MINIMA && password === conferma;
  const pronto = emailValida && passwordValida && !inCorso;

  async function conferma_() {
    if (!token || !pronto) return;
    setErrore(null);
    setInCorso(true);
    try {
      const esito = await attivaAccesso(String(token), password, info.email_libera ? emailUsata : undefined);
      await accediConPassword(esito.email, password);
      await cambiaSquadra(esito.team_id);
      router.replace("/");
    } catch (e) {
      const messaggio = (e as Error).message;
      const googleRichiesto = messaggio.includes(ERRORE_USA_GOOGLE) || /google/i.test(messaggio);
      setUsaGoogle(googleRichiesto);
      setErrore(googleRichiesto ? "Questa email usa un account Google: accedi con Google." : messaggio);
    } finally {
      setInCorso(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.titolo}>{eReset ? "Nuova password" : "Crea il tuo accesso"}</Text>
      <Text style={styles.testo}>
        {info.nome ? <Text style={styles.evidenza}>{info.nome}, </Text> : null}
        squadra <Text style={styles.evidenza}>{info.team_nome}</Text> · {ruolo}.
      </Text>

      <Text style={styles.etichetta}>Email per entrare</Text>
      {info.email_libera ? (
        <TextInput
          style={styles.input}
          placeholder="La tua email"
          placeholderTextColor={brand.colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          autoComplete="username"
          value={emailLibera}
          onChangeText={setEmailLibera}
        />
      ) : (
        <View style={[styles.input, styles.inputBloccato]}>
          <Text style={styles.emailBloccata}>{info.email}</Text>
          <Text style={styles.piccolo}>È l'email in anagrafica: non si può cambiare.</Text>
        </View>
      )}

      <Text style={styles.etichetta}>Scegli la password (almeno {LUNGHEZZA_MINIMA} caratteri)</Text>
      <View style={styles.rigaPassword}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Password"
          placeholderTextColor={brand.colors.muted}
          secureTextEntry={!mostra}
          autoCapitalize="none"
          textContentType="newPassword"
          autoComplete="new-password"
          value={password}
          onChangeText={setPassword}
        />
        <Pressable onPress={() => setMostra(!mostra)} hitSlop={8}>
          <Text style={styles.link}>{mostra ? "Nascondi" : "Mostra"}</Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.input}
        placeholder="Ripeti la password"
        placeholderTextColor={brand.colors.muted}
        secureTextEntry={!mostra}
        autoCapitalize="none"
        textContentType="newPassword"
        autoComplete="new-password"
        value={conferma}
        onChangeText={setConferma}
        onSubmitEditing={conferma_}
      />
      {conferma.length > 0 && password !== conferma && <Text style={styles.errore}>Le due password non coincidono.</Text>}

      <Pressable style={[styles.bottone, !pronto && { opacity: 0.5 }]} onPress={conferma_} disabled={!pronto}>
        <Text style={styles.bottoneTesto}>{inCorso ? "Un attimo…" : eReset ? "Imposta la nuova password" : "Crea il mio accesso"}</Text>
      </Pressable>

      {errore && <Text style={styles.errore}>{errore}</Text>}
      {usaGoogle && (
        <Pressable style={styles.bottoneSecondario} onPress={accediConGoogle}>
          <Text style={styles.bottoneSecondarioTesto}>Accedi con Google</Text>
        </Pressable>
      )}

      <Text style={styles.piccolo}>
        Consiglio: quando il telefono lo propone, salva la password nel gestore password (Password di iCloud o Gestore password di Google): non dovrai ricordarla.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surface, padding: 24, gap: 12 },
  titolo: { color: brand.colors.onSurface, fontSize: 24, fontWeight: "700", textAlign: "center" },
  testo: { color: brand.colors.onSurfaceSecondary, textAlign: "center", maxWidth: 340, fontSize: 15 },
  evidenza: { color: brand.colors.onSurface, fontWeight: "700" },
  etichetta: { color: brand.colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600", width: "100%", maxWidth: 320, marginTop: 6 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, width: "100%", maxWidth: 320, fontSize: 16 },
  inputBloccato: { gap: 2 },
  emailBloccata: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  rigaPassword: { flexDirection: "row", alignItems: "center", gap: 10, width: "100%", maxWidth: 320 },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, marginTop: 8 },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 16, textAlign: "center" },
  bottoneSecondario: { borderColor: brand.colors.brand, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "600" },
  link: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "600" },
  piccolo: { color: brand.colors.muted, fontSize: 12, maxWidth: 320, textAlign: "center" },
  errore: { color: brand.colors.error, textAlign: "center", maxWidth: 320 },
});
