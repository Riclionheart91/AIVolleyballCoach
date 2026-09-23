import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import {
  COLORI_TIPO_BLOCCO,
  ETICHETTE_TIPO_BLOCCO,
  aggiornaBlocco,
  aggiungiObiettivoCatalogo,
  creaBlocco,
  creaPianoAnnuale,
  elencaBlocchi,
  elencaObiettiviCatalogo,
  eliminaBlocco,
  generaAggiornamentoPianoAI,
  generaBlocchiAI,
  generaBlocchiGuidatoAI,
  leggiPianoAnnuale,
  leggiRiepilogoPerformance,
  riepilogoBlocchi,
  type InputBlocco,
  type RigaPerformance,
} from "@/src/services/pianoAnnuale";
import { elencaAtlete } from "@/src/services/athletes";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { brand, obiettiviFisici, obiettiviTattici, obiettiviTecnici } from "@/src/config";
import type { BloccoPiano, PianoAnnuale, RiepilogoBlocco, TipoBlocco } from "@/src/types/database";

const TIPI: TipoBlocco[] = ["preparazione_generale", "preparazione_specifica", "pre_competitiva", "competitiva", "scarico", "transizione"];

function oggiIso() { return new Date().toISOString().slice(0, 10); }
function fraMesi(n: number) { const d = new Date(); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); }

/**
 * Pianificazione annuale a BLOCCHI, sul modello delle app di settore
 * (TeamBuildr, CoachRx): la stagione è una sequenza di periodi datati
 * con un tipo e obiettivi propri, non un testo unico. Ogni blocco
 * mostra quante partite e quanti allenamenti cadono nel suo periodo,
 * così i conflitti di carico (blocco "competitiva" senza partite,
 * oppure "preparazione" pieno di gare) si vedono a colpo d'occhio.
 */
