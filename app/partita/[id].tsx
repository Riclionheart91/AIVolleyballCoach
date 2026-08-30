import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, FlatList, Switch, Alert } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaAtlete } from "@/src/services/athletes";
import {
  annullaUltimoEvento,
  chiudiMatch,
  elencaEventiPartita,
  elencaSet,
  nuovoSet,
  registraEvento,
} from "@/src/services/matches";
import { brand, skillsScouting, skillsScoutingEssenziali } from "@/src/config";
import type { Athlete, Esito, Match, MatchEvent, MatchSet, Skill } from "@/src/types/database";
import { supabaseClient } from "@/src/lib/supabase";

/**
 * Interfaccia ispirata ai pattern standard del settore (DataVolley,
 * VolleyStation, Click&Scout): griglia di tocco, massimo due tap per
 * evento, rotazione/atleta sempre visibile, scrittura ottimistica (il
 * punteggio e la lista eventi si aggiornano SUBITO sullo schermo, la
 * chiamata al server parte in background) così non c'è mai un'attesa di
 * rete percepita tra un tocco e il successivo. Se una chiamata fallisce
 * per davvero (rete assente), lo stato locale viene corretto e l'errore
 * mostrato — ma il caso comune, connessione presente anche se lenta,
 * non blocca mai il flusso.
 */
