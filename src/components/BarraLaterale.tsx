import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/context/AuthContext";
import { brand, etichetteRuolo } from "@/src/config";
import { useConteggioNotifiche, usePartiteLiveInCorso } from "@/src/lib/comandiTesta";

/**
 * Barra laterale per schermi larghi (tablet, Mac, PC). Al posto dell'intestazione
 * in alto (che sul telefono porta stagione, cambio squadra, LIVE, notifiche e
 * profilo) qui sta tutto nella colonna di sinistra: grande avatar del profilo in
 * cima, poi squadra e stagione, i comandi rapidi e la navigazione.
 *
 * Si usa come `tabBar` di <Tabs>: riceve `state`, `descriptors`, `navigation`.
 * `nomi` è l'elenco (in ordine) delle rotte da mostrare.
 */
type Props = {
  state: { index: number; routes: { key: string; name: string }[] };
  descriptors: Record<string, { options: { title?: string; tabBarIcon?: (p: { color: string; size: number; focused: boolean }) => ReactNode } }>;
  navigation: { navigate: (nome: string) => void };
  nomi: string[];
};

/** Passaggio del mouse (solo web: react-native-web lo aggiunge allo stato di Pressable). */
const sopra = (e: unknown) => !!(e as { hovered?: boolean }).hovered;

