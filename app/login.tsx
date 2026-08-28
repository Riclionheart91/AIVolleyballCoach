import { useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { brand, uiStrings } from "@/src/config";

export default function Login() {
  const { session, accediConGoogle } = useAuth();

  useEffect(() => {
    if (session) router.replace("/");
  }, [session]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{uiStrings.auth.loginTitle}</Text>
      <Text style={styles.sottotitolo}>
        Accesso aperto a qualsiasi account Google — non serve un dominio Workspace (era il vincolo del vecchio Auth.gs, rimosso).
      </Text>
      <Pressable style={styles.bottone} onPress={accediConGoogle}>
        <Text style={styles.bottoneTesto}>{uiStrings.auth.loginGoogle}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surface, padding: 24, gap: 16 },
  title: { color: brand.colors.onSurface, fontSize: 28, fontWeight: "700" },
  sottotitolo: { color: brand.colors.muted, textAlign: "center", maxWidth: 320 },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12, marginTop: 12 },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
});
