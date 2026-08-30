import { Tabs, router } from "expo-router";
import { Pressable, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/context/AuthContext";
import { brand } from "@/src/config";

/** Banner stagione: sempre visibile in header, tocco -> tab Stagioni (dove si vede l'elenco di quelle passate e si può cambiare/attivare). */
function BannerStagione() {
  const { stagioneAttiva } = useAuth();
  return (
    <Pressable onPress={() => router.push("/(tabs)/stagioni")} style={styles.banner}>
      <Ionicons name="trophy-outline" size={14} color={brand.colors.brand} />
      <Text style={styles.bannerTesto} numberOfLines={1}>{stagioneAttiva ? stagioneAttiva.nome : "Nessuna stagione attiva"}</Text>
      <Ionicons name="chevron-down" size={14} color={brand.colors.muted} />
    </Pressable>
  );
}

function BottoneProfilo() {
  return (
    <Pressable onPress={() => router.push("/profilo")} style={{ marginRight: 12 }}>
      <Ionicons name="person-circle-outline" size={26} color={brand.colors.onSurface} />
    </Pressable>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: brand.colors.surface },
        headerTintColor: brand.colors.onSurface,
        headerTitle: () => <BannerStagione />,
        headerRight: () => <BottoneProfilo />,
        tabBarStyle: { backgroundColor: brand.colors.surfaceSecondary, borderTopColor: brand.colors.border },
        tabBarActiveTintColor: brand.colors.brand,
        tabBarInactiveTintColor: brand.colors.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Atlete", tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size} /> }} />
      <Tabs.Screen name="esercizi" options={{ title: "Esercizi", tabBarIcon: ({ color, size }) => <Ionicons name="barbell" color={color} size={size} /> }} />
      <Tabs.Screen name="allenamenti" options={{ title: "Allenamenti", tabBarIcon: ({ color, size }) => <Ionicons name="calendar" color={color} size={size} /> }} />
      <Tabs.Screen name="partite" options={{ title: "Partite", tabBarIcon: ({ color, size }) => <Ionicons name="tennisball" color={color} size={size} /> }} />
      <Tabs.Screen name="valutazioni" options={{ title: "Valutazioni", tabBarIcon: ({ color, size }) => <Ionicons name="star" color={color} size={size} /> }} />
      <Tabs.Screen
        name="stagioni"
        options={{
          title: "Stagioni",
          tabBarIcon: ({ color, size }) => <Ionicons name="trophy" color={color} size={size} />,
          // Tolta dalla tab bar in basso su richiesta: resta comunque
          // raggiungibile dal banner stagione in alto (BannerStagione
          // sopra fa router.push su questa stessa rotta). href: null è
          // il modo corretto in Expo Router per nascondere una voce
          // dalla tab bar senza disabilitare la rotta.
          href: null,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 220 },
  bannerTesto: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 15 },
});