export default function BarraLaterale({ state, descriptors, navigation, nomi }: Props) {
  const insets = useSafeAreaInsets();
  const { session, team, ruolo, stagioneAttiva, squadreDisponibili } = useAuth();
  const inCorso = usePartiteLiveInCorso();
  const notifiche = useConteggioNotifiche();

  const rotte = nomi.map((n) => state.routes.find((r) => r.name === n)).filter((r): r is { key: string; name: string } => !!r);
  const attiva = state.routes[state.index]?.name;

  const meta = (session?.user.user_metadata ?? {}) as { full_name?: string; name?: string; given_name?: string; family_name?: string };
  const nomeAccount = (meta.full_name || meta.name || [meta.given_name, meta.family_name].filter(Boolean).join(" ") || "").trim();
  const email = session?.user.email ?? "";
  const nomeVisualizzato = nomeAccount || email || "Il mio profilo";
  const parole = nomeAccount.split(/\s+/).filter(Boolean);
  const iniziali = parole.length > 0
    ? `${parole[0].charAt(0)}${parole.length > 1 ? parole[parole.length - 1].charAt(0) : ""}`.toUpperCase()
    : (email.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "?");
  const piuSquadre = squadreDisponibili.length > 1;
  const live = inCorso > 0;

  return (
    <View style={[styles.barra, { paddingTop: Math.max(insets.top, 0) + 22, paddingBottom: Math.max(insets.bottom, 0) + 16 }]} accessibilityRole="tablist">
      <ScrollView contentContainerStyle={styles.contenuto} showsVerticalScrollIndicator={false}>
        {/* Profilo: grande avatar, tocco → Profilo */}
        <Pressable onPress={() => router.push("/profilo")} style={(e) => [styles.profilo, sopra(e) && styles.profiloHover]} accessibilityRole="button" accessibilityLabel="Apri il profilo">
          <View style={styles.avatarAnello}>
            <View style={styles.avatar}>
              <Text style={styles.avatarTesto}>{iniziali}</Text>
            </View>
          </View>
          <Text style={styles.nome} numberOfLines={2}>{nomeVisualizzato}</Text>
          <Text style={styles.ruolo} numberOfLines={1}>{(ruolo && etichetteRuolo[ruolo]) || "—"}{team ? ` · ${team.nome}` : ""}</Text>
        </Pressable>

        {/* Stagione e cambio squadra */}
        <View style={styles.gruppoContesto}>
          <Pressable onPress={() => router.push("/(tabs)/stagioni")} style={(e) => [styles.contesto, sopra(e) && styles.contestoHover]} accessibilityRole="button" accessibilityLabel="Stagioni">
            <Ionicons name="trophy-outline" size={16} color={brand.colors.brand} />
            <Text style={styles.contestoTesto} numberOfLines={1}>{stagioneAttiva ? stagioneAttiva.nome : "Nessuna stagione attiva"}</Text>
            <Ionicons name="chevron-forward" size={14} color={brand.colors.muted} />
          </Pressable>
          {piuSquadre && (
            <Pressable onPress={() => router.push("/seleziona-squadra")} style={(e) => [styles.contesto, sopra(e) && styles.contestoHover]} accessibilityRole="button" accessibilityLabel="Cambia squadra">
              <Ionicons name="swap-horizontal" size={16} color={brand.colors.brand} />
              <Text style={styles.contestoTesto} numberOfLines={1}>Cambia squadra</Text>
              <Ionicons name="chevron-forward" size={14} color={brand.colors.muted} />
            </Pressable>
          )}
        </View>

        {/* Comandi rapidi: LIVE e notifiche */}
        <View style={styles.rigaComandi}>
          <Pressable onPress={() => router.push("/live")} style={[styles.comando, live && styles.comandoLive]} accessibilityRole="button" accessibilityLabel={live ? "Partite in corso" : "Nessuna partita in corso"}>
            <Ionicons name="radio" size={18} color={live ? "#fff" : brand.colors.muted} />
            <Text style={[styles.comandoTesto, { color: live ? "#fff" : brand.colors.muted }]}>LIVE</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/notifiche")} style={styles.comando} accessibilityRole="button" accessibilityLabel="Notifiche">
            <View>
              <Ionicons name="notifications-outline" size={18} color={brand.colors.onSurface} />
              {notifiche > 0 && (
                <View style={styles.badge}><Text style={styles.badgeTesto}>{notifiche > 9 ? "9+" : notifiche}</Text></View>
              )}
            </View>
            <Text style={[styles.comandoTesto, { color: brand.colors.onSurface }]}>Notifiche</Text>
          </Pressable>
        </View>

        <View style={styles.separatore} />

        {/* Navigazione */}
        <View style={styles.nav}>
          {rotte.map((r) => {
            const opzioni = descriptors[r.key]?.options ?? {};
            const acceso = r.name === attiva;
            const colore = acceso ? brand.colors.brand : brand.colors.onSurfaceSecondary;
            return (
              <Pressable
                key={r.key}
                onPress={() => navigation.navigate(r.name)}
                style={(e) => [styles.voce, acceso && styles.voceAccesa, !acceso && sopra(e) && styles.voceHover]}
                accessibilityRole="tab"
                accessibilityState={{ selected: acceso }}
                accessibilityLabel={opzioni.title ?? r.name}
              >
                {opzioni.tabBarIcon?.({ color: colore, size: 22, focused: acceso })}
                <Text style={[styles.voceTesto, { color: colore }, acceso && styles.voceTestoAccesa]} numberOfLines={1}>{opzioni.title ?? r.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  barra: { width: 264, backgroundColor: brand.colors.surfaceSecondary, borderRightColor: brand.colors.border, borderRightWidth: 1 },
  contenuto: { paddingHorizontal: 16, gap: 14, flexGrow: 1 },
  profilo: { alignItems: "center", gap: 6, paddingVertical: 14, paddingHorizontal: 8, borderRadius: 20 },
  profiloHover: { backgroundColor: "rgba(255,255,255,0.04)" },
  avatarAnello: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: brand.colors.brand, alignItems: "center", justifyContent: "center" },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  avatarTesto: { color: brand.colors.onSurface, fontSize: 32, fontWeight: "800", letterSpacing: -0.5 },
  nome: { color: brand.colors.onSurface, fontSize: 18, fontWeight: "700", textAlign: "center", marginTop: 6 },
  ruolo: { color: brand.colors.muted, fontSize: 13, textAlign: "center" },
  gruppoContesto: { gap: 6 },
  contesto: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: brand.colors.surface, borderWidth: 1, borderColor: brand.colors.border },
  contestoHover: { borderColor: brand.colors.muted },
  contestoTesto: { flex: 1, color: brand.colors.onSurface, fontSize: 14, fontWeight: "600" },
  rigaComandi: { flexDirection: "row", gap: 8 },
  comando: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: brand.colors.border, backgroundColor: brand.colors.surface },
  comandoLive: { backgroundColor: brand.colors.error, borderColor: brand.colors.error },
  comandoTesto: { fontSize: 13, fontWeight: "700" },
  badge: { position: "absolute", top: -6, right: -8, backgroundColor: brand.colors.error, borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  badgeTesto: { color: "#fff", fontSize: 9, fontWeight: "800" },
  separatore: { height: 1, backgroundColor: brand.colors.border, marginVertical: 2 },
  nav: { gap: 4 },
  voce: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14 },
  voceAccesa: { backgroundColor: "rgba(255,122,0,0.16)" },
  voceHover: { backgroundColor: "rgba(255,255,255,0.05)" },
  voceTesto: { fontSize: 16, fontWeight: "600", flex: 1 },
  voceTestoAccesa: { fontWeight: "800" },
});
