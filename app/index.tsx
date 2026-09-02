import { useEffect } from "react";
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { brand } from "@/src/config";

export default function Index() {
  const { session, caricamento, team, caricamentoTeam, erroreTeam, stagioneAttiva, caricamentoStagione, ricaricaTeam } = useAuth();

  useEffect(() => {
    if (caricamento || caricamentoTeam) return; // mai decidere una rotta mentre lo stato è ancora incerto
    if (!session) { router.replace("/login"); return; }
    // Un errore vero (RLS, rete) va distinto da "non ha ancora nessuna
    // squadra": prima venivano trattati allo stesso modo, mandando
    // sempre a "crea squadra" — che nascondeva l'errore reale invece di
    // mostrarlo, rendendo impossibile capire se il problema era
    // "nessuna squadra" o "qualcosa si è rotto nel leggerla".
    if (erroreTeam) return;
    if (!team) { router.replace("/crea-squadra"); return; }
    if (caricamentoStagione) return;
    if (!stagioneAttiva) { router.replace("/apri-stagione"); return; }
    router.replace("/(tabs)");
  }, [session, caricamento, team, caricamentoTeam, erroreTeam, stagioneAttiva, caricamentoStagione]);

  if (!caricamento && !caricamentoTeam && erroreTeam) {
    return (
      <View style={styles.container}>
        <Text style={styles.titolo}>Errore nel caricamento della squadra</Text>
        <Text style={styles.errore}>{erroreTeam}</Text>
        {session?.user.email && <Text style={styles.nota}>Connesso come: {session.user.email}</Text>}
        <Pressable style={styles.bottone} onPress={() => ricaricaTeam()}>
          <Text style={styles.bottoneTesto}>Riprova</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator color={brand.colors.brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surface, padding: 24, gap: 12 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700", textAlign: "center" },
  errore: { color: brand.colors.error, fontSize: 13, textAlign: "center" },
  nota: { color: brand.colors.muted, fontSize: 12 },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, marginTop: 8 },
  bottoneTesto: { color: "#000", fontWeight: "700" },
});
