import { useCallback, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Switch, Modal, ActivityIndicator, FlatList, useWindowDimensions } from "react-native";
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
  const { team, puoScrivere, puoScoutare } = useAuth();
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
  const [popupEventi, setPopupEventi] = useState(false);
  const [popupAltro, setPopupAltro] = useState(false);

  // Adatta la disposizione alla forma dello schermo: in orizzontale il
  // campo sta a sinistra alto quanto lo schermo, in verticale sta in
  // alto largo quanto lo schermo e i comandi vanno sotto. In entrambi i
  // casi il campo resta quadrato e occupa il lato corto per intero,
  // così è sempre il più grande possibile senza uscire dallo schermo.
  const { width: larghezzaSchermo, height: altezzaSchermo } = useWindowDimensions();
  const orizzontale = larghezzaSchermo >= altezzaSchermo;
  // Il lato del quadrato è il minore tra lo spazio disponibile in
  // altezza e quello in larghezza, così il campo entra sempre per
  // intero senza tagliare i comandi.
  const latoCampo = orizzontale
    ? Math.min(altezzaSchermo - 32, larghezzaSchermo * 0.52)
    : Math.min(larghezzaSchermo - 16, altezzaSchermo * 0.40);
  // I comandi si ridimensionano con lo spazio disponibile invece di
  // avere misure fisse che su schermi piccoli escono e su grandi
  // sprecano spazio.
  const spazioComandi = orizzontale ? larghezzaSchermo - latoCampo - 24 : larghezzaSchermo - 16;
  const scala = Math.max(0.85, Math.min(1.35, spazioComandi / 340));
  const d = (valore: number) => Math.round(valore * scala);

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
      const nostro = skill === "Punto_nostro" || esito === "punto";
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
    <View style={[styles.contenitore, { flexDirection: orizzontale ? "row" : "column" }]}>
      <View style={[styles.colonnaCampo, orizzontale ? { width: latoCampo } : { width: "100%", alignItems: "center" }]}>
        <View style={{ width: latoCampo, height: latoCampo }}>
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
        <Text style={styles.nota} numberOfLines={1}>
          servizio: {setCorrente.squadra_al_servizio === "noi" ? (alServizio ? etichettaAtleta(alServizio.athlete_id) : "noi") : "loro"}
        </Text>
      </View>

      <View style={[styles.colonnaComandi, orizzontale ? { flex: 1 } : { flex: 1, width: "100%" }]}>
        <View style={styles.tabellone}>
          <View style={{ flex: 1 }}>
            <Text style={styles.avversario} numberOfLines={1}>vs {match.avversario}</Text>
            <Text style={styles.setNumero}>Set {setCorrente.numero_set}</Text>
          </View>
          <Text style={[styles.punteggio, { fontSize: d(26) }]}>{setCorrente.punti_noi}-{setCorrente.punti_avversario}</Text>
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

        {puoScoutare ? (
          <>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
            <Text style={styles.indicazionePasso}>
              {passo === "giocatrice" && "1. Tocca la giocatrice sul campo"}
              {passo === "fondamentale" && `2. ${selezionata ? etichettaAtleta(selezionata.id) : ""} — quale fondamentale?`}
              {passo === "esito" && `3. ${skillSel} — com'è andata?`}
            </Text>

            {/* Sempre disponibili, a qualunque passo: un punto può
                arrivare senza che nessuna nostra giocatrice abbia
                fatto un'azione attribuibile, e in quel momento non si
                deve essere costretti a tornare indietro. */}
            <View style={styles.rigaPuntiDiretti}>
              <Pressable style={[styles.bottonePuntoNostro, { paddingVertical: d(14) }]} onPress={() => registra("Punto_nostro", null, null)}>
                <Text style={styles.bottonePuntoNostroTesto}>+1 NOI</Text>
                <Text style={styles.sottoPulsante}>errore loro</Text>
              </Pressable>
              <Pressable style={[styles.bottonePuntoAvversario, { paddingVertical: d(14) }]} onPress={() => registra("Punto_avversario", null, null)}>
                <Text style={styles.bottonePuntoAvversarioTesto}>+1 LORO</Text>
                <Text style={styles.sottoPulsante}>errore nostro</Text>
              </Pressable>
            </View>

            {passo === "fondamentale" && (
              <View style={styles.griglia}>
                {skills.map((s) => (
                  <Pressable key={s.skill} onPress={() => setSkillSel(s.skill)} style={[styles.tastoGriglia, { paddingVertical: d(16) }]}>
                    <Text style={[styles.tastoGrigliaTesto, { fontSize: d(13) }]}>{s.etichetta}</Text>
                  </Pressable>
                ))}
                <Pressable onPress={() => { setAtletaSelId(null); setSkillSel(null); }} style={styles.tastoAnnullaPasso}>
                  <Text style={styles.nota}>← cambia giocatrice</Text>
                </Pressable>
              </View>
            )}

            {passo === "esito" && skillSel && (
              <>
                <Pressable style={[styles.tastoEsito, styles.esitoPunto, { paddingVertical: d(18) }]} onPress={() => registra(skillSel, "punto", atletaSelId)}>
                  <Text style={[styles.tastoEsitoTesto, { fontSize: d(16) }]}>Punto</Text>
                </Pressable>
                <Pressable style={[styles.tastoEsito, styles.esitoNeutro, { paddingVertical: d(18) }]} onPress={() => registra(skillSel, "neutro", atletaSelId)}>
                  <Text style={[styles.tastoEsitoTesto, { fontSize: d(16) }]}>Neutro</Text>
                </Pressable>
                <Pressable style={[styles.tastoEsito, styles.esitoErrore, { paddingVertical: d(18) }]} onPress={() => registra(skillSel, "errore", atletaSelId)}>
                  <Text style={[styles.tastoEsitoTesto, { fontSize: d(16) }]}>Errore</Text>
                </Pressable>
                <Pressable onPress={() => setSkillSel(null)} style={styles.tastoAnnullaPasso}>
                  <Text style={styles.nota}>← cambia fondamentale</Text>
                </Pressable>
              </>
            )}

          </ScrollView>

          {/* Barra fissa: questi comandi devono restare sempre
              raggiungibili, qualunque passo sia attivo e qualunque sia
              l'orientamento. */}
          <View style={styles.barraFissa}>
            <Pressable onPress={apriSituazione} style={styles.tastoPiccolo}>
              <Text style={styles.tastoPiccoloTesto}>📊</Text>
            </Pressable>
            <Pressable onPress={() => setPopupEventi(true)} style={styles.tastoPiccolo}>
              <Text style={styles.tastoPiccoloTesto}>🕑 {eventi.length}</Text>
            </Pressable>
            {atletaSelId && !cambioInSospeso && (
              <Pressable onPress={() => setPopupCambio(true)} style={styles.tastoPiccolo}>
                <Text style={styles.tastoPiccoloTesto}>⇄</Text>
              </Pressable>
            )}
            <Pressable onPress={() => setPopupAltro(true)} style={styles.tastoPiccolo}>
              <Text style={styles.tastoPiccoloTesto}>⋯</Text>
            </Pressable>
          </View>
          </>
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

      <Modal visible={popupEventi} animationType="slide" transparent onRequestClose={() => setPopupEventi(false)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <View style={styles.intestazionePopup}>
              <Text style={styles.titoloPopup}>Ultimi eventi</Text>
              <Pressable onPress={() => setPopupEventi(false)} hitSlop={12}><Text style={styles.chiudiPopup}>✕</Text></Pressable>
            </View>
            <FlatList
              data={eventi}
              keyExtractor={(e) => e.id}
              ListEmptyComponent={<Text style={styles.nota}>Nessun evento registrato.</Text>}
              renderItem={({ item }) => (
                <Text style={styles.rigaLog}>
                  {new Date(item.creato_il).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })} · {item.skill === "Punto_avversario" ? "Punto avversario" : `${item.skill} ${item.esito}`}
                  {item.athlete_id ? ` · ${etichettaAtleta(item.athlete_id)}` : ""}
                </Text>
              )}
            />
            <Pressable style={styles.bottoneSecondario} onPress={() => { setPopupEventi(false); onAnnulla(); }} disabled={eventi.length === 0}>
              <Text style={styles.bottoneSecondarioTesto}>↺ Annulla l'ultimo</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={popupAltro} animationType="fade" transparent onRequestClose={() => setPopupAltro(false)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <View style={styles.intestazionePopup}>
              <Text style={styles.titoloPopup}>Altre azioni</Text>
              <Pressable onPress={() => setPopupAltro(false)} hitSlop={12}><Text style={styles.chiudiPopup}>✕</Text></Pressable>
            </View>
            <View style={styles.rigaToggle}>
              <Text style={styles.nota}>Modalità essenziale</Text>
              <Switch value={modalitaEssenziale} onValueChange={setModalitaEssenziale} trackColor={{ true: brand.colors.brand }} />
            </View>
            {puoScrivere ? (
              <>
                <Pressable
                  style={styles.bottoneSecondario}
                  onPress={async () => {
                    setPopupAltro(false);
                    try { await nuovoSet(match.id); router.replace(`/partita/${match.id}/prepara`); }
                    catch (e) { avvisa("Errore", (e as Error).message); }
                  }}
                >
                  <Text style={styles.bottoneSecondarioTesto}>Nuovo set</Text>
                </Pressable>
                <Pressable style={styles.bottoneDistruttivo} onPress={() => { setPopupAltro(false); onChiudiPartita(); }}>
                  <Text style={styles.bottoneDistruttivoTesto}>Chiudi partita</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.nota}>Con il profilo Scout puoi registrare le azioni, annullarle e fare i cambi. Avvio di un nuovo set e chiusura della partita spettano all'allenatore.</Text>
            )}
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
  contenitore: { flex: 1, backgroundColor: brand.colors.surface, padding: 8, gap: 8 },
  colonnaCampo: { gap: 6 },
  rigaSottoCampo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  colonnaComandi: { gap: 8 },

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
  rigaPuntiDiretti: { flexDirection: "row", gap: 6 },
  bottonePuntoNostro: { flex: 1, backgroundColor: brand.colors.success, borderRadius: 10, alignItems: "center" },
  bottonePuntoNostroTesto: { color: "#000", fontWeight: "800", fontSize: 15 },
  bottonePuntoAvversario: { flex: 1, backgroundColor: "#4A1620", borderRadius: 10, alignItems: "center" },
  bottonePuntoAvversarioTesto: { color: "#fff", fontWeight: "800", fontSize: 15 },
  sottoPulsante: { color: "rgba(255,255,255,0.7)", fontSize: 10 },

  rigaComandiSecondari: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  barraFissa: { flexDirection: "row", gap: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: brand.colors.border },
  bottoneDistruttivo: { borderColor: brand.colors.error, borderWidth: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  bottoneDistruttivoTesto: { color: brand.colors.error, fontWeight: "700" },
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
