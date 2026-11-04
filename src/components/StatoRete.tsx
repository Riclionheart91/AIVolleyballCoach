import { useEffect, useState } from "react";
import { Text, StyleSheet } from "react-native";
import { brand } from "@/src/config";
import { iscriviStato, statoCoda, type StatoCoda } from "@/src/lib/codaOffline";

/**
 * Stato dell'invio dei salvataggi dello scouting, in poche parole:
 * "Offline · 3 da inviare", "Invio… 2 da inviare", "3 da inviare" oppure, per qualche secondo, "Tutto inviato".
 * Se non c'e' niente da dire non mostra nulla.
 *
 * Non occupa uno spazio suo: e' un testo "incastrato" (da mettere DENTRO un <Text> gia' presente, come
 * la riga del servizio), quindi non sposta ne' ridimensiona nessun tasto. Con `separatore` aggiunge " · " dopo,
 * per continuare la riga esistente.
 */
export function StatoRete({ matchId, separatore = true }: { matchId: string; separatore?: boolean }) {
  const [stato, setStato] = useState<StatoCoda>(() => statoCoda(matchId));

  useEffect(() => {
    const aggiorna = () => setStato(statoCoda(matchId));
    aggiorna();
    return iscriviStato(matchId, aggiorna);
  }, [matchId]);

  if (stato.daInviare === 0 && !stato.tuttoInviato) return null;

  let testo: string;
  let colore: string = brand.colors.muted;
  if (stato.daInviare === 0) {
    testo = "Tutto inviato";
    colore = brand.colors.success;
  } else if (stato.offline) {
    testo = `Offline · ${stato.daInviare} da inviare`;
    colore = brand.colors.warning;
  } else if (stato.inInvio) {
    testo = `Invio… ${stato.daInviare} da inviare`;
  } else {
    testo = `${stato.daInviare} da inviare`;
    colore = brand.colors.warning;
  }

  return (
    <Text style={[styles.testo, { color: colore }]} accessibilityLiveRegion="polite">
      {testo}{separatore ? " · " : ""}
    </Text>
  );
}

const styles = StyleSheet.create({
  testo: { fontWeight: "700" },
});
