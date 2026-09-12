import { useCallback, useRef, useState } from "react";
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
  elencaStoricoFormazioneSet,
  leggiRegolePunteggio,
  nuovoSet,
  registraEvento,
} from "@/src/services/matches";
import { brand, skillsScouting, skillsScoutingEssenziali } from "@/src/config";
import type { Athlete, Esito, Match, MatchEvent, MatchSet, MatchSetLineup, Skill } from "@/src/types/database";
import { supabaseClient } from "@/src/lib/supabase";
import { confermaAzione } from "@/src/lib/confermaAzione";
import { Campo9x9, type OccupanteCampo } from "@/src/components/Campo9x9";

interface CambioInSospeso {
  uscente: Athlete;
  entrante: Athlete;
}

export default function PartitaLive() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { puoScrivere } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const [setCorrente, setSetCorrente] = useState<MatchSet | null>(null);
  const [eventi, setEventi] = useState<MatchEvent[]>([]);
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [convocateIds, setConvocateIds] = useState<string[]>([]);
  const [formazione, setFormazione] = useState<MatchSetLineup[]>([]);
  const [storicoFormazione, setStoricoFormazione] = useState<MatchSetLineup[]>([]);
  const [atletaSelId, setAtletaSelId] = useState<string | null>(null);
  const [skillSelezionata, setSkillSelezionata] = useState<Skill | null>(null);
  const [modalitaEssenziale, setModalitaEssenziale] = useState(true);
  const [popupCambioAperto, setPopupCambioAperto] = useState(false);
  const [cambioInSospeso, setCambioInSospeso] = useState<CambioInSospeso | null>(null);
  const [erroreVisibile, setErroreVisibile] = useState<string | null>(null);
  const [regolePunteggio, setRegolePunteggio] = useState({ puntiPerSet: 25, puntiSetDecisivo: 15 });
  const ultimoPunteggioSegnalato = useRef("");

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
    if (attivo) {
      const [inCampo, storico] = await Promise.all([elencaFormazioneConPosizioni(attivo.id), elencaStoricoFormazioneSet(attivo.id)]);
      setFormazione(inCampo);
      setStoricoFormazione(storico);
    }
    if (m) {
      const regole = await leggiRegolePunteggio(id);
      setRegolePunteggio(regole);
    }
    if (attivo && m) verificaFineSetAutomatica(attivo, m);
  }, [id]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  /**
   * Controlla il punteggio del set corrente contro le regole vere di
   * regolamento (25 punti/2 di scarto, 15 al 5° set — o quelle del
   * campionato collegato se diverse) e, se il set risulta concluso,
   * lo segnala automaticamente invece di aspettare che l'allenatore
   * se ne accorga da solo e prema "Nuovo set" a mano. Se la vittoria
   * di questo set porta a 3 set vinti, propone di chiudere la
   * partita invece che aprire un set che non si giocherà mai.
   * "ultimoPunteggioSegnalato" evita di ripetere lo stesso avviso ad
   * ogni ricarica finché il punteggio non cambia.
   */
  function verificaFineSetAutomatica(set: MatchSet, m: Match) {
    if (set.concluso) return;
    const sogliaPunti = set.numero_set === 5 ? regolePunteggio.puntiSetDecisivo : regolePunteggio.puntiPerSet;
    const noiVincono = set.punti_noi >= sogliaPunti && set.punti_noi - set.punti_avversario >= 2;
    const loroVincono = set.punti_avversario >= sogliaPunti && set.punti_avversario - set.punti_noi >= 2;
    if (!noiVincono && !loroVincono) return;

    const chiave = `${set.id}-${set.punti_noi}-${set.punti_avversario}`;
    if (ultimoPunteggioSegnalato.current === chiave) return;
    ultimoPunteggioSegnalato.current = chiave;

    // Set vinti finora, includendo questo che sta per concludersi.
    const setVintiNoiOraCompreso = (m.set_vinti_noi ?? 0) + (noiVincono ? 1 : 0);
    const setVintiLoroOraCompreso = (m.set_vinti_avversario ?? 0) + (loroVincono ? 1 : 0);
    const partitaFinita = setVintiNoiOraCompreso >= 3 || setVintiLoroOraCompreso >= 3;

    confermaAzione(
      partitaFinita ? "Partita conclusa!" : "Set concluso!",
      `${set.punti_noi} - ${set.punti_avversario}. ${partitaFinita ? "Chiudere la partita?" : "Passare alla formazione del prossimo set?"}`,
      partitaFinita ? "Chiudi partita" : "Prossimo set",
      async () => {
        try {
          if (partitaFinita) {
            await chiudiMatch(m.id);
            router.back();
          } else {
            await nuovoSet(m.id);
            router.replace(`/partita/${m.id}/prepara`);
          }
        } catch (e) { Alert.alert("Errore", (e as Error).message); }
      },
    );
  }

  function nomeAtleta(athleteId: string): Athlete | undefined {
    return atlete.find((a) => a.id === athleteId);
  }

  const occupantiCampo: OccupanteCampo[] = formazione.map((f) => {
    const a = nomeAtleta(f.athlete_id);
    return {
      posizione: f.posizione ?? 0,
      cognome: a?.cognome ?? "?",
      numeroMaglia: a?.numero_maglia ?? null,
      ruolo: a?.ruolo_campo ?? null,
      attivo: atletaSelId === f.athlete_id,
    };
  }).filter((o) => o.posizione > 0);

  // Chi è già uscita in questo set (una riga con in_campo=false è la
  // "prova" che era in campo ed è stata sostituita): esclusa dal
  // cambio, non può rientrare — richiesto esplicitamente.
  const idGiaUscite = new Set(storicoFormazione.filter((r) => !r.in_campo).map((r) => r.athlete_id));
  const inPanchina = atlete.filter((a) => convocateIds.includes(a.id) && !formazione.some((f) => f.athlete_id === a.id) && !idGiaUscite.has(a.id));

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
    setErroreVisibile(null);
    const eventoOttimistico: MatchEvent = {
      id: `temp-${Date.now()}`, match_id: match.id, set_id: setCorrente.id, skill, esito,
      athlete_id: atletaSelId, creato_il: new Date().toISOString(), creato_da: null,
    };
    setEventi((prev) => [eventoOttimistico, ...prev]);
    applicaDeltaLocale(skill, esito, 1);
    setSkillSelezionata(null);
    // Deseleziona subito la giocatrice: un evento registrato = pronta
    // per la prossima azione, non resta "appiccicata" alla selezione
    // precedente (richiesto esplicitamente).
    setAtletaSelId(null);

    try {
      await registraEvento(match.id, setCorrente.id, skill, esito, eventoOttimistico.athlete_id);
      carica();
    } catch (e) {
      const messaggio = (e as Error).message;
      console.error("Errore registrazione evento:", e);
      setEventi((prev) => prev.filter((ev) => ev.id !== eventoOttimistico.id));
      applicaDeltaLocale(skill, esito, -1);
      setErroreVisibile(messaggio);
      Alert.alert("Evento non salvato", messaggio);
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
      carica();
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

  /** Fase 1 del cambio: segna a video chi entra ed esce, non esegue ancora nulla. */
  function onSegnaCambio(entrante: Athlete) {
    const uscente = atletaSelId ? nomeAtleta(atletaSelId) : undefined;
    if (!uscente) return;
    setCambioInSospeso({ uscente, entrante });
    setPopupCambioAperto(false);
  }

  /** Fase 2: chiude davvero il cambio (chiamata al database). Da qui la giocatrice uscita non può più rientrare in questo set. */
  async function onChiudiCambio() {
    if (!setCorrente || !cambioInSospeso) return;
    try {
      await cambiaGiocatore(setCorrente.id, cambioInSospeso.uscente.id, cambioInSospeso.entrante.id);
      setCambioInSospeso(null);
      setAtletaSelId(null);
      carica();
    } catch (e) {
      Alert.alert("Cambio non riuscito", (e as Error).message);
    }
  }

  function onAnnullaCambioInSospeso() {
    setCambioInSospeso(null);
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
  const atletaAlServizio = setCorrente.squadra_al_servizio === "noi" ? formazione.find((f) => f.posizione === 1) : null;
  const nomeAlServizio = atletaAlServizio ? nomeAtleta(atletaAlServizio.athlete_id) : null;

  return (
    <View style={styles.container}>
      <View style={styles.scoreboard}>
        <View>
          <Text style={styles.scoreboardAvversario}>vs {match.avversario}</Text>
          <Text style={styles.scoreboardSet}>
            Set {setCorrente.numero_set} — al servizio: {setCorrente.squadra_al_servizio === "noi" ? (nomeAlServizio ? `noi (#${nomeAlServizio.numero_maglia ?? "-"} ${nomeAlServizio.cognome})` : "noi") : "loro"}
          </Text>
        </View>
        <Text style={styles.scoreboardPunti}>{setCorrente.punti_noi} - {setCorrente.punti_avversario}</Text>
      </View>

      {erroreVisibile && (
        <Pressable style={styles.bannerErrore} onPress={() => setErroreVisibile(null)}>
          <Text style={styles.bannerErroreTesto}>⚠ {erroreVisibile} (tocca per chiudere)</Text>
        </Pressable>
      )}

      {cambioInSospeso && (
        <View style={styles.bannerCambio}>
          <Text style={styles.bannerCambioTesto}>
            Cambio: <Text style={{ fontWeight: "800" }}>#{cambioInSospeso.uscente.numero_maglia ?? "-"} {cambioInSospeso.uscente.cognome}</Text> esce, <Text style={{ fontWeight: "800" }}>#{cambioInSospeso.entrante.numero_maglia ?? "-"} {cambioInSospeso.entrante.cognome}</Text> entra
          </Text>
          <View style={styles.bannerCambioAzioni}>
            <Pressable onPress={onAnnullaCambioInSospeso}><Text style={styles.linkAnnullaCambio}>Annulla</Text></Pressable>
            <Pressable style={styles.bottoneChiudiCambio} onPress={onChiudiCambio}><Text style={styles.bottoneChiudiCambioTesto}>✓ Chiudi cambio</Text></Pressable>
          </View>
        </View>
      )}

      {puoScrivere ? (
        <>
          <Campo9x9 occupanti={occupantiCampo} onTapPosizione={(pos) => {
            const riga = formazione.find((f) => f.posizione === pos);
            setAtletaSelId(riga ? (atletaSelId === riga.athlete_id ? null : riga.athlete_id) : null);
          }} />

          <View style={styles.rigaAzioniAtleta}>
            <Text style={styles.nota}>{atletaSelezionata ? `Selezionata: #${atletaSelezionata.numero_maglia ?? "-"} ${atletaSelezionata.cognome}` : "Tocca una giocatrice in campo"}</Text>
            {atletaSelId && !cambioInSospeso && (
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
              <Text style={styles.nota}>Essenziale</Text>
              <Switch value={modalitaEssenziale} onValueChange={setModalitaEssenziale} trackColor={{ true: brand.colors.brand }} />
            </View>
          </View>

          <View style={styles.rigaControlli}>
            <Pressable onPress={onNuovoSet} style={styles.tastoSecondario}><Text style={styles.tastoSecondarioTesto}>Nuovo set</Text></Pressable>
            <Pressable onPress={onChiudiPartita} style={styles.tastoSecondarioDistruttivo}><Text style={styles.tastoSecondarioDistruttivoTesto}>Chiudi partita</Text></Pressable>
          </View>

          {idGiaUscite.size > 0 && (
            <View style={styles.rigaUscite}>
              {[...idGiaUscite].map((idA) => {
                const a = nomeAtleta(idA);
                return a ? <Text key={idA} style={styles.tagUscita}>#{a.numero_maglia ?? "-"} {a.cognome} — uscita</Text> : null;
              })}
            </View>
          )}
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
                <Pressable style={styles.rigaSelezioneFormazione} onPress={() => onSegnaCambio(item)}>
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
  container: { flex: 1, backgroundColor: brand.colors.surface, padding: 12, gap: 8 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  scoreboard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 12 },
  scoreboardAvversario: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 15 },
  scoreboardSet: { color: brand.colors.muted, fontSize: 11 },
  scoreboardPunti: { color: brand.colors.brand, fontWeight: "800", fontSize: 26 },
  bannerErrore: { backgroundColor: "#4A1620", borderRadius: 8, padding: 10 },
  bannerErroreTesto: { color: "#fff", fontSize: 12, fontWeight: "600" },
  bannerCambio: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 8, padding: 10, gap: 8, borderWidth: 1, borderColor: brand.colors.brandSecondary },
  bannerCambioTesto: { color: brand.colors.onSurface, fontSize: 13 },
  bannerCambioAzioni: { flexDirection: "row", justifyContent: "flex-end", gap: 16, alignItems: "center" },
  linkAnnullaCambio: { color: brand.colors.muted, fontSize: 12 },
  bottoneChiudiCambio: { backgroundColor: brand.colors.success, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  bottoneChiudiCambioTesto: { color: "#000", fontWeight: "700", fontSize: 12 },
  rigaAzioniAtleta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  linkCambio: { color: brand.colors.brandSecondary, fontWeight: "700", fontSize: 13 },
  grigliaSkill: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tastoSkill: { flexGrow: 1, minWidth: "30%", backgroundColor: brand.colors.surfaceSecondary, paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  tastoSkillTesto: { color: brand.colors.onSurface, fontWeight: "700" },
  tastoPuntoAvversario: { flexBasis: "100%", backgroundColor: "#4A1620", paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  grigliaEsito: { gap: 8 },
  etichettaEsito: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700", textAlign: "center" },
  rigaEsito: { flexDirection: "row", gap: 6 },
  tastoEsito: { flex: 1, paddingVertical: 20, borderRadius: 10, alignItems: "center" },
  tastoEsitoPunto: { backgroundColor: brand.colors.success },
  tastoEsitoNeutro: { backgroundColor: brand.colors.surfaceTertiary },
  tastoEsitoErrore: { backgroundColor: brand.colors.error },
  tastoEsitoTesto: { color: "#fff", fontWeight: "800", fontSize: 15 },
  tastoAnnullaSelezione: { alignItems: "center", paddingVertical: 4 },
  tastoAnnullaSelezioneTesto: { color: brand.colors.muted, fontSize: 12 },
  rigaControlli: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tastoAnnulla: { backgroundColor: brand.colors.surfaceSecondary, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  tastoAnnullaTesto: { color: brand.colors.warning, fontWeight: "700", fontSize: 12 },
  rigaToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  tastoSecondario: { borderColor: brand.colors.brand, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  tastoSecondarioTesto: { color: brand.colors.brand, fontWeight: "600", fontSize: 12 },
  tastoSecondarioDistruttivo: { borderColor: brand.colors.error, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  tastoSecondarioDistruttivoTesto: { color: brand.colors.error, fontWeight: "600", fontSize: 12 },
  rigaUscite: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tagUscita: { color: brand.colors.error, fontSize: 10, fontWeight: "600" },
  nota: { color: brand.colors.muted, fontSize: 12 },
  etichettaLog: { color: brand.colors.muted, fontSize: 11, textTransform: "uppercase" },
  rigaLog: { paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaLogTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  cartaPopupFormazione: { backgroundColor: brand.colors.surfaceSecondary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10, maxHeight: "75%" },
  intestazionePopup: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  chiudiPopup: { color: brand.colors.muted, fontSize: 18 },
  rigaSelezioneFormazione: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaSelezioneFormazioneTesto: { color: brand.colors.onSurface, fontSize: 14 },
});
