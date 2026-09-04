import { useEffect } from "react";
import { Tabs, router } from "expo-router";
import { Pressable, Text, View, ActivityIndicator, StyleSheet } from "react-native";
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

/** Visibile solo se l'utente segue più di una squadra — la stragrande maggioranza degli allenatori ne segue una sola e non lo vede mai. */
function BottoneCambiaSquadra() {
  const { squadreDisponibili } = useAuth();
  if (squadreDisponibili.length <= 1) return null;
  return (
    <Pressable onPress={() => router.push("/seleziona-squadra")} style={{ marginLeft: 12 }}>
      <Ionicons name="swap-horizontal" size={22} color={brand.colors.onSurface} />
    </Pressable>
  );
}

export default function TabsLayout() {
  const { session, caricamento, team, caricamentoContesto, erroreTeam, stagioneAttiva } = useAuth();

  // GUARDIA DIFENSIVA: prima questo controllo viveva solo in app/index.tsx,
  // eseguito una volta sola all'avvio dell'app. Su un sito statico (export
  // web), un refresh della pagina — o l'apertura diretta di un link che
  // punta già dentro (tabs) — non fa mai ripassare da index.tsx: il
  // controllo veniva saltato del tutto, ed era possibile ritrovarsi qui
  // dentro con team/stagione nulli, con le schermate che restavano vuote
  // in silenzio (il bug esatto segnalato: "non mi fa vedere nulla").
  // Rifacendo lo stesso controllo qui, gira SEMPRE che si entri in questa
  // sezione, qualunque sia stato il punto di ingresso.
  useEffect(() => {
    if (caricamento || caricamentoContesto) return;
    if (!session) { router.replace("/login"); return; }
    if (!team) { router.replace("/crea-squadra"); return; }
    if (!stagioneAttiva) { router.replace("/apri-stagione"); return; }
  }, [session, caricamento, team, caricamentoContesto, stagioneAttiva]);

  if (caricamento || caricamentoContesto || !team) {
    return (
      <View style={styles.caricamentoContainer}>
        <ActivityIndicator color={brand.colors.brand} />
        {erroreTeam && (
          <Text style={styles.erroreTesto}>
            Errore nel caricamento della squadra: {erroreTeam}{"\n"}
            Se il problema persiste, verifica che il progetto Supabase collegato sia quello giusto (Project Settings → API → Project URL, da confrontare con EXPO_PUBLIC_SUPABASE_URL).
          </Text>
        )}
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: brand.colors.surface },
        headerTintColor: brand.colors.onSurface,
        headerTitle: () => <BannerStagione />,
        headerLeft: () => <BottoneCambiaSquadra />,
        headerRight: () => <BottoneProfilo />,
        tabBarStyle: { backgroundColor: brand.colors.surfaceSecondary, borderTopColor: brand.colors.border },
        tabBarActiveTintColor: brand.colors.brand,
        tabBarInactiveTintColor: brand.colors.muted,
        // 6 voci sono tante per uno schermo stretto: etichette/icone più
        // piccole e meno padding evitano che la tab bar spinga la
        // pagina oltre il viewport (una delle cause dello scroll
        // laterale segnalato).
        tabBarLabelStyle: { fontSize: 10 },
        tabBarIconStyle: { marginBottom: -2 },
        tabBarItemStyle: { paddingHorizontal: 0 },
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
  caricamentoContainer: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surface, padding: 24, gap: 16 },
  erroreTesto: { color: brand.colors.error, fontSize: 13, textAlign: "center" },
});
