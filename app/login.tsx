import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { richiediResetAccesso } from "@/src/services/accessi";
import { brand, uiStrings } from "@/src/config";

export default function Login() {
  const { session, accediConGoogle, accediConPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mostraPassword, setMostraPassword] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [resetAperto, setResetAperto] = useState(false);
  const [resetInviato, setResetInviato] = useState(false);

  useEffect(() => {
    if (session) router.replace("/");
  }, [session]);

  async function entra() {
    if (!email.trim() || !password) return;
    setErrore(null);
    setInCorso(true);
    try {
      await accediConPassword(email, password);
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setInCorso(false);
    }
  }

  async function chiediReset() {
    if (!email.trim()) { setErrore("Scrivi l'email con cui entri."); return; }
    setErrore(null);
    setInCorso(true);
    try {
      await richiediResetAccesso(email);
    } catch {
      // Di proposito nessuna differenza visibile: non si deve capire se l'email esiste.
    } finally {
      setInCorso(false);
      setResetInviato(true);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{uiStrings.auth.loginTitle}</Text>
      <Pressable style={styles.bottone} onPress={accediConGoogle}>
        <Text style={styles.bottoneTesto}>{uiStrings.auth.loginGoogle}</Text>
      </Pressable>

      <Text style={styles.oppure}>oppure con email e password</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={brand.colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="username"
        value={email}
        onChangeText={(v) => { setEmail(v); setResetInviato(false); }}
      />
      {!resetAperto && (
        <View style={styles.rigaPassword}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Password"
            placeholderTextColor={brand.colors.muted}
            secureTextEntry={!mostraPassword}
            autoCapitalize="none"
            textContentType="password"
            autoComplete="current-password"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={entra}
          />
          <Pressable onPress={() => setMostraPassword(!mostraPassword)} hitSlop={8}>
            <Text style={styles.link}>{mostraPassword ? "Nascondi" : "Mostra"}</Text>
          </Pressable>
        </View>
      )}

      {errore && <Text style={styles.errore}>{errore}</Text>}

      {resetAperto ? (
        <>
          <Text style={styles.nota}>
            Scrivi l'email con cui entri e chiedi il reset: l'allenatore o il presidente riceve la richiesta e, se la conferma, ti manda su WhatsApp un nuovo link.
          </Text>
          {resetInviato && <Text style={styles.ok}>Se l'email è in anagrafica, l'allenatore riceverà la richiesta.</Text>}
          <Pressable style={styles.bottoneSecondario} onPress={chiediReset} disabled={inCorso}>
            {inCorso ? <ActivityIndicator color={brand.colors.brand} /> : <Text style={styles.bottoneSecondarioTesto}>Chiedi il reset</Text>}
          </Pressable>
          <Pressable onPress={() => { setResetAperto(false); setResetInviato(false); setErrore(null); }}>
            <Text style={styles.link}>Torna all'accesso</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable style={styles.bottoneSecondario} onPress={entra} disabled={inCorso || !email.trim() || !password}>
            {inCorso ? <ActivityIndicator color={brand.colors.brand} /> : <Text style={styles.bottoneSecondarioTesto}>Entra con email e password</Text>}
          </Pressable>
          <Pressable onPress={() => { setResetAperto(true); setErrore(null); }}>
            <Text style={styles.link}>Password dimenticata?</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surface, padding: 24, gap: 14 },
  title: { color: brand.colors.onSurface, fontSize: 28, fontWeight: "700" },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, marginTop: 12 },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
  oppure: { color: brand.colors.muted, fontSize: 13, marginTop: 8 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, width: "100%", maxWidth: 320, fontSize: 16 },
  rigaPassword: { flexDirection: "row", alignItems: "center", gap: 10, width: "100%", maxWidth: 320 },
  bottoneSecondario: { borderColor: brand.colors.brand, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, minWidth: 220, alignItems: "center" },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "600" },
  link: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "600" },
  nota: { color: brand.colors.muted, textAlign: "center", maxWidth: 320, fontSize: 13 },
  ok: { color: brand.colors.onSurface, textAlign: "center", maxWidth: 320 },
  errore: { color: brand.colors.error, textAlign: "center", maxWidth: 320 },
});
