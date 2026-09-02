import { Stack } from "expo-router";
import { AuthProvider } from "@/src/context/AuthContext";

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="crea-squadra" />
        <Stack.Screen name="apri-stagione" />
        <Stack.Screen name="seleziona-squadra" options={{ headerShown: true, title: "Cambia squadra", presentation: "modal" }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="atleta/[id]" />
        <Stack.Screen name="esercizio/[id]" />
        <Stack.Screen name="partita/[id]" options={{ headerShown: true, title: "Scouting live" }} />
        <Stack.Screen name="profilo" options={{ headerShown: true, title: "Profilo", presentation: "modal" }} />
        <Stack.Screen name="impostazioni" options={{ headerShown: true, title: "Impostazioni", presentation: "modal" }} />
        <Stack.Screen name="importa-atlete" options={{ headerShown: true, title: "Importa atlete" }} />
      </Stack>
    </AuthProvider>
  );
}
