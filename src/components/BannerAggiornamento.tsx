import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SECONDI_ATTESA, aggiornaOra, azioniInAttesaOra, avviaControlloAggiornamenti, useAggiornamentoApp } from "@/src/lib/aggiornamentoApp";

/** Avviso "c'è una versione nuova dell'app": conto alla rovescia e ricarica, oppure solo avviso se si sta registrando una partita. */
export function BannerAggiornamento() {
  const { disponibile, partitaInCorso, azioniInAttesa } = useAggiornamentoApp();
  const [secondi, setSecondi] = useState(SECONDI_ATTESA);
  const protetto = partitaInCorso || azioniInAttesa > 0;

  useEffect(() => { avviaControlloAggiornamenti(); }, []);

  useEffect(() => {
    if (!disponibile || protetto) { setSecondi(SECONDI_ATTESA); return; }
    const timer = setInterval(() => {
      setSecondi((s) => {
        if (s <= 1) {
          // Appena comparse azioni da inviare, si aspetta ancora.
          if (azioniInAttesaOra() > 0) return SECONDI_ATTESA;
          clearInterval(timer); aggiornaOra(); return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [disponibile, protetto]);

  if (!disponibile) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.testo}>
        {protetto
          ? "È disponibile una versione nuova dell'app. Per non interrompere la partita si aggiorna quando hai finito: puoi anche farlo ora."
          : `È disponibile una versione nuova dell'app: si aggiorna tra ${secondi} s.`}
      </Text>
      <Pressable onPress={aggiornaOra} style={styles.tasto}>
        <Text style={styles.tastoTesto}>Aggiorna ora</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 9999, backgroundColor: "#32ADE6",
    paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 10,
  },
  testo: { flex: 1, color: "#000", fontSize: 13, fontWeight: "600" },
  tasto: { backgroundColor: "#000", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  tastoTesto: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
