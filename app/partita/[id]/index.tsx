import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, FlatList, Switch, Alert, Modal } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaAtlete } from "@/src/services/athletes";
import {
  annullaUltimoEvento,
  cambiaGiocatore,
  chiudiMatch,
  elencaConvocati,
  elencaEventiPartita,
  elencaFormazioneConPosizioni,
  elencaSet,
  nuovoSet,
  registraEvento,
} from "@/src/services/matches";
import { brand, skillsScouting, skillsScoutingEssenziali } from "@/src/config";
import type { Athlete, Esito, Match, MatchEvent, MatchSet, MatchSetLineup, Skill } from "@/src/types/database";
import { supabaseClient } from "@/src/lib/supabase";
import { confermaAzione } from "@/src/lib/confermaAzione";
import { Campo9x9, type OccupanteCampo } from "@/src/components/Campo9x9";

/**
 * Interfaccia di scouting live: campo 9x9 con le 6 posizioni reali,
 * rotazione applicata automaticamente dal database ad ogni cambio
 * palla (mai calcolata a mano lato client — vedi i trigger in
 * 0010_regolamento_formazione.sql). Un tap sulla posizione seleziona
 * l'atleta, poi due tap (fondamentale + esito) registrano l'evento.
 * Scrittura ottimistica sul punteggio: il numero si aggiorna subito,
 * la chiamata di rete parte in background.
 */
