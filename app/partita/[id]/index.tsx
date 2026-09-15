import { useCallback, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Switch, Modal, ActivityIndicator, FlatList } from "react-native";
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
  rendimentoRotazioniPartita,
  type RendimentoRotazionePartita,
} from "@/src/services/matches";
import { chiediParerePartitaAI } from "@/src/services/evaluations";
import { analizzaSituazione, riassuntoPerAI, type SegnalazioneSituazione } from "@/src/lib/situazione";
import { brand, skillsScouting, skillsScoutingEssenziali } from "@/src/config";
import type { Athlete, Esito, Match, MatchEvent, MatchSet, MatchSetLineup, Skill } from "@/src/types/database";
import { supabaseClient } from "@/src/lib/supabase";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { Campo9x9, type OccupanteCampo } from "@/src/components/Campo9x9";

type Passo = "giocatrice" | "fondamentale" | "esito";

/**
 * Scouting live. Due scelte di impostazione volute:
 *
 * 1. SEMPRE IN ORIZZONTALE, anche a telefono bloccato in verticale: il
 *    contenuto è disposto in riga (campo quadrato a sinistra, comandi a
 *    destra) invece di affidarsi alla rotazione dello schermo, che su
 *    molti telefoni è disattivata proprio per non ruotare per sbaglio.
 *
 * 2. FLUSSO A TRE PASSI: giocatrice → fondamentale → esito. Ricalca
 *    l'ordine con cui si osserva l'azione ("ha sbagliato LEI, in
 *    RICEZIONE") e rende impossibile registrare un evento senza
 *    attribuzione, che era il difetto del flusso precedente.
 */
