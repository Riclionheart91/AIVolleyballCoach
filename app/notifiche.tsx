import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { calcolaNotifiche, type Notifica } from "@/src/services/notifiche";
import { brand } from "@/src/config";

export default function CentroNotifiche() {
  const { team, puoScrivere } = useAuth();
  const [notifiche, setNotifiche] = useState<Notifica[]>([]);
  const [caricamento, setCaricamento] = useState(true);

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      setNotifiche(await calcolaNotifiche(team.id, puoScrivere));
    } finally {
      setCaricamento(false);
    }
  }, [team, puoScrivere]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  function apri(n: Notifica) {
    if (n.link) router.push(n.link as never);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← Indietro</Text></Pressable>
        <Text style={styles.titolo}>Notifiche</Text>
      </View>

      {caricamento ? (
        <ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={notifiche}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          ListEmptyComponent={<Text style={styles.vuoto}>Nessuna notifica al momento.</Text>}
          renderItem={({ item }) => (
            <Pressable style={[styles.riga, item.urgente && styles.rigaUrgente]} onPress={() => apri(item)} disabled={!item.link}>
              <Text style={[styles.rigaTitolo, item.urgente && styles.rigaTitoloUrgente]}>{item.urgente ? "⚠ " : ""}{item.titolo}</Text>
              <Text style={styles.rigaDescrizione}>{item.descrizione}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  riga: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, padding: 12, gap: 4 },
  rigaUrgente: { borderWidth: 1, borderColor: brand.colors.error },
  rigaTitolo: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 14 },
  rigaTitoloUrgente: { color: brand.colors.error },
  rigaDescrizione: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
});
