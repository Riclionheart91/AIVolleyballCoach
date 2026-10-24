import { useState } from "react";
import { Pressable, Text, StyleSheet, View, Modal } from "react-native";
import { brand } from "@/src/config";

interface Props {
  onPress: () => void;
  /** Se ci sono due FAB nella stessa schermata (es. Rosa: aggiungi + importa), questo sposta il secondo più in alto per non sovrapporli. */
  posizione?: "principale" | "secondaria";
  icona?: string;
  colore?: string;
}

export function FabAggiungi({ onPress, posizione = "principale", icona = "+", colore }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.fab, posizione === "secondaria" && styles.fabSecondaria, colore ? { backgroundColor: colore } : null]}
    >
      <Text style={styles.fabTesto}>{icona}</Text>
    </Pressable>
  );
}

export interface VoceMenuFab { icona: string; etichetta: string; descrizione?: string; onPress: () => void }

/** Un solo "+" che apre la scelta di come procedere: al posto di piu' pulsanti tondi uno sull'altro. */
export function FabMenu({ titolo, voci }: { titolo: string; voci: VoceMenuFab[] }) {
  const [aperto, setAperto] = useState(false);
  return (
    <>
      <FabAggiungi onPress={() => setAperto(true)} />
      <Modal visible={aperto} animationType="fade" transparent onRequestClose={() => setAperto(false)}>
        <Pressable style={menu.sfondo} onPress={() => setAperto(false)}>
          <View style={menu.carta}>
            <Text style={menu.titolo}>{titolo}</Text>
            {voci.map((v) => (
              <Pressable key={v.etichetta} style={menu.voce} onPress={() => { setAperto(false); v.onPress(); }}>
                <Text style={menu.icona}>{v.icona}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={menu.etichetta}>{v.etichetta}</Text>
                  {!!v.descrizione && <Text style={menu.descrizione}>{v.descrizione}</Text>}
                </View>
              </Pressable>
            ))}
            <Pressable onPress={() => setAperto(false)}><Text style={menu.annulla}>Annulla</Text></Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/** Contenitore da avvolgere attorno all'intera schermata quando ci sono uno o più FAB, così restano ancorati in basso a destra indipendentemente dallo scroll del contenuto. */
export function ContenitoreConFab({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: brand.colors.brand,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  fabSecondaria: {
    right: 20,
    bottom: 90,
    backgroundColor: brand.colors.brandSecondary,
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  fabTesto: { color: "#000", fontSize: 26, fontWeight: "700", lineHeight: 28 },
});

const menu = StyleSheet.create({
  sfondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end", padding: 16 },
  carta: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 16, gap: 6 },
  titolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700", marginBottom: 6 },
  voce: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10, backgroundColor: brand.colors.surfaceTertiary },
  icona: { fontSize: 24 },
  etichetta: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  descrizione: { color: brand.colors.muted, fontSize: 12, marginTop: 2 },
  annulla: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 8 },
});
