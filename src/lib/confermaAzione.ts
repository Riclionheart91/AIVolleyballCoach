import { Alert, Platform } from "react-native";

/**
 * Equivalente di Alert.alert che funziona ANCHE su web.
 *
 * react-native-web non implementa affatto il modulo Alert: ogni
 * chiamata ad Alert.alert() è un'operazione a vuoto, senza errori e
 * senza alcun messaggio a schermo. È la causa di tutta la famiglia di
 * sintomi "premo il pulsante e sembra non fare nulla": l'azione
 * veniva eseguita (o falliva), ma né la conferma né l'errore
 * comparivano mai. Su web usiamo window.alert, su nativo Alert.alert.
 */
export function avvisa(titolo: string, messaggio?: string): void {
  if (Platform.OS === "web") {
    window.alert(messaggio ? `${titolo}\n\n${messaggio}` : titolo);
    return;
  }
  Alert.alert(titolo, messaggio);
}

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
