import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { brand } from "@/src/config";

export default function Index() {
  const { session, caricamento, team, caricamentoTeam, stagioneAttiva, caricamentoStagione } = useAuth();

  useEffect(() => {
    if (caricamento || caricamentoTeam) return; // mai decidere una rotta mentre lo stato è ancora incerto
    if (!session) { router.replace("/login"); return; }
    if (!team) { router.replace("/crea-squadra"); return; }
    if (caricamentoStagione) return; // aspetta di sapere se c'è una stagione attiva prima di decidere
    if (!stagioneAttiva) { router.replace("/apri-stagione"); return; }
    router.replace("/(tabs)");
  }, [session, caricamento, team, caricamentoTeam, stagioneAttiva, caricamentoStagione]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surface }}>
      <ActivityIndicator color={brand.colors.brand} />
    </View>
  );
}
