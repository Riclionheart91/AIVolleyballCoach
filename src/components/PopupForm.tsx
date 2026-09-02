import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { brand } from "@/src/config";
import { confermaAzione } from "@/src/lib/confermaAzione";

interface Props {
  visibile: boolean;
  titolo: string;
  /** true se l'utente ha iniziato a scrivere qualcosa: alla chiusura, chiede conferma invece di scartare in silenzio. */
  haModifiche?: boolean;
  onChiudi: () => void;
  children: React.ReactNode;
}

/**
 * Popup usato ovunque un pulsante "+" apre un form (crea atleta,
 * esercizio, stagione, allenamento...). Il tasto "X" in alto chiude
 * senza salvare — se ci sono modifiche non salvate, chiede conferma
 * prima di scartarle, invece di perderle in silenzio.
 */
export function PopupForm({ visibile, titolo, haModifiche = false, onChiudi, children }: Props) {
  function chiediChiusura() {
    if (haModifiche) {
      confermaAzione("Annullare?", "Le modifiche non salvate andranno perse.", "Annulla modifiche", onChiudi, true);
    } else {
      onChiudi();
    }
  }

  return (
    <Modal visible={visibile} animationType="slide" transparent onRequestClose={chiediChiusura}>
      <View style={styles.sfondo}>
        <View style={styles.cartaPopup}>
          <View style={styles.intestazione}>
            <Text style={styles.titolo}>{titolo}</Text>
            <Pressable onPress={chiediChiusura} hitSlop={12}>
              <Text style={styles.chiudi}>✕</Text>
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sfondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12, maxHeight: "85%" },
  intestazione: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titolo: { color: brand.colors.onSurface, fontSize: 18, fontWeight: "700" },
  chiudi: { color: brand.colors.muted, fontSize: 20 },
});
