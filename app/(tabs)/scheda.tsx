import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useAuth } from "@/src/context/AuthContext";
import { PianiIndividuali } from "@/src/components/PianiIndividuali";
import { brand } from "@/src/config";

/**
 * Scheda personale di chi gioca: è la prima cosa che vede aprendo
 * l'app. Contiene il lavoro che riguarda lei o lui soltanto, separato
 * dalle valutazioni perché risponde a una domanda diversa: non "come
 * sto andando" ma "cosa devo fare".
 */
export default function SchedaPersonale() {
  const { team, atletaId, ruolo } = useAuth();

  if (ruolo !== "atleta" || !atletaId || !team) {
    return (
      <View style={styles.container}>
        <Text style={styles.vuoto}>Questa scheda è riservata a chi gioca.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contenuto}>
      <Text style={styles.titolo}>Il mio allenamento</Text>
      <Text style={styles.nota}>
        Gli esercizi assegnati dall'allenatore sulle aree da migliorare. Segna le sedute svolte man mano: serve a te per non perdere il filo e allo staff per capire come sta andando.
      </Text>
      <PianiIndividuali teamId={team.id} athleteId={atletaId} nomePersona="" ruolo={null} modificabile={false} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  contenuto: { padding: 16, gap: 12, paddingBottom: 60 },
  titolo: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700" },
  nota: { color: brand.colors.muted, fontSize: 13, lineHeight: 19 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 40 },
});
