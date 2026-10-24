import { View, Text, Pressable, StyleSheet, Modal } from "react-native";
import { brand } from "@/src/config";
import type { Ambito } from "@/src/services/pianiIndividuali";

/**
 * Un piano condiviso da piu' persone: prima di cambiarlo si sceglie se la modifica vale solo per la persona
 * che si sta guardando o per tutto il gruppo.
 */
export function SceltaAmbito({ visibile, titolo, testo, nomePersona, persone, distruttiva, onScegli, onAnnulla }: {
  visibile: boolean; titolo: string; testo?: string; nomePersona: string; persone: number; distruttiva?: boolean;
  onScegli: (ambito: Ambito) => void; onAnnulla: () => void;
}) {
  const prima = nomePersona.split(" ")[0];
  return (
    <Modal visible={visibile} animationType="fade" transparent onRequestClose={onAnnulla}>
      <View style={styles.sfondo}>
        <View style={styles.carta}>
          <Text style={styles.titolo}>{titolo}</Text>
          {!!testo && <Text style={styles.nota}>{testo}</Text>}
          <Text style={styles.nota}>Questo piano è condiviso da {persone} persone. Cosa vuoi cambiare?</Text>
          <Pressable style={[styles.bottone, distruttiva && styles.bottoneDistruttivo]} onPress={() => onScegli("gruppo")}>
            <Text style={[styles.bottoneTesto, distruttiva && styles.bottoneTestoDistruttivo]}>👥 Per tutte le {persone} persone</Text>
          </Pressable>
          <Pressable style={styles.bottoneSecondario} onPress={() => onScegli("singolo")}>
            <Text style={styles.bottoneSecondarioTesto}>Solo per {prima}</Text>
          </Pressable>
          <Pressable onPress={onAnnulla}><Text style={styles.annulla}>Annulla</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sfondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 },
  carta: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 18, gap: 10 },
  titolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  nota: { color: brand.colors.muted, fontSize: 13, lineHeight: 18 },
  bottone: { backgroundColor: brand.colors.brand, padding: 12, borderRadius: 10, alignItems: "center" },
  bottoneDistruttivo: { backgroundColor: brand.colors.error },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  bottoneTestoDistruttivo: { color: "#fff" },
  bottoneSecondario: { borderWidth: 1, borderColor: brand.colors.brand, padding: 12, borderRadius: 10, alignItems: "center" },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "700" },
  annulla: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 4 },
});
