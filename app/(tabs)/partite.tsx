import { useCallback, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, RefreshControl, Alert, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { andamentoSquadraPartite, creaMatch, elencaPartite, type AndamentoSquadraPartiteVoce } from "@/src/services/matches";
import { elencaCampionati, riassegnaCampionatoPartita } from "@/src/services/championships";
import { PannelloSporteasy } from "@/src/components/PannelloSporteasy";
import { brand } from "@/src/config";
import type { Campionato, Match } from "@/src/types/database";

export default function Partite() {
  const { team, puoScrivere } = useAuth();
  const [partite, setPartite] = useState<Match[]>([]);
  const [andamento, setAndamento] = useState<AndamentoSquadraPartiteVoce[]>([]);
  const [campionati, setCampionati] = useState<Campionato[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [avversario, setAvversario] = useState("");
  const [luogo, setLuogo] = useState<"casa" | "trasferta">("casa");
  const [tipoGara, setTipoGara] = useState<"campionato" | "amichevole">("amichevole");
  const [campionatoId, setCampionatoId] = useState<string | null>(null);
  const [pickerCampionatoMatchId, setPickerCampionatoMatchId] = useState<string | null>(null);

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      const [listaPartite, listaAndamento, listaCampionati] = await Promise.all([
        elencaPartite(team.id),
        andamentoSquadraPartite(team.id).catch(() => []),
        elencaCampionati(team.id).catch(() => []),
      ]);
      setPartite(listaPartite);
      setAndamento(listaAndamento);
      setCampionati(listaCampionati);
    } finally {
      setCaricamento(false);
    }
  }, [team, puoScrivere]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function nuovaPartita() {
    if (!team || !avversario.trim()) return;
    try {
      const matchId = await creaMatch(team.id, avversario.trim(), new Date().toISOString(), luogo, tipoGara === "campionato" ? campionatoId : null, tipoGara);
      setAvversario("");
      router.push(`/partita/${matchId}/prepara`);
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    }
  }

  function apriPartita(m: Match) {
    if (m.stato === "programmata") {
      if (!puoScrivere) { Alert.alert("Partita non ancora iniziata", "L'allenatore non ha ancora preparato questa partita."); return; }
      router.push(`/partita/${m.id}/prepara`);
      return;
    }
    router.push(`/partita/${m.id}`);
  }

  async function onScegliCampionato(matchId: string, campionatoId: string | null) {
    try {
      await riassegnaCampionatoPartita(matchId, campionatoId);
      setPickerCampionatoMatchId(null);
      carica();
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
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
              {(["amichevole", "campionato"] as const).map((t) => (
                <Pressable key={t} onPress={() => setTipoGara(t)} style={[styles.chip, tipoGara === t && styles.chipAttivo]}>
                  <Text style={[styles.chipTesto, tipoGara === t && styles.chipTestoAttivo]}>{t === "amichevole" ? "Amichevole" : "Campionato"}</Text>
                </Pressable>
              ))}
            </View>
            {tipoGara === "campionato" && (
              <View style={styles.selettoreRiga}>
                {campionati.length === 0 ? (
                  <Text style={styles.nota}>Nessun campionato configurato — aggiungine uno da Impostazioni, oppure procedi come amichevole.</Text>
                ) : (
                  campionati.map((c) => (
                    <Pressable key={c.id} onPress={() => setCampionatoId(c.id)} style={[styles.chip, campionatoId === c.id && styles.chipAttivo]}>
                      <Text style={[styles.chipTesto, campionatoId === c.id && styles.chipTestoAttivo]}>{c.nome}</Text>
                    </Pressable>
                  ))
                )}
              </View>
            )}
            <Pressable style={styles.bottone} onPress={nuovaPartita} disabled={!avversario.trim()}>
              <Text style={styles.bottoneTesto}>Crea partita (poi convocati e formazione)</Text>
            </Pressable>
          </View>

          <PannelloSporteasy teamId={team!.id} onSincronizzato={carica} />

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
                {item.stato === "programmata" ? "da preparare" : item.stato}
              </Text>
            </View>
            <Text style={styles.cardSotto}>{new Date(item.data).toLocaleDateString("it-IT")} — {item.luogo} — {item.tipo_gara}{item.sporteasy_uid ? " · da SportEasy" : ""}</Text>
            {puoScrivere && (
              <Pressable onPress={() => setPickerCampionatoMatchId(pickerCampionatoMatchId === item.id ? null : item.id)}>
                <Text style={styles.linkCampionato}>
                  Campionato: {campionati.find((c) => c.id === item.campionato_id)?.nome ?? "nessuno (amichevole)"} — tocca per cambiare
                </Text>
              </Pressable>
            )}
            {pickerCampionatoMatchId === item.id && (
              <View style={styles.selettoreRiga}>
                <Pressable onPress={() => onScegliCampionato(item.id, null)} style={[styles.chip, !item.campionato_id && styles.chipAttivo]}>
                  <Text style={[styles.chipTesto, !item.campionato_id && styles.chipTestoAttivo]}>Amichevole</Text>
                </Pressable>
                {campionati.map((c) => (
                  <Pressable key={c.id} onPress={() => onScegliCampionato(item.id, c.id)} style={[styles.chip, item.campionato_id === c.id && styles.chipAttivo]}>
                    <Text style={[styles.chipTesto, item.campionato_id === c.id && styles.chipTestoAttivo]}>{c.nome}</Text>
                  </Pressable>
                ))}
              </View>
            )}
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
  selettoreRiga: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  rigaEspandi: { paddingVertical: 2 },
  rigaEspandiTesto: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "600" },
  erroreTesto: { color: brand.colors.error, fontSize: 12 },
  rigaClassificazione: { color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  tagPartita: { color: brand.colors.brand, fontWeight: "700" },
  tagAllenamento: { color: brand.colors.brandSecondary, fontWeight: "700" },
  cardAndamento: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 12, gap: 6 },
  sottotitoloSezione: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "700" },
  rigaAndamento: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaAndamentoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12, flex: 1, marginRight: 8 },
  rigaAndamentoValore: { color: brand.colors.brand, fontWeight: "700", fontSize: 12 },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, marginBottom: 10, gap: 2 },
  cardTitolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  cardSotto: { color: brand.colors.muted, fontSize: 13 },
  linkCampionato: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "600", marginTop: 4 },
  cardRisultato: { color: brand.colors.brand, fontWeight: "700", marginTop: 4 },
  badge: { color: brand.colors.muted, fontSize: 12, textTransform: "uppercase" },
  badgeInCorso: { color: brand.colors.warning, fontWeight: "700" },
  badgeProgrammata: { color: brand.colors.brandSecondary, fontWeight: "700" },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
});
