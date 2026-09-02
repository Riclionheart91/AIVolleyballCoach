import { Alert, Platform } from "react-native";

/**
 * Alert.alert con più pulsanti (Annulla/Conferma) su web, tramite
 * react-native-web, spesso non risponde ai tap in modo affidabile —
 * limite noto della libreria, non uno specifico bug nostro. Sintomo
 * tipico: un pulsante "Chiudi" o "Termina" che sembra non fare nulla.
 * Questo helper usa window.confirm() nativo del browser su web (che
 * FUNZIONA sempre, essendo bloccante e gestito dal browser stesso) e
 * Alert.alert normale su nativo (dove invece funziona bene).
 */
export function confermaAzione(titolo: string, messaggio: string, testoConferma: string, onConferma: () => void, distruttivo = false): void {
  if (Platform.OS === "web") {
    if (window.confirm(`${titolo}\n\n${messaggio}`)) onConferma();
    return;
  }
  Alert.alert(titolo, messaggio, [
    { text: "Annulla", style: "cancel" },
    { text: testoConferma, style: distruttivo ? "destructive" : "default", onPress: onConferma },
  ]);
}
