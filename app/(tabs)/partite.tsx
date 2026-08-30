import { useCallback, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, RefreshControl, Alert, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { andamentoSquadraPartite, avviaMatch, creaMatch, elencaPartite, type AndamentoSquadraPartiteVoce } from "@/src/services/matches";
import { impostaLinkSporteasy, leggiIntegrazione, sincronizzaSporteasy } from "@/src/services/sporteasy";
import { brand } from "@/src/config";
import type { Match, TeamIntegration } from "@/src/types/database";

export default function Partite() {
  const { team, puoScrivere } = useAuth();
  const [partite, setPartite] = useState<Match[]>([]);
  const [andamento, setAndamento] = useState<AndamentoSquadraPartiteVoce[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [avversario, setAvversario] = useState("");
  const [luogo, setLuogo] = useState<"casa" | "trasferta">("casa");
  const [integrazione, setIntegrazione] = useState<TeamIntegration | null>(null);
  const [mostraSporteasy, setMostraSporteasy] = useState(false);
  const [linkSporteasy, setLinkSporteasy] = useState("");
  const [sincronizzando, setSincronizzando] = useState(false);

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      const [listaPartite, listaAndamento, integ] = await Promise.all([
        elencaPartite(team.id),
        andamentoSquadraPartite(team.id).catch(() => []),
        puoScrivere ? leggiIntegrazione(team.id).catch(() => null) : Promise.resolve(null),
      ]);
      setPartite(listaPartite);
      setAndamento(listaAndamento);
      setIntegrazione(integ);
      if (integ?.sporteasy_ical_url) setLinkSporteasy(integ.sporteasy_ical_url);
    } finally {
      setCaricamento(false);
    }
  }, [team, puoScrivere]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function nuovaPartita() {
    if (!team || !avversario.trim()) return;
    try {
      const matchId = await creaMatch(team.id, avversario.trim(), new Date().toISOString(), luogo);
      setAvversario("");
      router.push(`/partita/${matchId}`);
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    }
  }

  async function apriPartita(m: Match) {
    if (m.stato === "programmata") {
      if (!puoScrivere) { Alert.alert("Partita non ancora iniziata", "L'allenatore non ha ancora avviato lo scouting per questa partita."); return; }
      try {
        await avviaMatch(m.id);
        router.push(`/partita/${m.id}`);
      } catch (e) { Alert.alert("Errore", (e as Error).message); }
      return;
    }
    router.push(`/partita/${m.id}`);
  }

  async function salvaLinkSporteasy() {
    if (!team || !linkSporteasy.trim()) return;
    try {
      await impostaLinkSporteasy(team.id, linkSporteasy.trim());
      carica();
      Alert.alert("Salvato", "Link calendario salvato. Premi \"Sincronizza ora\" per importare gli eventi.");
    } catch (e) { Alert.alert("Errore", (e as Error).message); }
  }

  async function sincronizza() {
    if (!team) return;
    setSincronizzando(true);
    try {
      const r = await sincronizzaSporteasy(team.id);
      if (r.errore) { Alert.alert("Sincronizzazione fallita", r.messaggio ?? "Errore sconosciuto"); return; }
      Alert.alert(
        "Sincronizzazione completata",
        `Allenamenti: ${r.allenamentiCreati} nuovi, ${r.allenamentiAggiornati} aggiornati.\nPartite: ${r.partiteCreate} nuove, ${r.partiteAggiornate} aggiornate.\n(${r.totaleEventiNelCalendario} eventi trovati nel calendario)`,
      );
      carica();
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    } finally {
      setSincronizzando(false);
    }
  }

  return (
    <View style={styles.container}>
      {puoScrivere && (
        <>
          <View style={styles.form}>
            <TextInput style={styles.input} placeholder="Avversario" placeholderTextColor={brand.colors.muted} value={avversario} onChangeText={setAvversario} />
            <View style={styles.selettoreRiga}>
              {(["casa", "trasferta"] as const).map((l) => (
                <Pressable key={l} onPress={() => setLuogo(l)} style={[styles.chip, luogo === l && styles.chipAttivo]}>
                  <Text style={[styles.chipTesto, luogo === l && styles.chipTestoAttivo]}>{l === "casa" ? "Casa" : "Trasferta"}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.bottone} onPress={nuovaPartita}>
              <Text style={styles.bottoneTesto}>Inizia partita adesso (scouting live)</Text>
            </Pressable>
          </View>

          <Pressable style={styles.rigaEspandi} onPress={() => setMostraSporteasy(!mostraSporteasy)}>
            <Text style={styles.rigaEspandiTesto}>{mostraSporteasy ? "▾" : "▸"} Sincronizzazione SportEasy {integrazione?.ultima_sincronizzazione ? `(ultima: ${new Date(integrazione.ultima_sincronizzazione).toLocaleString("it-IT")})` : ""}</Text>
          </Pressable>

          {mostraSporteasy && (
            <View style={styles.form}>
              <Text style={styles.nota}>Incolla qui il link del calendario iCal della squadra (SportEasy → Impostazioni squadra → Esporta calendario). Importa solo allenamenti e partite, mai l'anagrafica atlete.</Text>
              <TextInput style={styles.input} placeholder="webcal://calendar.sporteasy.net/..." placeholderTextColor={brand.colors.muted} autoCapitalize="none" value={linkSporteasy} onChangeText={setLinkSporteasy} />
              <View style={styles.selettoreRiga}>
                <Pressable style={styles.bottoneSecondario} onPress={salvaLinkSporteasy}><Text style={styles.bottoneSecondarioTesto}>Salva link</Text></Pressable>
                <Pressable style={styles.bottone} onPress={sincronizza} disabled={sincronizzando || !integrazione?.sporteasy_ical_url}>
                  {sincronizzando ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Sincronizza ora</Text>}
                </Pressable>
              </View>
              {integrazione?.ultimo_esito && integrazione.ultimo_esito !== "ok" && (
                <Text style={styles.erroreTesto}>Ultimo tentativo non riuscito: {integrazione.ultimo_esito}</Text>
              )}
            </View>
          )}
        </>
      )}

      {andamento.length > 0 && (
        <View style={styles.cardAndamento}>
          <Text style={styles.sottotitoloSezione}>Andamento tra le partite</Text>
          {andamento.slice(0, 8).map((v, i) => (
            <View key={i} style={styles.rigaAndamento}>
              <Text style={styles.rigaAndamentoTesto}>{v.partita.slice(0, 10)} vs {v.avversario} — {v.fondamentale}</Text>
              <Text style={styles.rigaAndamentoValore}>+{v.punti} / -{v.errori}</Text>
            </View>
          ))}
        </View>
      )}

      <FlatList
        data={partite}
        keyExtractor={(m) => m.id}
        refreshControl={<RefreshControl refreshing={caricamento} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListEmptyComponent={!caricamento ? <Text style={styles.vuoto}>Nessuna partita ancora.</Text> : null}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => apriPartita(item)}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.cardTitolo}>vs {item.avversario}</Text>
              <Text style={[styles.badge, item.stato === "in_corso" && styles.badgeInCorso, item.stato === "programmata" && styles.badgeProgrammata]}>
                {item.stato === "programmata" ? "da iniziare" : item.stato}
              </Text>
            </View>
            <Text style={styles.cardSotto}>{new Date(item.data).toLocaleDateString("it-IT")} — {item.luogo}{item.sporteasy_uid ? " · da SportEasy" : ""}</Text>
            {item.stato === "conclusa" && <Text style={styles.cardRisultato}>Set: {item.set_vinti_noi} - {item.set_vinti_avversario}</Text>}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface, padding: 16, gap: 16 },
  form: { gap: 8, backgroundColor: brand.colors.surfaceSecondary, padding: 12, borderRadius: 12 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  nota: { color: brand.colors.muted, fontSize: 12 },
  bottone: { backgroundColor: brand.colors.brand, padding: 10, borderRadius: 8, alignItems: "center", flex: 1 },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  bottoneSecondario: { borderColor: brand.colors.brand, borderWidth: 1, padding: 10, borderRadius: 8, alignItems: "center", flex: 1 },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "600" },
  selettoreRiga: { flexDirection: "row", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  rigaEspandi: { paddingVertical: 2 },
  rigaEspandiTesto: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "600" },
  erroreTesto: { color: brand.colors.error, fontSize: 12 },
  cardAndamento: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 12, gap: 6 },
  sottotitoloSezione: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "700" },
  rigaAndamento: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaAndamentoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12, flex: 1, marginRight: 8 },
  rigaAndamentoValore: { color: brand.colors.brand, fontWeight: "700", fontSize: 12 },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, marginBottom: 10, gap: 2 },
  cardTitolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  cardSotto: { color: brand.colors.muted, fontSize: 13 },
  cardRisultato: { color: brand.colors.brand, fontWeight: "700", marginTop: 4 },
  badge: { color: brand.colors.muted, fontSize: 12, textTransform: "uppercase" },
  badgeInCorso: { color: brand.colors.warning, fontWeight: "700" },
  badgeProgrammata: { color: brand.colors.brandSecondary, fontWeight: "700" },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
});
