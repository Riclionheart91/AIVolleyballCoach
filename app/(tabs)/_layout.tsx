import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { brand } from "@/src/config";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: brand.colors.surface },
        headerTintColor: brand.colors.onSurface,
        tabBarStyle: { backgroundColor: brand.colors.surfaceSecondary, borderTopColor: brand.colors.border },
        tabBarActiveTintColor: brand.colors.brand,
        tabBarInactiveTintColor: brand.colors.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Atlete", tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size} /> }} />
      <Tabs.Screen name="allenamenti" options={{ title: "Allenamenti", tabBarIcon: ({ color, size }) => <Ionicons name="calendar" color={color} size={size} /> }} />
      <Tabs.Screen name="valutazioni" options={{ title: "Valutazioni", tabBarIcon: ({ color, size }) => <Ionicons name="star" color={color} size={size} /> }} />
      <Tabs.Screen name="stagioni" options={{ title: "Stagioni", tabBarIcon: ({ color, size }) => <Ionicons name="trophy" color={color} size={size} /> }} />
    </Tabs>
  );
}