export default function PartitaLive() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { team, puoScrivere } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const [setCorrente, setSetCorrente] = useState<MatchSet | null>(null);
  const [eventi, setEventi] = useState<MatchEvent[]>([]);
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [convocateIds, setConvocateIds] = useState<string[]>([]);
  const [formazione, setFormazione] = useState<MatchSetLineup[]>([]);
  const [storicoFormazione, setStoricoFormazione] = useState<MatchSetLineup[]>([]);

  const [atletaSelId, setAtletaSelId] = useState<string | null>(null);
  const [skillSel, setSkillSel] = useState<Skill | null>(null);
  const [modalitaEssenziale, setModalitaEssenziale] = useState(true);
  const [popupCambio, setPopupCambio] = useState(false);
  const [cambioInSospeso, setCambioInSospeso] = useState<{ uscente: Athlete; entrante: Athlete } | null>(null);
  const [erroreVisibile, setErroreVisibile] = useState<string | null>(null);
  const [regolePunteggio, setRegolePunteggio] = useState({ puntiPerSet: 25, puntiSetDecisivo: 15 });
  const ultimoPunteggioSegnalato = useRef("");

  const [popupSituazione, setPopupSituazione] = useState(false);
  const [rotazioni, setRotazioni] = useState<RendimentoRotazionePartita[]>([]);
  const [parereAI, setParereAI] = useState<string | null>(null);
  const [chiedendoAI, setChiedendoAI] = useState(false);

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
      setRegolePunteggio(await leggiRegolePunteggio(id));
    }
    if (attivo) {
      const [inCampo, storico] = await Promise.all([elencaFormazioneConPosizioni(attivo.id), elencaStoricoFormazioneSet(attivo.id)]);
      setFormazione(inCampo);
      setStoricoFormazione(storico);
    }
    if (attivo && m) verificaFineSet(attivo, m, set);
  }, [id]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  function nomeAtleta(athleteId: string): Athlete | undefined {
    return atlete.find((a) => a.id === athleteId);
  }
  function etichettaAtleta(athleteId: string): string {
    const a = nomeAtleta(athleteId);
    return a ? `#${a.numero_maglia ?? "-"} ${a.cognome}` : "—";
  }

  function verificaFineSet(set: MatchSet, m: Match, tuttiISet: MatchSet[]) {
    if (set.concluso) return;
    const soglia = set.numero_set === 5 ? regolePunteggio.puntiSetDecisivo : regolePunteggio.puntiPerSet;
    const noi = set.punti_noi >= soglia && set.punti_noi - set.punti_avversario >= 2;
    const loro = set.punti_avversario >= soglia && set.punti_avversario - set.punti_noi >= 2;
    if (!noi && !loro) return;

    const chiave = `${set.id}-${set.punti_noi}-${set.punti_avversario}`;
    if (ultimoPunteggioSegnalato.current === chiave) return;
    ultimoPunteggioSegnalato.current = chiave;

    const vintiNoi = tuttiISet.filter((s) => s.concluso && s.punti_noi > s.punti_avversario).length + (noi ? 1 : 0);
    const vintiLoro = tuttiISet.filter((s) => s.concluso && s.punti_avversario > s.punti_noi).length + (loro ? 1 : 0);
    const finita = vintiNoi >= 3 || vintiLoro >= 3;

    confermaAzione(
      finita ? "Partita conclusa!" : "Set concluso!",
      `${set.punti_noi} - ${set.punti_avversario} (set ${vintiNoi}-${vintiLoro}). ${finita ? "Chiudere la partita?" : "Passare al prossimo set?"}`,
      finita ? "Chiudi partita" : "Prossimo set",
      async () => {
        try {
          if (finita) { await chiudiMatch(m.id); router.back(); }
          else { await nuovoSet(m.id); router.replace(`/partita/${m.id}/prepara`); }
        } catch (e) { avvisa("Errore", (e as Error).message); }
      },
    );
  }

  const idGiaUscite = new Set(storicoFormazione.filter((r) => !r.in_campo).map((r) => r.athlete_id));
  const inPanchina = atlete.filter((a) => convocateIds.includes(a.id) && !formazione.some((f) => f.athlete_id === a.id) && !idGiaUscite.has(a.id));

  const occupanti: OccupanteCampo[] = formazione.map((f) => {
    const a = nomeAtleta(f.athlete_id);
    return {
      posizione: f.posizione ?? 0,
      cognome: a?.cognome ?? "?",
      numeroMaglia: a?.numero_maglia ?? null,
      ruolo: a?.ruolo_campo ?? null,
      attivo: atletaSelId === f.athlete_id,
    };
  }).filter((o) => o.posizione > 0);

  function applicaDelta(skill: Skill, esito: Esito | null, segno: 1 | -1) {
    setSetCorrente((prev) => {
      if (!prev) return prev;
      const avv = skill === "Punto_avversario" || esito === "errore";
      const nostro = esito === "punto";
      return {
        ...prev,
        punti_avversario: avv ? Math.max(0, prev.punti_avversario + segno) : prev.punti_avversario,
        punti_noi: nostro ? Math.max(0, prev.punti_noi + segno) : prev.punti_noi,
      };
    });
  }

  async function registra(skill: Skill, esito: Esito | null, athleteId: string | null) {
    if (!match || !setCorrente) return;
    setErroreVisibile(null);
    const provvisorio: MatchEvent = {
      id: `temp-${Date.now()}`, match_id: match.id, set_id: setCorrente.id, skill, esito,
      athlete_id: athleteId, creato_il: new Date().toISOString(), creato_da: null,
    };
    setEventi((prev) => [provvisorio, ...prev]);
    applicaDelta(skill, esito, 1);
    setSkillSel(null);
    setAtletaSelId(null);

    try {
      await registraEvento(match.id, setCorrente.id, skill, esito, athleteId);
      carica();
    } catch (e) {
      const msg = (e as Error).message;
      setEventi((prev) => prev.filter((ev) => ev.id !== provvisorio.id));
      applicaDelta(skill, esito, -1);
      setErroreVisibile(msg);
      avvisa("Evento non salvato", msg);
    }
  }

  async function onAnnulla() {
    if (!match || eventi.length === 0) return;
    const ultimo = eventi[0];
    setEventi((prev) => prev.slice(1));
    applicaDelta(ultimo.skill, ultimo.esito, -1);
    try { await annullaUltimoEvento(match.id); carica(); }
    catch (e) { carica(); avvisa("Errore", (e as Error).message); }
  }

  async function apriSituazione() {
    setPopupSituazione(true);
    setParereAI(null);
    if (match) {
      try { setRotazioni(await rendimentoRotazioniPartita(match.id)); } catch { setRotazioni([]); }
    }
  }

  async function onChiediAI() {
    if (!match || !team || !setCorrente) return;
    setChiedendoAI(true);
    try {
      const riassunto = riassuntoPerAI(eventi, (aid) => etichettaAtleta(aid), `${setCorrente.punti_noi}-${setCorrente.punti_avversario}`);
      const r = await chiediParerePartitaAI(team.id, riassunto);
      if (r.errore) { avvisa("Parere non disponibile", r.messaggio ?? "Errore"); return; }
      setParereAI(r.testo ?? null);
    } finally {
      setChiedendoAI(false);
    }
  }

  function onChiudiPartita() {
    if (!match) return;
    confermaAzione("Chiudere la partita?", "Non potrai più registrare eventi.", "Chiudi", async () => {
      try { await chiudiMatch(match.id); router.back(); } catch (e) { avvisa("Errore", (e as Error).message); }
    }, true);
  }

  async function onChiudiCambio() {
    if (!setCorrente || !cambioInSospeso) return;
    try {
      await cambiaGiocatore(setCorrente.id, cambioInSospeso.uscente.id, cambioInSospeso.entrante.id);
      setCambioInSospeso(null); setAtletaSelId(null); carica();
    } catch (e) { avvisa("Cambio non riuscito", (e as Error).message); }
  }

  if (!match) return <View style={styles.contenitore}><Text style={styles.vuoto}>Caricamento…</Text></View>;

  if (match.stato !== "in_corso") {
    return (
      <View style={[styles.contenitore, { alignItems: "center", justifyContent: "center", gap: 16 }]}>
        <Text style={styles.vuoto}>{match.stato === "conclusa" ? "Partita conclusa." : "Partita non ancora iniziata."}</Text>
        {puoScrivere && match.stato === "programmata" && (
          <Pressable style={styles.bottoneSecondario} onPress={() => router.push(`/partita/${match.id}/prepara`)}>
            <Text style={styles.bottoneSecondarioTesto}>Vai alla preparazione</Text>
          </Pressable>
        )}
        {match.stato === "conclusa" && (
          <Pressable style={styles.bottoneSecondario} onPress={apriSituazione}>
            <Text style={styles.bottoneSecondarioTesto}>Vedi analisi rotazioni</Text>
          </Pressable>
        )}
        <ModaleSituazione />
      </View>
    );
  }

  if (!setCorrente) return <View style={styles.contenitore}><Text style={styles.vuoto}>Caricamento set…</Text></View>;

  const skills = modalitaEssenziale ? skillsScoutingEssenziali : skillsScouting;
  const selezionata = atletaSelId ? nomeAtleta(atletaSelId) : null;
  const alServizio = setCorrente.squadra_al_servizio === "noi" ? formazione.find((f) => f.posizione === 1) : null;
  const passo: Passo = !atletaSelId ? "giocatrice" : !skillSel ? "fondamentale" : "esito";

  function ModaleSituazione() {
    const segnalazioni: SegnalazioneSituazione[] = analizzaSituazione(eventi, (aid) => etichettaAtleta(aid));
    return (
      <Modal visible={popupSituazione} animationType="slide" transparent onRequestClose={() => setPopupSituazione(false)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <View style={styles.intestazionePopup}>
              <Text style={styles.titoloPopup}>Come stiamo andando</Text>
              <Pressable onPress={() => setPopupSituazione(false)} hitSlop={12}><Text style={styles.chiudiPopup}>✕</Text></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ gap: 10 }}>
              {segnalazioni.map((s, i) => (
                <Text key={i} style={[styles.segnalazione, s.gravita === "attenzione" && styles.segnalazioneAttenzione]}>
                  {s.gravita === "attenzione" ? "⚠ " : "• "}{s.testo}
                </Text>
              ))}

              <Text style={styles.titoloSezionePopup}>Rendimento per rotazione</Text>
              {rotazioni.length === 0 ? (
                <Text style={styles.nota}>Nessun dato per rotazione ancora.</Text>
              ) : (
                rotazioni.map((r, i) => (
                  <View key={i} style={styles.rigaRotazione}>
                    <Text style={styles.rigaRotazioneNome}>al servizio {r.rotazione_di}</Text>
                    <Text style={[styles.rigaRotazioneSaldo, r.saldo < 0 && styles.saldoNegativo]}>
                      {r.saldo >= 0 ? "+" : ""}{r.saldo}  ({r.punti_fatti}/{r.errori_commessi})
                    </Text>
                  </View>
                ))
              )}

              <Text style={styles.titoloSezionePopup}>Parere dell'assistente</Text>
              {parereAI ? (
                <Text style={styles.parere}>{parereAI}</Text>
              ) : (
                <Pressable style={styles.bottoneAI} onPress={onChiediAI} disabled={chiedendoAI}>
                  {chiedendoAI ? <ActivityIndicator color={brand.colors.brandSecondary} /> : <Text style={styles.bottoneAITesto}>✨ Chiedi un parere</Text>}
                </Pressable>
              )}
              <Text style={styles.nota}>Le letture qui sopra sono calcolate in locale e non consumano nulla. Il parere discorsivo parte solo se lo chiedi.</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <View style={styles.contenitore}>
      {/* Disposizione in riga a prescindere dall'orientamento del telefono. */}
      <View style={styles.colonnaCampo}>
        <View style={styles.campoQuadrato}>
          <Campo9x9
            occupanti={occupanti}
            onTapPosizione={(pos) => {
              const riga = formazione.find((f) => f.posizione === pos);
              if (!riga) return;
              setAtletaSelId(atletaSelId === riga.athlete_id ? null : riga.athlete_id);
              setSkillSel(null);
            }}
          />
        </View>
        <View style={styles.rigaSottoCampo}>
          <Text style={styles.nota} numberOfLines={1}>
            servizio: {setCorrente.squadra_al_servizio === "noi" ? (alServizio ? etichettaAtleta(alServizio.athlete_id) : "noi") : "loro"}
          </Text>
          <View style={styles.rigaToggle}>
            <Text style={styles.nota}>Essenziale</Text>
            <Switch value={modalitaEssenziale} onValueChange={setModalitaEssenziale} trackColor={{ true: brand.colors.brand }} />
          </View>
        </View>
      </View>

      <View style={styles.colonnaComandi}>
        <View style={styles.tabellone}>
          <View style={{ flex: 1 }}>
            <Text style={styles.avversario} numberOfLines={1}>vs {match.avversario}</Text>
            <Text style={styles.setNumero}>Set {setCorrente.numero_set}</Text>
          </View>
          <Text style={styles.punteggio}>{setCorrente.punti_noi}-{setCorrente.punti_avversario}</Text>
        </View>

        {erroreVisibile && (
          <Pressable style={styles.bannerErrore} onPress={() => setErroreVisibile(null)}>
            <Text style={styles.bannerErroreTesto}>⚠ {erroreVisibile}</Text>
          </Pressable>
        )}

        {cambioInSospeso && (
          <View style={styles.bannerCambio}>
            <Text style={styles.bannerCambioTesto} numberOfLines={2}>
              {cambioInSospeso.uscente.cognome} esce · {cambioInSospeso.entrante.cognome} entra
            </Text>
            <View style={styles.rigaBannerAzioni}>
              <Pressable onPress={() => setCambioInSospeso(null)}><Text style={styles.nota}>Annulla</Text></Pressable>
              <Pressable style={styles.bottoneChiudiCambio} onPress={onChiudiCambio}><Text style={styles.bottoneChiudiCambioTesto}>✓ Chiudi cambio</Text></Pressable>
            </View>
          </View>
        )}

        {puoScrivere ? (
          <ScrollView contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
            <Text style={styles.indicazionePasso}>
              {passo === "giocatrice" && "1. Tocca la giocatrice sul campo"}
              {passo === "fondamentale" && `2. ${selezionata ? etichettaAtleta(selezionata.id) : ""} — quale fondamentale?`}
              {passo === "esito" && `3. ${skillSel} — com'è andata?`}
            </Text>

            {passo === "giocatrice" && (
              <>
                <Pressable style={styles.bottonePuntoAvversario} onPress={() => registra("Punto_avversario", null, null)}>
                  <Text style={styles.bottonePuntoAvversarioTesto}>Punto avversario</Text>
                </Pressable>
                <Text style={styles.nota}>Usa questo quando il punto arriva senza un'azione da attribuire (es. errore loro in battuta).</Text>
              </>
            )}

            {passo === "fondamentale" && (
              <View style={styles.griglia}>
                {skills.map((s) => (
                  <Pressable key={s.skill} onPress={() => setSkillSel(s.skill)} style={styles.tastoGriglia}>
                    <Text style={styles.tastoGrigliaTesto}>{s.etichetta}</Text>
                  </Pressable>
                ))}
                <Pressable onPress={() => { setAtletaSelId(null); setSkillSel(null); }} style={styles.tastoAnnullaPasso}>
                  <Text style={styles.nota}>← cambia giocatrice</Text>
                </Pressable>
              </View>
            )}

            {passo === "esito" && skillSel && (
              <>
                <Pressable style={[styles.tastoEsito, styles.esitoPunto]} onPress={() => registra(skillSel, "punto", atletaSelId)}>
                  <Text style={styles.tastoEsitoTesto}>Punto</Text>
                </Pressable>
                <Pressable style={[styles.tastoEsito, styles.esitoNeutro]} onPress={() => registra(skillSel, "neutro", atletaSelId)}>
                  <Text style={styles.tastoEsitoTesto}>Neutro</Text>
                </Pressable>
                <Pressable style={[styles.tastoEsito, styles.esitoErrore]} onPress={() => registra(skillSel, "errore", atletaSelId)}>
                  <Text style={styles.tastoEsitoTesto}>Errore</Text>
                </Pressable>
                <Pressable onPress={() => setSkillSel(null)} style={styles.tastoAnnullaPasso}>
                  <Text style={styles.nota}>← cambia fondamentale</Text>
                </Pressable>
              </>
            )}

            <View style={styles.rigaComandiSecondari}>
              <Pressable onPress={onAnnulla} style={styles.tastoPiccolo} disabled={eventi.length === 0}>
                <Text style={styles.tastoPiccoloTesto}>↺ Annulla</Text>
              </Pressable>
              <Pressable onPress={apriSituazione} style={styles.tastoPiccolo}>
                <Text style={styles.tastoPiccoloTesto}>📊 Situazione</Text>
              </Pressable>
              {atletaSelId && !cambioInSospeso && (
                <Pressable onPress={() => setPopupCambio(true)} style={styles.tastoPiccolo}>
                  <Text style={styles.tastoPiccoloTesto}>⇄ Cambio</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.rigaComandiSecondari}>
              <Pressable onPress={async () => { try { await nuovoSet(match.id); router.replace(`/partita/${match.id}/prepara`); } catch (e) { avvisa("Errore", (e as Error).message); } }} style={styles.tastoPiccolo}>
                <Text style={styles.tastoPiccoloTesto}>Nuovo set</Text>
              </Pressable>
              <Pressable onPress={onChiudiPartita} style={styles.tastoPiccoloDistruttivo}>
                <Text style={styles.tastoPiccoloDistruttivoTesto}>Chiudi partita</Text>
              </Pressable>
            </View>

            <Text style={styles.etichettaLog}>Ultimi eventi</Text>
            {eventi.slice(0, 6).map((e) => (
              <Text key={e.id} style={styles.rigaLog} numberOfLines={1}>
                {e.skill === "Punto_avversario" ? "Punto avversario" : `${e.skill} ${e.esito}`}
                {e.athlete_id ? ` · ${etichettaAtleta(e.athlete_id)}` : ""}
              </Text>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.nota}>Consultazione in sola lettura.</Text>
        )}
      </View>

      <Modal visible={popupCambio} animationType="slide" transparent onRequestClose={() => setPopupCambio(false)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <View style={styles.intestazionePopup}>
              <Text style={styles.titoloPopup}>Chi entra per {selezionata?.cognome}?</Text>
              <Pressable onPress={() => setPopupCambio(false)} hitSlop={12}><Text style={styles.chiudiPopup}>✕</Text></Pressable>
            </View>
            <FlatList
              data={inPanchina}
              keyExtractor={(a) => a.id}
              ListEmptyComponent={<Text style={styles.nota}>Nessuna convocata disponibile.</Text>}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.rigaScelta}
                  onPress={() => {
                    const uscente = atletaSelId ? nomeAtleta(atletaSelId) : undefined;
                    if (uscente) setCambioInSospeso({ uscente, entrante: item });
                    setPopupCambio(false);
                  }}
                >
                  <Text style={styles.rigaSceltaTesto}>#{item.numero_maglia ?? "-"} {item.nome} {item.cognome}</Text>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>

      <ModaleSituazione />
    </View>
  );
}

const styles = StyleSheet.create({
  // Riga anziché colonna: garantisce la disposizione "orizzontale"
  // anche quando il telefono è bloccato in verticale.
  contenitore: { flex: 1, flexDirection: "row", backgroundColor: brand.colors.surface, padding: 8, gap: 8 },
  colonnaCampo: { flex: 1.1, gap: 6 },
  campoQuadrato: { aspectRatio: 1, justifyContent: "center" },
  rigaSottoCampo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  colonnaComandi: { flex: 1, gap: 8 },

  tabellone: { flexDirection: "row", alignItems: "center", backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, padding: 10, gap: 8 },
  avversario: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 13 },
  setNumero: { color: brand.colors.muted, fontSize: 11 },
  punteggio: { color: brand.colors.brand, fontWeight: "800", fontSize: 26 },

  indicazionePasso: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "700" },
  griglia: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tastoGriglia: { flexGrow: 1, minWidth: "46%", backgroundColor: brand.colors.surfaceSecondary, paddingVertical: 16, borderRadius: 10, alignItems: "center" },
  tastoGrigliaTesto: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 13 },
  tastoEsito: { paddingVertical: 18, borderRadius: 10, alignItems: "center" },
  esitoPunto: { backgroundColor: brand.colors.success },
  esitoNeutro: { backgroundColor: brand.colors.surfaceTertiary },
  esitoErrore: { backgroundColor: brand.colors.error },
  tastoEsitoTesto: { color: "#fff", fontWeight: "800", fontSize: 16 },
  tastoAnnullaPasso: { alignItems: "center", paddingVertical: 6 },
  bottonePuntoAvversario: { backgroundColor: "#4A1620", paddingVertical: 16, borderRadius: 10, alignItems: "center" },
  bottonePuntoAvversarioTesto: { color: "#fff", fontWeight: "800" },

  rigaComandiSecondari: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tastoPiccolo: { flexGrow: 1, backgroundColor: brand.colors.surfaceSecondary, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8, alignItems: "center", minHeight: 40, justifyContent: "center" },
  tastoPiccoloTesto: { color: brand.colors.onSurface, fontWeight: "600", fontSize: 12 },
  tastoPiccoloDistruttivo: { flexGrow: 1, borderColor: brand.colors.error, borderWidth: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center", minHeight: 40, justifyContent: "center" },
  tastoPiccoloDistruttivoTesto: { color: brand.colors.error, fontWeight: "600", fontSize: 12 },

  rigaToggle: { flexDirection: "row", alignItems: "center", gap: 4 },
  nota: { color: brand.colors.muted, fontSize: 11 },
  etichettaLog: { color: brand.colors.muted, fontSize: 10, textTransform: "uppercase", marginTop: 4 },
  rigaLog: { color: brand.colors.onSurfaceSecondary, fontSize: 11, paddingVertical: 2 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },

  bannerErrore: { backgroundColor: "#4A1620", borderRadius: 8, padding: 8 },
  bannerErroreTesto: { color: "#fff", fontSize: 11 },
  bannerCambio: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 8, padding: 8, gap: 6, borderWidth: 1, borderColor: brand.colors.brandSecondary },
  bannerCambioTesto: { color: brand.colors.onSurface, fontSize: 12 },
  rigaBannerAzioni: { flexDirection: "row", justifyContent: "flex-end", gap: 12, alignItems: "center" },
  bottoneChiudiCambio: { backgroundColor: brand.colors.success, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  bottoneChiudiCambioTesto: { color: "#000", fontWeight: "700", fontSize: 11 },

  bottoneSecondario: { borderColor: brand.colors.brand, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "600" },

  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 20 },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 16, gap: 10, maxHeight: "90%" },
  intestazionePopup: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  titoloSezionePopup: { color: brand.colors.brandSecondary, fontSize: 11, fontWeight: "800", textTransform: "uppercase", marginTop: 6 },
  chiudiPopup: { color: brand.colors.muted, fontSize: 18 },
  segnalazione: { color: brand.colors.onSurface, fontSize: 13, lineHeight: 19 },
  segnalazioneAttenzione: { color: brand.colors.warning, fontWeight: "600" },
  rigaRotazione: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaRotazioneNome: { color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  rigaRotazioneSaldo: { color: brand.colors.success, fontSize: 12, fontWeight: "700" },
  saldoNegativo: { color: brand.colors.error },
  parere: { color: brand.colors.onSurface, fontSize: 13, lineHeight: 20 },
  bottoneAI: { borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  bottoneAITesto: { color: brand.colors.brandSecondary, fontWeight: "700" },
  rigaScelta: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaSceltaTesto: { color: brand.colors.onSurface, fontSize: 14 },
});