export default function PartitaLive() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { puoScrivere } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const [setCorrente, setSetCorrente] = useState<MatchSet | null>(null);
  const [eventi, setEventi] = useState<MatchEvent[]>([]);
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [convocateIds, setConvocateIds] = useState<string[]>([]);
  const [formazione, setFormazione] = useState<MatchSetLineup[]>([]);
  const [atletaSelId, setAtletaSelId] = useState<string | null>(null);
  const [skillSelezionata, setSkillSelezionata] = useState<Skill | null>(null);
  const [modalitaEssenziale, setModalitaEssenziale] = useState(false);
  const [popupCambioAperto, setPopupCambioAperto] = useState(false);

  const carica = useCallback(async () => {
    if (!id) return;
    const { data: m } = await supabaseClient.from("matches").select("*").eq("id", id).single();
    setMatch(m ?? null);
    const set = await elencaSet(id);
    const attivo = set.find((s) => !s.concluso) ?? set[set.length - 1] ?? null;
    setSetCorrente(attivo);
    setEventi(await elencaEventiPartita(id));
    if (m) {
      const [lista, convocati] = await Promise.all([elencaAtlete(m.team_id), elencaConvocati(id)]);
      setAtlete(lista);
      setConvocateIds(convocati.map((c) => c.athlete_id));
    }
    if (attivo) setFormazione(await elencaFormazioneConPosizioni(attivo.id));
  }, [id]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  function nomeAtleta(athleteId: string): Athlete | undefined {
    return atlete.find((a) => a.id === athleteId);
  }

  const occupantiCampo: OccupanteCampo[] = formazione.map((f) => {
    const a = nomeAtleta(f.athlete_id);
    return { posizione: f.posizione ?? 0, cognome: a?.cognome ?? "?", numeroMaglia: a?.numero_maglia ?? null, attivo: atletaSelId === f.athlete_id };
  }).filter((o) => o.posizione > 0);

  const inPanchina = atlete.filter((a) => convocateIds.includes(a.id) && !formazione.some((f) => f.athlete_id === a.id));

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
      // La rotazione (se scattata) è avvenuta lato database: ricarichiamo
      // la formazione per rispecchiarla — è l'unica parte non ottimistica,
      // ma è un solo round-trip leggero, non blocca la UI del punteggio.
      carica();
    } catch (e) {
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
      carica(); // la rotazione potrebbe essere stata annullata: ricarica per rispecchiarlo
    } catch (e) {
      carica();
      Alert.alert("Errore nell'annullamento", (e as Error).message);
    }
  }

  async function onNuovoSet() {
    if (!match) return;
    try {
      await nuovoSet(match.id);
      router.replace(`/partita/${match.id}/prepara`);
    } catch (e) { Alert.alert("Errore", (e as Error).message); }
  }

  async function onChiudiPartita() {
    if (!match) return;
    confermaAzione("Chiudere la partita?", "Non potrai più registrare eventi dopo la chiusura.", "Chiudi", async () => {
      try { await chiudiMatch(match.id); router.back(); } catch (e) { Alert.alert("Errore", (e as Error).message); }
    }, true);
  }

  async function onConfermaCambio(entranteId: string) {
    if (!setCorrente || !atletaSelId) return;
    try {
      await cambiaGiocatore(setCorrente.id, atletaSelId, entranteId);
      setPopupCambioAperto(false);
      setAtletaSelId(null);
      carica();
    } catch (e) {
      Alert.alert("Cambio non riuscito", (e as Error).message);
    }
  }

  if (!match) {
    return <View style={styles.container}><Text style={styles.vuoto}>Caricamento…</Text></View>;
  }

  if (match.stato !== "in_corso") {
    return (
      <View style={[styles.container, { alignItems: "center", justifyContent: "center", gap: 16 }]}>
        <Text style={styles.vuoto}>{match.stato === "conclusa" ? "Partita conclusa." : "Partita non ancora iniziata."}</Text>
        {puoScrivere && match.stato === "programmata" && (
          <Pressable style={styles.tastoSecondario} onPress={() => router.push(`/partita/${match.id}/prepara`)}>
            <Text style={styles.tastoSecondarioTesto}>Vai alla preparazione</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (!setCorrente) {
    return <View style={styles.container}><Text style={styles.vuoto}>Caricamento set…</Text></View>;
  }

  const skillsDaMostrare = modalitaEssenziale ? skillsScoutingEssenziali : skillsScouting;
  const atletaSelezionata = atletaSelId ? nomeAtleta(atletaSelId) : null;

  return (
    <View style={styles.container}>
      <View style={styles.scoreboard}>
        <View>
          <Text style={styles.scoreboardAvversario}>vs {match.avversario}</Text>
          <Text style={styles.scoreboardSet}>Set {setCorrente.numero_set} — al servizio: {setCorrente.squadra_al_servizio === "noi" ? "noi" : "loro"}</Text>
        </View>
        <Text style={styles.scoreboardPunti}>{setCorrente.punti_noi} - {setCorrente.punti_avversario}</Text>
      </View>

      {puoScrivere ? (
        <>
          <Campo9x9 occupanti={occupantiCampo} onTapPosizione={(pos) => {
            const occ = occupantiCampo.find((o) => o.posizione === pos);
            const riga = formazione.find((f) => f.posizione === pos);
            setAtletaSelId(riga ? (atletaSelId === riga.athlete_id ? null : riga.athlete_id) : null);
            void occ;
          }} />

          <View style={styles.rigaAzioniAtleta}>
            <Text style={styles.nota}>{atletaSelezionata ? `Selezionata: #${atletaSelezionata.numero_maglia ?? "-"} ${atletaSelezionata.cognome}` : "Tocca una giocatrice in campo"}</Text>
            {atletaSelId && (
              <Pressable onPress={() => setPopupCambioAperto(true)}><Text style={styles.linkCambio}>⇄ Cambio</Text></Pressable>
            )}
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
        <>
          <Campo9x9 occupanti={occupantiCampo} />
          <Text style={styles.nota}>Consultazione in sola lettura.</Text>
        </>
      )}

      <Text style={styles.etichettaLog}>Ultimi eventi</Text>
      <FlatList
        data={eventi}
        keyExtractor={(e) => e.id}
        style={{ flex: 1 }}
        ListEmptyComponent={<Text style={styles.nota}>Nessun evento registrato ancora.</Text>}
        renderItem={({ item }) => {
          const atleta = item.athlete_id ? nomeAtleta(item.athlete_id) : undefined;
          return (
            <View style={styles.rigaLog}>
              <Text style={styles.rigaLogTesto}>{item.skill === "Punto_avversario" ? "Punto avversario" : `${item.skill} — ${item.esito}`}{atleta ? ` (${atleta.cognome})` : ""}</Text>
            </View>
          );
        }}
      />

      <Modal visible={popupCambioAperto} animationType="slide" transparent onRequestClose={() => setPopupCambioAperto(false)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopupFormazione}>
            <View style={styles.intestazionePopup}>
              <Text style={styles.titoloPopup}>Cambio: chi entra per {atletaSelezionata?.cognome}?</Text>
              <Pressable onPress={() => setPopupCambioAperto(false)}><Text style={styles.chiudiPopup}>✕</Text></Pressable>
            </View>
            <FlatList
              data={inPanchina}
              keyExtractor={(a) => a.id}
              ListEmptyComponent={<Text style={styles.nota}>Nessuna convocata in panchina disponibile.</Text>}
              renderItem={({ item }) => (
                <Pressable style={styles.rigaSelezioneFormazione} onPress={() => onConfermaCambio(item.id)}>
                  <Text style={styles.rigaSelezioneFormazioneTesto}>{item.numero_maglia ? `#${item.numero_maglia} ` : ""}{item.nome} {item.cognome}</Text>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
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
  rigaAzioniAtleta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  linkCambio: { color: brand.colors.brandSecondary, fontWeight: "700", fontSize: 13 },
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
  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  cartaPopupFormazione: { backgroundColor: brand.colors.surfaceSecondary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10, maxHeight: "75%" },
  intestazionePopup: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  chiudiPopup: { color: brand.colors.muted, fontSize: 18 },
  rigaSelezioneFormazione: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaSelezioneFormazioneTesto: { color: brand.colors.onSurface, fontSize: 14 },
});
