import { Stack } from "expo-router";
import { AuthProvider } from "@/src/context/AuthContext";

/**
 * Zone sicure del telefono (notch, barra di stato, barra di Home): con l'app installata a tutto schermo
 * il contenuto arriva fino ai bordi, quindi le schermate con l'intestazione disegnata da noi
 * finivano sotto il notch. Su computer e dove non servono il valore e' 0.
 */
const AREA_SICURA = {
  backgroundColor: "#0B1220", // = brand.colors.surface: la fascia della zona sicura ha lo stesso sfondo dell'app
  paddingTop: "env(safe-area-inset-top)",
  paddingBottom: "env(safe-area-inset-bottom)",
  paddingLeft: "env(safe-area-inset-left)",
  paddingRight: "env(safe-area-inset-right)",
} as object;
// Schermate con la barra del titolo di sistema: sopra ci pensa gia' lei.
const AREA_SICURA_CON_TITOLO = { ...AREA_SICURA, paddingTop: 0 } as object;

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: AREA_SICURA }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="crea-squadra" />
        <Stack.Screen name="apri-stagione" />
        <Stack.Screen name="ospite" />
        <Stack.Screen name="scout/[token]" />
        <Stack.Screen name="invito/[token]" />
        <Stack.Screen name="accesso/[token]" />
        <Stack.Screen name="seleziona-squadra" options={{ contentStyle: AREA_SICURA_CON_TITOLO, headerShown: true, title: "Cambia squadra", presentation: "modal" }} />
        <Stack.Screen name="(tabs)" options={{ contentStyle: {} }} />
        <Stack.Screen name="atleta/[id]" />
        <Stack.Screen name="esercizio/[id]" />
        <Stack.Screen name="allenamento/[id]" />
        <Stack.Screen name="sessione/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="globale/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="partita/[id]/index" options={{ contentStyle: AREA_SICURA_CON_TITOLO, headerShown: true, title: "Scouting live" }} />
        <Stack.Screen name="partita/[id]/prepara" options={{ contentStyle: AREA_SICURA_CON_TITOLO, headerShown: true, title: "Prepara partita" }} />
        <Stack.Screen name="profilo" options={{ contentStyle: AREA_SICURA_CON_TITOLO, headerShown: true, title: "Profilo", presentation: "modal" }} />
        <Stack.Screen name="impostazioni" options={{ contentStyle: AREA_SICURA_CON_TITOLO, headerShown: true, title: "Impostazioni", presentation: "modal" }} />
        <Stack.Screen name="notifiche" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="pianificazione-annuale" options={{ headerShown: false }} />
        <Stack.Screen name="campionati" options={{ headerShown: false }} />
        <Stack.Screen name="schemi-gioco" options={{ headerShown: false }} />
        <Stack.Screen name="esercizi-individuali" options={{ headerShown: false }} />
        <Stack.Screen name="gestione-squadra" options={{ headerShown: false }} />
        <Stack.Screen name="gestione-societa" options={{ headerShown: false }} />
        <Stack.Screen name="rubrica-staff" options={{ headerShown: false }} />
        <Stack.Screen name="crea-societa" options={{ headerShown: false }} />
        <Stack.Screen name="live" options={{ headerShown: false }} />
        <Stack.Screen name="visione-analisi-presidenti" options={{ headerShown: false }} />
        <Stack.Screen name="analisi-partita/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="importa-atlete" options={{ contentStyle: AREA_SICURA_CON_TITOLO, headerShown: true, title: "Importa rosa" }} />
      </Stack>
    </AuthProvider>
  );
}
