import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { brand } from "@/src/config";

export default function Index() {
  const { session, caricamento, team, caricamentoTeam } = useAuth();

  useEffect(() => {
    if (caricamento || caricamentoTeam) return; // mai decidere una rotta mentre lo stato è ancora incerto
    if (!session) { router.replace("/login"); return; }
    if (!team) { router.replace("/crea-squadra"); return; }
    router.replace("/(tabs)");
  }, [session, caricamento, team, caricamentoTeam]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surface }}>
      <ActivityIndicator color={brand.colors.brand} />
    </View>
  );
}
