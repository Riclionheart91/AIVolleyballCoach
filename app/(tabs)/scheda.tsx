import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useAuth } from "@/src/context/AuthContext";
import { PianiIndividuali } from "@/src/components/PianiIndividuali";
import { TitoloGrande } from "@/src/components/TitoloGrande";
import { brand } from "@/src/config";
import { SPAZIO_BARRA } from "@/src/lib/spazioBarra";

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
      <View style={styles.colonna}>
        <TitoloGrande titolo="Il mio allenamento" />
        <View style={styles.schedaNota}>
          <Text style={styles.nota}>
            Gli esercizi assegnati dall'allenatore sulle aree da migliorare. Segna le sedute svolte man mano: serve a te per non perdere il filo e allo staff per capire come sta andando.
          </Text>
        </View>
        <PianiIndividuali teamId={team.id} athleteId={atletaId} nomePersona="" ruolo={null} modificabile={false} sempreEsploso />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  contenuto: { padding: 16, paddingBottom: SPAZIO_BARRA },
  colonna: { width: "100%", maxWidth: 900, alignSelf: "center", gap: 14 },
  schedaNota: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 16 },
  nota: { color: brand.colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 40 },
});