export default function PianificazioneAnnuale() {
  const { team, stagioneAttiva } = useAuth();
  const [piano, setPiano] = useState<PianoAnnuale | null>(null);
  const [blocchi, setBlocchi] = useState<BloccoPiano[]>([]);
  const [riepilogo, setRiepilogo] = useState<RiepilogoBlocco[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [percentuale, setPercentuale] = useState(0);
  const [bloccoInModifica, setBloccoInModifica] = useState<BloccoPiano | "nuovo" | null>(null);
  const [performanceUiAperta, setPerformanceUiAperta] = useState(false);
  const [generandoAggiornamento, setGenerandoAggiornamento] = useState(false);
  const [performance, setPerformance] = useState<RigaPerformance[]>([]);
  const [proposte, setProposte] = useState<(InputBlocco & { chiave: string })[] | null>(null);
  const [propostaInModifica, setPropostaInModifica] = useState<string | null>(null);
  const [bozza, setBozza] = useState<InputBlocco>(bozzaVuota());
  const [guidaAperta, setGuidaAperta] = useState(false);
  const [livello, setLivello] = useState("amatoriale");
  const [seduteSettimana, setSeduteSettimana] = useState("2");
  const [obiettivoStagione, setObiettivoStagione] = useState("crescita tecnica del gruppo");
  const [istruzioniExtra, setIstruzioniExtra] = useState("");
  // Obiettivi aggiunti tramite "Altro" da qualunque squadra: si sommano
  // agli elenchi fissi di config.ts, senza sostituirli.
  const [extraTecnici, setExtraTecnici] = useState<string[]>([]);
  const [extraFisici, setExtraFisici] = useState<string[]>([]);
  const [extraTattici, setExtraTattici] = useState<string[]>([]);
  const vociTecnici = [...obiettiviTecnici, ...extraTecnici];
  const vociFisici = [...obiettiviFisici, ...extraFisici];
  const vociTattici = [...obiettiviTattici, ...extraTattici];

  function bozzaVuota(): InputBlocco {
    return {
      nome: "", tipo: "preparazione_generale", data_inizio: oggiIso(), data_fine: fraMesi(1),
      obiettivi_tecnici: "", obiettivi_fisici: "", obiettivi_tattici: "", note: "",
    };
  }

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      let p = await leggiPianoAnnuale(team.id, stagioneAttiva?.id ?? null);
      // Il piano è il contenitore dei blocchi: se non esiste ancora lo
      // si crea vuoto, così l'allenatore può partire subito ad
      // aggiungere blocchi senza un passaggio preliminare a vuoto.
      if (!p) p = await creaPianoAnnuale(team.id, stagioneAttiva?.id ?? null, `Piano ${stagioneAttiva?.nome ?? ""}`.trim(), "", false);
      setPiano(p);
      setBlocchi(await elencaBlocchi(p.id));
      setRiepilogo(await riepilogoBlocchi(p.id).catch(() => []));
      const catalogo = await elencaObiettiviCatalogo().catch(() => []);
      setExtraTecnici(catalogo.filter((o) => o.categoria === "tecnico").map((o) => o.testo));
      setExtraFisici(catalogo.filter((o) => o.categoria === "fisico").map((o) => o.testo));
      setExtraTattici(catalogo.filter((o) => o.categoria === "tattico").map((o) => o.testo));
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCaricamento(false);
    }
  }, [team, stagioneAttiva]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  function apriNuovo() {
    // Il nuovo blocco parte dal giorno dopo la fine dell'ultimo:
    // costruire la stagione in sequenza è il caso normale.
    const ultimo = blocchi[blocchi.length - 1];
    const inizio = ultimo ? new Date(new Date(ultimo.data_fine).getTime() + 86400000).toISOString().slice(0, 10) : oggiIso();
    const fine = new Date(new Date(inizio).getTime() + 28 * 86400000).toISOString().slice(0, 10);
    setBozza({ ...bozzaVuota(), data_inizio: inizio, data_fine: fine });
    setBloccoInModifica("nuovo");
  }

  function apriModifica(b: BloccoPiano) {
    setBozza({
      nome: b.nome, tipo: b.tipo, data_inizio: b.data_inizio, data_fine: b.data_fine,
      obiettivi_tecnici: b.obiettivi_tecnici, obiettivi_fisici: b.obiettivi_fisici,
      obiettivi_tattici: b.obiettivi_tattici, note: b.note,
    });
    setBloccoInModifica(b);
  }

  /** Apre una proposta (non ancora salvata) per correggerla, prima di accettare l'aggiornamento. */
  function apriModificaProposta(p: InputBlocco & { chiave: string }) {
    setBozza({ nome: p.nome, tipo: p.tipo, data_inizio: p.data_inizio, data_fine: p.data_fine, obiettivi_tecnici: p.obiettivi_tecnici, obiettivi_fisici: p.obiettivi_fisici, obiettivi_tattici: p.obiettivi_tattici, note: p.note });
    setPropostaInModifica(p.chiave);
  }

  async function apriAggiornamentoPerformance() {
    if (!team) return;
    setPerformanceUiAperta(!performanceUiAperta);
    if (!performanceUiAperta) {
      setPerformance(await leggiRiepilogoPerformance(team.id).catch(() => []));
    }
  }

  /**
   * Rigenera SOLO da oggi in poi: i blocchi già chiusi (data_fine
   * passata) non vengono nemmeno inclusi nel calcolo della data di
   * fine pianificazione, e restano intoccati fino all'accettazione
   * esplicita — che a sua volta cancella e ricrea solo i blocchi non
   * ancora conclusi, mai quelli passati.
   */
  async function eseguiAggiornamentoPerformance() {
    if (!team) return;
    setGenerandoAggiornamento(true);
    try {
      const ultimoBlocco = blocchi[blocchi.length - 1];
      const fineStagione = ultimoBlocco && ultimoBlocco.data_fine > oggi ? ultimoBlocco.data_fine : fraMesi(6);
      const r = await generaAggiornamentoPianoAI(
        team.id, oggi, fineStagione,
        { livello, seduteSettimana, obiettivoStagione }, performance, istruzioniExtra,
        { tecnici: vociTecnici, fisici: vociFisici, tattici: vociTattici },
      );
      if (r.errore || !r.blocchi) { avvisa("Aggiornamento non riuscito", r.messaggio ?? "Errore"); return; }
      setProposte(r.blocchi.map((b, i) => ({ ...b, chiave: `proposta-${i}` })));
      setPerformanceUiAperta(false);
    } finally {
      setGenerandoAggiornamento(false);
    }
  }

  function rimuoviProposta(chiave: string) {
    setProposte((prev) => (prev ? prev.filter((p) => p.chiave !== chiave) : prev));
  }

  /** Sostituisce SOLO i blocchi non ancora conclusi (data_fine >= oggi): quelli passati non vengono toccati, né letti, né inviati all'AI. */
  async function accettaAggiornamento() {
    if (!piano || !proposte || proposte.length === 0) return;
    confermaAzione(
      "Sostituire il piano da oggi in poi?",
      `${proposte.length} blocchi sostituiranno quelli non ancora conclusi. I blocchi già passati restano invariati.`,
      "Sostituisci",
      async () => {
        try {
          const daRimuovere = blocchi.filter((b) => b.data_fine >= oggi);
          for (const b of daRimuovere) await eliminaBlocco(b.id);
          for (const p of proposte) {
            const { chiave, ...input } = p;
            await creaBlocco(piano.id, input);
          }
          setProposte(null);
          carica();
        } catch (e) { avvisa("Errore", (e as Error).message); }
      },
    );
  }

  async function salvaBlocco() {
    // Se si sta correggendo una proposta non ancora accettata, si
    // aggiorna solo l'elenco in memoria: nessuna scrittura sul
    // database finché non si preme "Accetta e sostituisci".
    if (propostaInModifica) {
      if (!bozza.nome.trim()) return;
      setProposte((prev) => prev ? prev.map((p) => (p.chiave === propostaInModifica ? { ...bozza, chiave: propostaInModifica } : p)) : prev);
      setPropostaInModifica(null);
      return;
    }
    if (!piano || !bozza.nome.trim()) return;
    try {
      if (bloccoInModifica === "nuovo") await creaBlocco(piano.id, bozza);
      else if (bloccoInModifica) await aggiornaBlocco(bloccoInModifica.id, bozza);
      setBloccoInModifica(null);
      carica();
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  function chiediEliminazione(b: BloccoPiano) {
    confermaAzione("Eliminare il blocco?", `"${b.nome}" verrà rimosso dalla pianificazione.`, "Elimina", async () => {
      try { await eliminaBlocco(b.id); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
    }, true);
  }

  async function onGeneraAI() {
    if (!team || !piano) return;
    if (blocchi.length > 0) {
      confermaAzione("Ci sono già dei blocchi", "La proposta AI verrà AGGIUNTA a quelli esistenti, non li sostituisce. Potresti ritrovarti periodi sovrapposti da sistemare a mano.", "Genera comunque", eseguiGenerazione);
    } else {
      eseguiGenerazione();
    }

    async function eseguiGenerazione() {
      setGenerando(true);
      setPercentuale(5);
      const intervallo = setInterval(() => setPercentuale((p) => (p < 90 ? p + Math.max(1, Math.round((90 - p) * 0.15)) : p)), 400);
      try {
        const atlete = await elencaAtlete(team!.id);
        const contesto = `Squadra di ${atlete.length} persone. Stagione: ${stagioneAttiva?.nome ?? "non specificata"}.`;
        const inizio = stagioneAttiva?.data_apertura?.slice(0, 10) || oggiIso();
        const r = await generaBlocchiAI(team!.id, inizio, fraMesi(9), contesto);
        if (r.errore || !r.blocchi) { avvisa("Generazione non riuscita", r.messaggio ?? "Errore sconosciuto"); return; }
        setPercentuale(100);
        for (const b of r.blocchi) await creaBlocco(piano!.id, b);
        carica();
        avvisa("Proposta creata", `${r.blocchi.length} blocchi aggiunti. Rivedili e modificali: restano tutti editabili.`);
      } catch (e) {
        avvisa("Errore", (e as Error).message);
      } finally {
        clearInterval(intervallo);
        setGenerando(false);
        setTimeout(() => setPercentuale(0), 600);
      }
    }
  }

  async function onGeneraGuidato() {
    if (!team || !piano) return;
    setGuidaAperta(false);
    setGenerando(true);
    setPercentuale(5);
    const intervallo = setInterval(() => setPercentuale((p) => (p < 90 ? p + Math.max(1, Math.round((90 - p) * 0.15)) : p)), 400);
    try {
      const atlete = await elencaAtlete(team.id);
      const inizio = stagioneAttiva?.data_apertura?.slice(0, 10) || oggiIso();
      const r = await generaBlocchiGuidatoAI(team.id, inizio, fraMesi(9), { livello, seduteSettimana, obiettivoStagione }, atlete.length, istruzioniExtra, { tecnici: vociTecnici, fisici: vociFisici, tattici: vociTattici });
      if (r.errore || !r.blocchi) { avvisa("Generazione non riuscita", r.messaggio ?? "Errore sconosciuto"); return; }
      setPercentuale(100);
      for (const b of r.blocchi) await creaBlocco(piano.id, b);
      carica();
      avvisa("Piano creato", `${r.blocchi.length} blocchi generati. Rivedili: sono tutti modificabili.`);
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      clearInterval(intervallo);
      setGenerando(false);
      setTimeout(() => setPercentuale(0), 600);
    }
  }

  /** Gli obiettivi sono salvati come elenco separato da virgole: qui si passa da/verso l'array per i menù a scelta multipla. */
  function commutaObiettivo(campo: "obiettivi_tecnici" | "obiettivi_fisici" | "obiettivi_tattici", voce: string) {
    const attuali = bozza[campo] ? bozza[campo].split(",").map((v) => v.trim()).filter(Boolean) : [];
    const nuovi = attuali.includes(voce) ? attuali.filter((v) => v !== voce) : [...attuali, voce];
    setBozza({ ...bozza, [campo]: nuovi.join(", ") });
  }

  const CATEGORIA_PER_CAMPO = {
    obiettivi_tecnici: "tecnico", obiettivi_fisici: "fisico", obiettivi_tattici: "tattico",
  } as const;
  const SETTER_EXTRA = {
    obiettivi_tecnici: setExtraTecnici, obiettivi_fisici: setExtraFisici, obiettivi_tattici: setExtraTattici,
  } as const;

  /** Un nuovo obiettivo da "Altro": selezionato subito per questo blocco, e proposto al catalogo condiviso perché resti selezionabile da chiunque, in futuro. */
  async function onNuovoObiettivo(campo: "obiettivi_tecnici" | "obiettivi_fisici" | "obiettivi_tattici", testo: string) {
    SETTER_EXTRA[campo]((prec) => (prec.includes(testo) ? prec : [...prec, testo]));
    commutaObiettivo(campo, testo);
    if (!team) return;
    try {
      await aggiungiObiettivoCatalogo(team.id, CATEGORIA_PER_CAMPO[campo], testo);
    } catch (e) {
      avvisa("Non salvato nel catalogo condiviso", `Resta selezionato per questo piano, ma non sarà visibile ad altre squadre: ${(e as Error).message}`);
    }
  }

  function eSelezionato(campo: "obiettivi_tecnici" | "obiettivi_fisici" | "obiettivi_tattici", voce: string) {
    return (bozza[campo] ?? "").split(",").map((v) => v.trim()).includes(voce);
  }

  function durataGiorni(b: BloccoPiano | InputBlocco): number {
    return Math.max(1, Math.round((new Date(b.data_fine).getTime() - new Date(b.data_inizio).getTime()) / 86400000) + 1);
  }

  const oggi = oggiIso();

  if (caricamento) return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← Profilo</Text></Pressable>
        <Text style={styles.titolo}>Pianificazione annuale</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <View style={styles.rigaComandi}>
          <Pressable style={styles.bottoneAI} onPress={() => setGuidaAperta(!guidaAperta)} disabled={generando}>
            {generando ? <Text style={styles.bottoneAITesto}>{percentuale}%</Text> : <Text style={styles.bottoneAITesto}>✨ Guidami nel piano</Text>}
          </Pressable>
          <Pressable style={styles.bottoneNuovo} onPress={apriNuovo}>
            <Text style={styles.bottoneNuovoTesto}>+ Blocco</Text>
          </Pressable>
        </View>
        {blocchi.length > 0 && (
          <Pressable style={styles.bottonePerformance} onPress={apriAggiornamentoPerformance} disabled={generandoAggiornamento}>
            <Text style={styles.bottonePerformanceTesto}>📊 Aggiorna con le performance (da oggi in poi)</Text>
          </Pressable>
        )}
        {generando && <View style={styles.barraSfondo}><View style={[styles.barraRiempimento, { width: `${percentuale}%` }]} /></View>}

        {performanceUiAperta && (
          <View style={styles.form}>
            <Text style={styles.titoloForm}>Aggiorna il piano sulle performance reali</Text>
            <Text style={styles.nota}>
              Le ipotesi di base (livello, sedute, obiettivo stagione) restano quelle sotto — cambiale se serve. Verrà ricostruito solo da oggi in poi: quanto già passato non viene toccato.
            </Text>

            <Text style={styles.etichettaGuida}>Rendimento recente</Text>
            {performance.length === 0 ? (
              <Text style={styles.nota}>Nessun dato ancora da valutazioni o partite.</Text>
            ) : performance.map((r) => (
              <Text key={r.fondamentale} style={styles.rigaPerformance}>
                {r.fondamentale}: {r.media_valutazioni != null ? `voto ${r.media_valutazioni}/10` : "nessun voto"}
                {r.efficienza_partite != null ? ` · efficienza ${r.efficienza_partite >= 0 ? "+" : ""}${r.efficienza_partite}` : ""}
              </Text>
            ))}

            <Text style={styles.etichettaGuida}>Livello della squadra</Text>
            <View style={styles.selettoreTipi}>
              {["giovanile", "amatoriale", "agonistico"].map((v) => (
                <Pressable key={v} onPress={() => setLivello(v)} style={[styles.chipTipo, livello === v && styles.chipTipoAttivo]}>
                  <Text style={[styles.chipTipoTesto, livello === v && styles.chipTipoTestoAttivo]}>{v}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.etichettaGuida}>Sedute a settimana</Text>
            <View style={styles.selettoreTipi}>
              {["1", "2", "3", "4+"].map((v) => (
                <Pressable key={v} onPress={() => setSeduteSettimana(v)} style={[styles.chipTipo, seduteSettimana === v && styles.chipTipoAttivo]}>
                  <Text style={[styles.chipTipoTesto, seduteSettimana === v && styles.chipTipoTestoAttivo]}>{v}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput style={styles.input} placeholder="Obiettivo principale della stagione" placeholderTextColor={brand.colors.muted} value={obiettivoStagione} onChangeText={setObiettivoStagione} />
            <TextInput style={[styles.input, { minHeight: 60 }]} multiline placeholder="Altro da tenere presente (facoltativo)" placeholderTextColor={brand.colors.muted} value={istruzioniExtra} onChangeText={setIstruzioniExtra} />

            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable style={styles.bottoneAnnulla} onPress={() => setPerformanceUiAperta(false)}><Text style={styles.bottoneAnnullaTesto}>Annulla</Text></Pressable>
              <Pressable style={styles.bottoneSalva} onPress={eseguiAggiornamentoPerformance} disabled={generandoAggiornamento}>
                {generandoAggiornamento ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneSalvaTesto}>Genera proposta</Text>}
              </Pressable>
            </View>
          </View>
        )}

        {proposte && (
          <View style={styles.formRevisione}>
            <Text style={styles.titoloForm}>Proposta da revisionare</Text>
            <Text style={styles.nota}>Sostituirà solo i blocchi non ancora conclusi. Modifica o rimuovi ciò che non ti convince, poi accetta.</Text>
            {proposte.map((p) => (
              <View key={p.chiave} style={styles.propostaCard}>
                <View style={[styles.barraTipo, { backgroundColor: COLORI_TIPO_BLOCCO[p.tipo] }]} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.nomeBlocco}>{p.nome}</Text>
                  <Text style={styles.tipoBlocco}>{ETICHETTE_TIPO_BLOCCO[p.tipo]}</Text>
                  <Text style={styles.periodoBlocco}>{new Date(p.data_inizio).toLocaleDateString("it-IT")} → {new Date(p.data_fine).toLocaleDateString("it-IT")}</Text>
                  {!!p.obiettivi_tecnici && <Text style={styles.obiettivo}><Text style={styles.etichettaObiettivo}>Tecnici: </Text>{p.obiettivi_tecnici}</Text>}
                  {!!p.obiettivi_fisici && <Text style={styles.obiettivo}><Text style={styles.etichettaObiettivo}>Fisici: </Text>{p.obiettivi_fisici}</Text>}
                  {!!p.obiettivi_tattici && <Text style={styles.obiettivo}><Text style={styles.etichettaObiettivo}>Tattici: </Text>{p.obiettivi_tattici}</Text>}
                  <View style={styles.rigaAzioni}>
                    <Pressable onPress={() => apriModificaProposta(p)}><Text style={styles.azione}>Modifica</Text></Pressable>
                    <Pressable onPress={() => rimuoviProposta(p.chiave)}><Text style={styles.azioneDistruttiva}>Rimuovi</Text></Pressable>
                  </View>
                </View>
              </View>
            ))}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable style={styles.bottoneAnnulla} onPress={() => setProposte(null)}><Text style={styles.bottoneAnnullaTesto}>Annulla proposta</Text></Pressable>
              <Pressable style={styles.bottoneSalva} onPress={accettaAggiornamento} disabled={proposte.length === 0}><Text style={styles.bottoneSalvaTesto}>✓ Accetta e sostituisci</Text></Pressable>
            </View>
          </View>
        )}

        {(bloccoInModifica || propostaInModifica) && (
          <View style={styles.form}>
            <Text style={styles.titoloForm}>{propostaInModifica ? "Correggi la proposta" : bloccoInModifica === "nuovo" ? "Nuovo blocco" : "Modifica blocco"}</Text>
            <TextInput style={styles.input} placeholder="Nome (es. Preparazione pre-campionato)" placeholderTextColor={brand.colors.muted} value={bozza.nome} onChangeText={(t) => setBozza({ ...bozza, nome: t })} />
            <View style={styles.selettoreTipi}>
              {TIPI.map((t) => (
                <Pressable key={t} onPress={() => setBozza({ ...bozza, tipo: t })} style={[styles.chipTipo, bozza.tipo === t && { backgroundColor: COLORI_TIPO_BLOCCO[t] }]}>
                  <Text style={[styles.chipTipoTesto, bozza.tipo === t && { color: "#fff", fontWeight: "700" }]}>{ETICHETTE_TIPO_BLOCCO[t]}</Text>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Inizio AAAA-MM-GG" placeholderTextColor={brand.colors.muted} value={bozza.data_inizio} onChangeText={(t) => setBozza({ ...bozza, data_inizio: t })} />
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Fine AAAA-MM-GG" placeholderTextColor={brand.colors.muted} value={bozza.data_fine} onChangeText={(t) => setBozza({ ...bozza, data_fine: t })} />
            </View>
            <SelettoreObiettivi titolo="Obiettivi tecnici" voci={vociTecnici} campo="obiettivi_tecnici" selezionato={eSelezionato} commuta={commutaObiettivo} onNuovo={onNuovoObiettivo} />
            <SelettoreObiettivi titolo="Obiettivi fisici" voci={vociFisici} campo="obiettivi_fisici" selezionato={eSelezionato} commuta={commutaObiettivo} onNuovo={onNuovoObiettivo} />
            <SelettoreObiettivi titolo="Obiettivi tattici" voci={vociTattici} campo="obiettivi_tattici" selezionato={eSelezionato} commuta={commutaObiettivo} onNuovo={onNuovoObiettivo} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable style={styles.bottoneAnnulla} onPress={() => { setBloccoInModifica(null); setPropostaInModifica(null); }}><Text style={styles.bottoneAnnullaTesto}>Annulla</Text></Pressable>
              <Pressable style={styles.bottoneSalva} onPress={salvaBlocco} disabled={!bozza.nome.trim()}><Text style={styles.bottoneSalvaTesto}>{propostaInModifica ? "Aggiorna proposta" : "Salva"}</Text></Pressable>
            </View>
          </View>
        )}


        {guidaAperta && (
          <View style={styles.form}>
            <Text style={styles.titoloForm}>Tre domande e costruisco il piano</Text>
            <Text style={styles.nota}>Gli obiettivi verranno scelti dagli elenchi standard, così restano confrontabili tra stagioni. Tutto resta poi modificabile.</Text>

            <Text style={styles.etichettaGuida}>Livello della squadra</Text>
            <View style={styles.selettoreTipi}>
              {["giovanile", "amatoriale", "agonistico"].map((v) => (
                <Pressable key={v} onPress={() => setLivello(v)} style={[styles.chipTipo, livello === v && styles.chipTipoAttivo]}>
                  <Text style={[styles.chipTipoTesto, livello === v && styles.chipTipoTestoAttivo]}>{v}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.etichettaGuida}>Sedute a settimana</Text>
            <View style={styles.selettoreTipi}>
              {["1", "2", "3", "4+"].map((v) => (
                <Pressable key={v} onPress={() => setSeduteSettimana(v)} style={[styles.chipTipo, seduteSettimana === v && styles.chipTipoAttivo]}>
                  <Text style={[styles.chipTipoTesto, seduteSettimana === v && styles.chipTipoTestoAttivo]}>{v}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.etichettaGuida}>Obiettivo principale della stagione</Text>
            <View style={styles.selettoreTipi}>
              {["crescita tecnica del gruppo", "risultato in campionato", "inserimento giovani", "tenuta fisica e continuità"].map((v) => (
                <Pressable key={v} onPress={() => setObiettivoStagione(v)} style={[styles.chipTipo, obiettivoStagione === v && styles.chipTipoAttivo]}>
                  <Text style={[styles.chipTipoTesto, obiettivoStagione === v && styles.chipTipoTestoAttivo]}>{v}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.etichettaGuida}>Indicazioni particolari (facoltativo)</Text>
            <TextInput
              style={[styles.input, styles.inputAlto]}
              multiline
              placeholder="Es. due atlete rientrano da infortunio al ginocchio; a dicembre la palestra è indisponibile per due settimane; vogliamo lavorare molto sulla ricezione"
              placeholderTextColor={brand.colors.muted}
              value={istruzioniExtra}
              onChangeText={setIstruzioniExtra}
            />

            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable style={styles.bottoneAnnulla} onPress={() => setGuidaAperta(false)}><Text style={styles.bottoneAnnullaTesto}>Annulla</Text></Pressable>
              <Pressable style={styles.bottoneSalva} onPress={onGeneraGuidato}><Text style={styles.bottoneSalvaTesto}>Costruisci il piano</Text></Pressable>
            </View>
          </View>
        )}

        {blocchi.length === 0 ? (
          <Text style={styles.nota}>Nessun blocco ancora. Costruisci la stagione come sequenza di periodi (preparazione, competitiva, scarico…), oppure parti da una proposta AI e correggila.</Text>
        ) : (
          blocchi.map((b) => {
            const r = riepilogo.find((x) => x.blocco_id === b.id);
            const inCorso = oggi >= b.data_inizio && oggi <= b.data_fine;
            return (
              <View key={b.id} style={[styles.blocco, inCorso && styles.bloccoInCorso]}>
                <View style={[styles.barraTipo, { backgroundColor: COLORI_TIPO_BLOCCO[b.tipo] }]} />
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={styles.rigaTitoloBlocco}>
                    <Text style={styles.nomeBlocco}>{b.nome}</Text>
                    {inCorso && <Text style={styles.badgeInCorso}>IN CORSO</Text>}
                  </View>
                  <Text style={styles.tipoBlocco}>{ETICHETTE_TIPO_BLOCCO[b.tipo]}</Text>
                  <Text style={styles.periodoBlocco}>
                    {new Date(b.data_inizio).toLocaleDateString("it-IT")} → {new Date(b.data_fine).toLocaleDateString("it-IT")} · {durataGiorni(b)} giorni
                  </Text>
                  {r && (
                    <Text style={styles.carico}>
                      {r.allenamenti_nel_periodo} allenamenti · {r.partite_nel_periodo} partite
                      {b.tipo === "competitiva" && r.partite_nel_periodo === 0 ? "  ⚠ periodo competitivo senza gare in calendario" : ""}
                      {(b.tipo === "preparazione_generale" || b.tipo === "scarico") && r.partite_nel_periodo > 2 ? "  ⚠ molte gare in un periodo a carico ridotto" : ""}
                    </Text>
                  )}
                  {!!b.obiettivi_tecnici && <Text style={styles.obiettivo}><Text style={styles.etichettaObiettivo}>Tecnici: </Text>{b.obiettivi_tecnici}</Text>}
                  {!!b.obiettivi_fisici && <Text style={styles.obiettivo}><Text style={styles.etichettaObiettivo}>Fisici: </Text>{b.obiettivi_fisici}</Text>}
                  {!!b.obiettivi_tattici && <Text style={styles.obiettivo}><Text style={styles.etichettaObiettivo}>Tattici: </Text>{b.obiettivi_tattici}</Text>}
                  <View style={styles.rigaAzioni}>
                    <Pressable onPress={() => apriModifica(b)}><Text style={styles.azione}>Modifica</Text></Pressable>
                    <Pressable onPress={() => chiediEliminazione(b)}><Text style={styles.azioneDistruttiva}>Elimina</Text></Pressable>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

/** Menù a scelta multipla su elenco chiuso: sostituisce i campi a testo libero, più rapidi da sbagliare che da compilare. */
function SelettoreObiettivi({ titolo, voci, campo, selezionato, commuta, onNuovo }: {
  titolo: string;
  voci: readonly string[];
  campo: "obiettivi_tecnici" | "obiettivi_fisici" | "obiettivi_tattici";
  selezionato: (campo: "obiettivi_tecnici" | "obiettivi_fisici" | "obiettivi_tattici", voce: string) => boolean;
  commuta: (campo: "obiettivi_tecnici" | "obiettivi_fisici" | "obiettivi_tattici", voce: string) => void;
  /** Testo di "Altro" confermato: lo si seleziona subito e lo si propone al catalogo condiviso, valido anche per altre squadre e altre stagioni. */
  onNuovo: (campo: "obiettivi_tecnici" | "obiettivi_fisici" | "obiettivi_tattici", testo: string) => void;
}) {
  const [aperto, setAperto] = useState(false);
  const [testoAltro, setTestoAltro] = useState("");
  const scelti = voci.filter((v) => selezionato(campo, v));

  function confermaAltro() {
    const pulito = testoAltro.trim();
    if (!pulito) return;
    onNuovo(campo, pulito);
    setTestoAltro("");
  }

  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={() => setAperto(!aperto)} style={styles.intestazioneSelettore}>
        <Text style={styles.titoloSelettore}>{titolo}{scelti.length > 0 ? ` (${scelti.length})` : ""}</Text>
        <Text style={styles.frecciaSelettore}>{aperto ? "▾" : "▸"}</Text>
      </Pressable>
      {!aperto && scelti.length > 0 && <Text style={styles.riepilogoScelti}>{scelti.join(" · ")}</Text>}
      {aperto && (
        <>
          <View style={styles.selettoreTipi}>
            {voci.map((v) => {
              const attivo = selezionato(campo, v);
              return (
                <Pressable key={v} onPress={() => commuta(campo, v)} style={[styles.chipObiettivo, attivo && styles.chipObiettivoAttivo]}>
                  <Text style={[styles.chipTipoTesto, attivo && styles.chipTipoTestoAttivo]}>{attivo ? "✓ " : ""}{v}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.rigaAltro}>
            <TextInput
              style={styles.inputAltro}
              placeholder="Altro: scrivi un obiettivo non in elenco"
              placeholderTextColor={brand.colors.muted}
              value={testoAltro}
              onChangeText={setTestoAltro}
              onSubmitEditing={confermaAltro}
              returnKeyType="done"
            />
            <Pressable style={styles.bottoneAltro} onPress={confermaAltro} disabled={!testoAltro.trim()}>
              <Text style={styles.bottoneAltroTesto}>+ Aggiungi</Text>
            </Pressable>
          </View>
          <Text style={styles.notaAltro}>Resta selezionabile anche da altre squadre e in altre stagioni.</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  nota: { color: brand.colors.muted, fontSize: 13, lineHeight: 19 },
  rigaComandi: { flexDirection: "row", gap: 8 },
  bottoneAI: { flex: 1, borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  bottoneAITesto: { color: brand.colors.brandSecondary, fontWeight: "700" },
  bottoneNuovo: { backgroundColor: brand.colors.brand, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 18, alignItems: "center" },
  bottoneNuovoTesto: { color: "#000", fontWeight: "700" },
  bottonePerformance: { borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  bottonePerformanceTesto: { color: brand.colors.brandSecondary, fontWeight: "700", fontSize: 13 },
  rigaPerformance: { color: brand.colors.onSurfaceSecondary, fontSize: 12.5 },
  formRevisione: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 10, borderWidth: 1, borderColor: brand.colors.brandSecondary },
  propostaCard: { flexDirection: "row", backgroundColor: brand.colors.surfaceTertiary, borderRadius: 10, overflow: "hidden" },
  barraSfondo: { height: 4, backgroundColor: brand.colors.surfaceTertiary, borderRadius: 2, overflow: "hidden" },
  barraRiempimento: { height: "100%", backgroundColor: brand.colors.brandSecondary },
  blocco: { flexDirection: "row", backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: "transparent" },
  bloccoInCorso: { borderColor: brand.colors.brand },
  barraTipo: { width: 6 },
  rigaTitoloBlocco: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingRight: 12, paddingTop: 12 },
  nomeBlocco: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700", paddingLeft: 12 },
  badgeInCorso: { color: brand.colors.brand, fontSize: 10, fontWeight: "800" },
  tipoBlocco: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "600", paddingLeft: 12 },
  periodoBlocco: { color: brand.colors.muted, fontSize: 12, paddingLeft: 12 },
  carico: { color: brand.colors.onSurfaceSecondary, fontSize: 11, paddingLeft: 12 },
  obiettivo: { color: brand.colors.onSurfaceSecondary, fontSize: 12, paddingLeft: 12, paddingRight: 12 },
  etichettaObiettivo: { color: brand.colors.muted, fontWeight: "700" },
  rigaAzioni: { flexDirection: "row", gap: 16, padding: 12 },
  azione: { color: brand.colors.brand, fontSize: 12, fontWeight: "600" },
  azioneDistruttiva: { color: brand.colors.error, fontSize: 12, fontWeight: "600" },
  form: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 8 },
  titoloForm: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  inputAlto: { minHeight: 60, textAlignVertical: "top" },
  selettoreTipi: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chipTipo: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 14, backgroundColor: brand.colors.surfaceTertiary },
  chipTipoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 11 },
  chipTipoAttivo: { backgroundColor: brand.colors.brand },
  chipTipoTestoAttivo: { color: "#000", fontWeight: "700" },
  chipObiettivo: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 14, backgroundColor: brand.colors.surfaceTertiary },
  chipObiettivoAttivo: { backgroundColor: brand.colors.brandSecondary },
  rigaAltro: { flexDirection: "row", gap: 8, marginTop: 4 },
  inputAltro: { flex: 1, backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13 },
  bottoneAltro: { backgroundColor: brand.colors.brand, paddingHorizontal: 14, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  bottoneAltroTesto: { color: "#000", fontWeight: "700", fontSize: 12 },
  notaAltro: { color: brand.colors.muted, fontSize: 11, marginTop: 2 },
  intestazioneSelettore: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  titoloSelettore: { color: brand.colors.onSurface, fontSize: 13, fontWeight: "600" },
  frecciaSelettore: { color: brand.colors.muted, fontSize: 13 },
  riepilogoScelti: { color: brand.colors.onSurfaceSecondary, fontSize: 11 },
  etichettaGuida: { color: brand.colors.muted, fontSize: 12, marginTop: 4 },
  bottoneAnnulla: { flex: 1, borderWidth: 1, borderColor: brand.colors.muted, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  bottoneAnnullaTesto: { color: brand.colors.muted, fontWeight: "600" },
  bottoneSalva: { flex: 2, backgroundColor: brand.colors.brand, borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  bottoneSalvaTesto: { color: "#000", fontWeight: "700" },
});
