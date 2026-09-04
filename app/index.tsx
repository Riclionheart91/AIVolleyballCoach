import { useEffect } from "react";
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { brand } from "@/src/config";

export default function Index() {
  const { session, caricamento, team, caricamentoContesto, erroreTeam, stagioneAttiva, ricaricaContesto } = useAuth();

  useEffect(() => {
    // caricamentoContesto copre SIA squadra SIA stagione in un colpo
    // solo: finché è true, lo stato non è ancora affidabile e non si
    // decide nessuna rotta — elimina la finestra in cui squadra e
    // stagione potevano essere lette in momenti diversi e risultare
    // disallineate (causa del bug "nessuna stagione aperta" mostrato
    // per errore).
    if (caricamento || caricamentoContesto) return;
    if (!session) { router.replace("/login"); return; }
    if (erroreTeam) return; // errore vero, distinto da "nessuna squadra": si mostra sotto, non si reindirizza alla cieca
    if (!team) { router.replace("/crea-squadra"); return; }
    if (!stagioneAttiva) { router.replace("/apri-stagione"); return; }
    router.replace("/(tabs)");
  }, [session, caricamento, team, caricamentoContesto, erroreTeam, stagioneAttiva]);

  if (!caricamento && !caricamentoContesto && erroreTeam) {
    return (
      <View style={styles.container}>
        <Text style={styles.titolo}>Errore nel caricamento della squadra</Text>
        <Text style={styles.errore}>{erroreTeam}</Text>
        {session?.user.email && <Text style={styles.nota}>Connesso come: {session.user.email}</Text>}
        <Pressable style={styles.bottone} onPress={() => ricaricaContesto()}>
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