export default function PartitaLive() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { puoScrivere } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const [setCorrente, setSetCorrente] = useState<MatchSet | null>(null);
  const [eventi, setEventi] = useState<MatchEvent[]>([]);
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [atletaSelId, setAtletaSelId] = useState<string | null>(null);
  const [skillSelezionata, setSkillSelezionata] = useState<Skill | null>(null);
  const [modalitaEssenziale, setModalitaEssenziale] = useState(false);

  const carica = useCallback(async () => {
    if (!id) return;
    const { data: m } = await supabaseClient.from("matches").select("*").eq("id", id).single();
    setMatch(m ?? null);
    const set = await elencaSet(id);
    const attivo = set.find((s) => !s.concluso) ?? set[set.length - 1] ?? null;
    setSetCorrente(attivo);
    setEventi(await elencaEventiPartita(id));
    if (m) setAtlete(await elencaAtlete(m.team_id));
  }, [id]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  useEffect(() => { setSkillSelezionata(null); }, [atletaSelId]);

  /** Applica localmente lo stesso calcolo del trigger SQL, per il feedback istantaneo. */
  function applicaDeltaLocale(skill: Skill, esito: Esito | null, segno: 1 | -1) {
    setSetCorrente((prev) => {
      if (!prev) return prev;
      const puntoAvversario = skill === "Punto_avversario" || esito === "errore";
      const puntoNostro = esito === "punto";
      return {
        ...prev,
        punti_avversario: puntoAvversario ? Math.max(0, prev.punti_avversario + segno) : prev.punti_avversario,
        punti_noi: puntoNostro ? Math.max(0, prev.punti_noi + segno) : prev.punti_noi,
      };
    });
  }

  async function registra(skill: Skill, esito: Esito | null) {
    if (!match || !setCorrente) return;
    const eventoOttimistico: MatchEvent = {
      id: `temp-${Date.now()}`, match_id: match.id, set_id: setCorrente.id, skill, esito,
      athlete_id: atletaSelId, creato_il: new Date().toISOString(), creato_da: null,
    };
    setEventi((prev) => [eventoOttimistico, ...prev]);
    applicaDeltaLocale(skill, esito, 1);
    setSkillSelezionata(null);

    try {
      await registraEvento(match.id, setCorrente.id, skill, esito, atletaSelId);
    } catch (e) {
      // Rollback: l'evento non è stato salvato davvero.
      setEventi((prev) => prev.filter((ev) => ev.id !== eventoOttimistico.id));
      applicaDeltaLocale(skill, esito, -1);
      Alert.alert("Evento non salvato", (e as Error).message);
    }
  }

  async function onPuntoAvversario() {
    await registra("Punto_avversario", null);
  }

  async function onAnnulla() {
    if (!match || eventi.length === 0) return;
    const ultimo = eventi[0];
    setEventi((prev) => prev.slice(1));
    applicaDeltaLocale(ultimo.skill, ultimo.esito, -1);
    try {
      await annullaUltimoEvento(match.id);
    } catch (e) {
      carica(); // qualcosa non torna: ricarichiamo lo stato vero dal server invece di indovinare
      Alert.alert("Errore nell'annullamento", (e as Error).message);
    }
  }

  async function onNuovoSet() {
    if (!match) return;
    try {
      await nuovoSet(match.id);
      carica();
    } catch (e) { Alert.alert("Errore", (e as Error).message); }
  }

  async function onChiudiPartita() {
    if (!match) return;
    Alert.alert("Chiudere la partita?", "Non potrai più registrare eventi dopo la chiusura.", [
      { text: "Annulla", style: "cancel" },
      { text: "Chiudi", style: "destructive", onPress: async () => {
        try { await chiudiMatch(match.id); router.back(); } catch (e) { Alert.alert("Errore", (e as Error).message); }
      } },
    ]);
  }

  if (!match || !setCorrente) {
    return <View style={styles.container}><Text style={styles.vuoto}>Caricamento…</Text></View>;
  }

  const skillsDaMostrare = modalitaEssenziale ? skillsScoutingEssenziali : skillsScouting;

  return (
    <View style={styles.container}>
      <View style={styles.scoreboard}>
        <View>
          <Text style={styles.scoreboardAvversario}>vs {match.avversario}</Text>
          <Text style={styles.scoreboardSet}>Set {setCorrente.numero_set}</Text>
        </View>
        <Text style={styles.scoreboardPunti}>{setCorrente.punti_noi} - {setCorrente.punti_avversario}</Text>
      </View>

      {puoScrivere ? (
        <>
          <View style={styles.rigaStrisciaAtlete}>
            <FlatList
              horizontal
              data={atlete}
              keyExtractor={(a) => a.id}
              showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => (
                <Pressable onPress={() => setAtletaSelId(atletaSelId === item.id ? null : item.id)} style={[styles.chipAtleta, atletaSelId === item.id && styles.chipAtletaAttiva]}>
                  <Text style={[styles.chipAtletaTesto, atletaSelId === item.id && styles.chipAtletaTestoAttiva]}>{item.cognome}</Text>
                </Pressable>
              )}
              ListEmptyComponent={<Text style={styles.nota}>Nessuna atleta</Text>}
            />
          </View>

          {!skillSelezionata ? (
            <View style={styles.grigliaSkill}>
              {skillsDaMostrare.map((s) => (
                <Pressable key={s.skill} onPress={() => setSkillSelezionata(s.skill)} style={styles.tastoSkill}>
                  <Text style={styles.tastoSkillTesto}>{s.etichetta}</Text>
                </Pressable>
              ))}
              <Pressable onPress={onPuntoAvversario} style={styles.tastoPuntoAvversario}>
                <Text style={styles.tastoSkillTesto}>Punto avversario</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.grigliaEsito}>
              <Text style={styles.etichettaEsito}>{skillSelezionata}</Text>
              <View style={styles.rigaEsito}>
                <Pressable onPress={() => registra(skillSelezionata, "punto")} style={[styles.tastoEsito, styles.tastoEsitoPunto]}>
                  <Text style={styles.tastoEsitoTesto}>Punto</Text>
                </Pressable>
                <Pressable onPress={() => registra(skillSelezionata, "neutro")} style={[styles.tastoEsito, styles.tastoEsitoNeutro]}>
                  <Text style={styles.tastoEsitoTesto}>Neutro</Text>
                </Pressable>
                <Pressable onPress={() => registra(skillSelezionata, "errore")} style={[styles.tastoEsito, styles.tastoEsitoErrore]}>
                  <Text style={styles.tastoEsitoTesto}>Errore</Text>
                </Pressable>
              </View>
              <Pressable onPress={() => setSkillSelezionata(null)} style={styles.tastoAnnullaSelezione}>
                <Text style={styles.tastoAnnullaSelezioneTesto}>← torna ai fondamentali</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.rigaControlli}>
            <Pressable onPress={onAnnulla} style={styles.tastoAnnulla} disabled={eventi.length === 0}>
              <Text style={styles.tastoAnnullaTesto}>↺ Annulla ultima azione</Text>
            </Pressable>
            <View style={styles.rigaToggle}>
              <Text style={styles.nota}>Modalità essenziale</Text>
              <Switch value={modalitaEssenziale} onValueChange={setModalitaEssenziale} trackColor={{ true: brand.colors.brand }} />
            </View>
          </View>

          <View style={styles.rigaControlli}>
            <Pressable onPress={onNuovoSet} style={styles.tastoSecondario}><Text style={styles.tastoSecondarioTesto}>Nuovo set</Text></Pressable>
            <Pressable onPress={onChiudiPartita} style={styles.tastoSecondarioDistruttivo}><Text style={styles.tastoSecondarioDistruttivoTesto}>Chiudi partita</Text></Pressable>
          </View>
        </>
      ) : (
        <Text style={styles.nota}>Consultazione in sola lettura.</Text>
      )}

      <Text style={styles.etichettaLog}>Ultimi eventi</Text>
      <FlatList
        data={eventi}
        keyExtractor={(e) => e.id}
        style={{ flex: 1 }}
        ListEmptyComponent={<Text style={styles.nota}>Nessun evento registrato ancora.</Text>}
        renderItem={({ item }) => {
          const atleta = atlete.find((a) => a.id === item.athlete_id);
          return (
            <View style={styles.rigaLog}>
              <Text style={styles.rigaLogTesto}>{item.skill === "Punto_avversario" ? "Punto avversario" : `${item.skill} — ${item.esito}`}{atleta ? ` (${atleta.cognome})` : ""}</Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface, padding: 12, gap: 10 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  scoreboard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14 },
  scoreboardAvversario: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 16 },
  scoreboardSet: { color: brand.colors.muted, fontSize: 12 },
  scoreboardPunti: { color: brand.colors.brand, fontWeight: "800", fontSize: 28 },
  rigaStrisciaAtlete: { flexDirection: "row" },
  chipAtleta: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brand.colors.surfaceSecondary, marginRight: 6 },
  chipAtletaAttiva: { backgroundColor: brand.colors.brandSecondary },
  chipAtletaTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipAtletaTestoAttiva: { color: "#000", fontWeight: "700" },
  grigliaSkill: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tastoSkill: { flexGrow: 1, minWidth: "30%", backgroundColor: brand.colors.surfaceSecondary, paddingVertical: 20, borderRadius: 10, alignItems: "center" },
  tastoSkillTesto: { color: brand.colors.onSurface, fontWeight: "700" },
  tastoPuntoAvversario: { flexBasis: "100%", backgroundColor: "#4A1620", paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  grigliaEsito: { gap: 10 },
  etichettaEsito: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700", textAlign: "center" },
  rigaEsito: { flexDirection: "row", gap: 8 },
  tastoEsito: { flex: 1, paddingVertical: 28, borderRadius: 10, alignItems: "center" },
  tastoEsitoPunto: { backgroundColor: brand.colors.success },
  tastoEsitoNeutro: { backgroundColor: brand.colors.surfaceTertiary },
  tastoEsitoErrore: { backgroundColor: brand.colors.error },
  tastoEsitoTesto: { color: "#fff", fontWeight: "800", fontSize: 16 },
  tastoAnnullaSelezione: { alignItems: "center", paddingVertical: 6 },
  tastoAnnullaSelezioneTesto: { color: brand.colors.muted, fontSize: 13 },
  rigaControlli: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tastoAnnulla: { backgroundColor: brand.colors.surfaceSecondary, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  tastoAnnullaTesto: { color: brand.colors.warning, fontWeight: "700" },
  rigaToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  tastoSecondario: { borderColor: brand.colors.brand, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  tastoSecondarioTesto: { color: brand.colors.brand, fontWeight: "600", fontSize: 13 },
  tastoSecondarioDistruttivo: { borderColor: brand.colors.error, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  tastoSecondarioDistruttivoTesto: { color: brand.colors.error, fontWeight: "600", fontSize: 13 },
  nota: { color: brand.colors.muted, fontSize: 12 },
  etichettaLog: { color: brand.colors.muted, fontSize: 12, textTransform: "uppercase", marginTop: 4 },
  rigaLog: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaLogTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
});
