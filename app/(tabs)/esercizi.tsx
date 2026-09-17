import { useCallback, useMemo, useState } from "react";
import { View, Text, SectionList, TextInput, Pressable, StyleSheet, RefreshControl, Modal, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { carenzeAtleta, creaEsercizio, elencaEsercizi, generaEserciziAI, type EsercizioProposto } from "@/src/services/exercises";
import { elencaAtlete } from "@/src/services/athletes";
import { leggiBloccoPerData } from "@/src/services/trainingPlan";
import { ruoliCampo } from "@/src/config";
import type { Athlete } from "@/src/types/database";
import { FabAggiungi } from "@/src/components/Fab";
import { PopupForm } from "@/src/components/PopupForm";
import { avvisa } from "@/src/lib/confermaAzione";
import { brand, fasiAllenamento } from "@/src/config";
import type { Exercise } from "@/src/types/database";

const SENZA_CATEGORIA = "Senza categoria";

export default function Esercizi() {
  const { team, puoScrivere } = useAuth();
  const [esercizi, setEsercizi] = useState<Exercise[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [ricerca, setRicerca] = useState("");
  // Chiuse di default: con decine di esercizi l'elenco tutto aperto è
  // proprio il problema di leggibilità segnalato. Si aprono a richiesta.
  const [categorieChiuse, setCategorieChiuse] = useState<Set<string> | null>(null);
  const [descrizioneAperta, setDescrizioneAperta] = useState<string | null>(null);
  // Il catalogo si legge per FASE (quando serve in seduta) e dentro ciascuna per categoria (che cosa allena).
  const [raggruppaPerFase, setRaggruppaPerFase] = useState(true);

  const [popupAperto, setPopupAperto] = useState(false);
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");

  const [popupAiAperto, setPopupAiAperto] = useState(false);
  const [categoriaAi, setCategoriaAi] = useState("");
  const [quantiAi, setQuantiAi] = useState("5");
  const [istruzioniAi, setIstruzioniAi] = useState("");
  const [faseAi, setFaseAi] = useState<"qualsiasi" | "riscaldamento" | "tecnico" | "situazionale" | "defaticamento">("qualsiasi");
  const [ruoloAi, setRuoloAi] = useState<string | null>(null);
  const [atletaAi, setAtletaAi] = useState<Athlete | null>(null);
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [usaPeriodo, setUsaPeriodo] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [proposte, setProposte] = useState<EsercizioProposto[]>([]);
  const [scartate, setScartate] = useState<Set<number>>(new Set());

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      setEsercizi(await elencaEsercizi(team.id));
      setAtlete(await elencaAtlete(team.id).catch(() => []));
    } finally {
      setCaricamento(false);
    }
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  /** Raggruppa per categoria: con un catalogo di decine di voci l'elenco piatto diventa illeggibile, che è il problema segnalato. */
  const sezioni = useMemo(() => {
    const filtro = ricerca.trim().toLowerCase();
    const visibili = filtro
      ? esercizi.filter((e) => e.nome.toLowerCase().includes(filtro) || (e.categoria ?? "").toLowerCase().includes(filtro))
      : esercizi;

    const gruppi = visibili.reduce<Record<string, Exercise[]>>((acc, e) => {
      const chiave = raggruppaPerFase
        ? (fasiAllenamento.find((f) => f.codice === (e.fase_consigliata ?? "tecnico"))?.etichetta ?? "Allenamento tecnico")
        : (e.categoria?.trim() || SENZA_CATEGORIA);
      (acc[chiave] ??= []).push(e);
      return acc;
    }, {});

    // Per fase l'ordine è quello di svolgimento della seduta, non
    // alfabetico: riscaldamento prima, defaticamento in fondo.
    const ordinaChiavi = (a: string, b: string) => {
      if (!raggruppaPerFase) return a.localeCompare(b);
      const ordine = fasiAllenamento.map((f) => f.etichetta);
      return ordine.indexOf(a) - ordine.indexOf(b);
    };

    return Object.keys(gruppi).sort(ordinaChiavi).map((titolo) => ({
      titolo,
      totale: gruppi[titolo].length,
      // Durante una ricerca le categorie restano sempre aperte: chiuderle
      // nasconderebbe proprio i risultati cercati.
      // categorieChiuse === null significa "mai toccate": tutte chiuse.
      data: (!filtro && (categorieChiuse === null || categorieChiuse.has(titolo))) ? [] : gruppi[titolo].sort((a, b) => a.nome.localeCompare(b.nome)),
    }));
  }, [esercizi, ricerca, categorieChiuse, raggruppaPerFase]);

  const categorieEsistenti = useMemo(
    () => [...new Set(esercizi.map((e) => e.categoria?.trim()).filter(Boolean) as string[])].sort(),
    [esercizi],
  );

  function commutaCategoria(titolo: string) {
    setCategorieChiuse((prev) => {
      // Al primo tocco si parte da "tutte chiuse" e si apre solo questa.
      if (prev === null) {
        const tutte = new Set(esercizi.map((e) => e.categoria?.trim() || SENZA_CATEGORIA));
        tutte.delete(titolo);
        return tutte;
      }
      const nuovo = new Set(prev);
      if (nuovo.has(titolo)) nuovo.delete(titolo);
      else nuovo.add(titolo);
      return nuovo;
    });
  }

  async function aggiungi() {
    if (!team || !nome.trim()) return;
    await creaEsercizio(team.id, { nome: nome.trim(), categoria: categoria.trim() || null, descrizione: "" });
    setNome(""); setCategoria(""); setPopupAperto(false);
    carica();
  }

  async function onGeneraAi() {
    if (!team || !categoriaAi.trim()) return;
    setGenerando(true);
    setProposte([]);
    setScartate(new Set());
    try {
      // Periodo del piano annuale in corso: se c'è, gli esercizi lo seguono.
      const periodo = usaPeriodo ? await leggiBloccoPerData(team.id, new Date().toISOString()).catch(() => null) : null;

      // Carenze reali dell'atleta scelta, dalle sue valutazioni.
      let atletaConCarenze = null;
      if (atletaAi) {
        const carenze = await carenzeAtleta(atletaAi.id).catch(() => []);
        atletaConCarenze = {
          nome: `${atletaAi.nome} ${atletaAi.cognome}`,
          ruolo: atletaAi.ruolo_campo,
          carenze: carenze.map((c) => ({ fondamentale: c.fondamentale, media: Number(c.media) })),
        };
        if (atletaConCarenze.carenze.length === 0) {
          avvisa("Nessuna valutazione", `Per ${atletaAi.nome} non ci sono valutazioni recenti: senza quelle non posso individuare le carenze. Procedo con esercizi generici per il ruolo.`);
        }
      }

      const r = await generaEserciziAI(team.id, categoriaAi.trim(), Number(quantiAi) || 5, esercizi, istruzioniAi, {
        periodo, ruolo: ruoloAi, atleta: atletaConCarenze, fase: faseAi,
      });
      if (r.errore || !r.esercizi) { avvisa("Generazione non riuscita", r.messaggio ?? "Errore sconosciuto"); return; }
      setProposte(r.esercizi);
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setGenerando(false);
    }
  }

  async function salvaProposte() {
    if (!team) return;
    const daSalvare = proposte.filter((_, i) => !scartate.has(i));
    if (daSalvare.length === 0) return;
    try {
      for (const p of daSalvare) {
        await creaEsercizio(team.id, { nome: p.nome, categoria: p.categoria || null, descrizione: p.descrizione, fase_consigliata: p.fase });
      }
      setProposte([]);
      setPopupAiAperto(false);
      carica();
      avvisa("Aggiunti", `${daSalvare.length} esercizi inseriti nel catalogo.`);
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    }
  }

  function commutaScarto(indice: number) {
    setScartate((prev) => {
      const nuovo = new Set(prev);
      if (nuovo.has(indice)) nuovo.delete(indice);
      else nuovo.add(indice);
      return nuovo;
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.barraRicerca}>
        <TextInput
          style={styles.inputRicerca}
          placeholder={`Cerca tra ${esercizi.length} esercizi…`}
          placeholderTextColor={brand.colors.muted}
          value={ricerca}
          onChangeText={setRicerca}
        />
        {!!ricerca && <Pressable onPress={() => setRicerca("")} hitSlop={10}><Text style={styles.pulisci}>✕</Text></Pressable>}
      </View>

      <View style={styles.rigaRaggruppa}>
        <Pressable onPress={() => setRaggruppaPerFase(true)} style={[styles.chipRaggruppa, raggruppaPerFase && styles.chipRaggruppaAttivo]}>
          <Text style={[styles.chipTesto, raggruppaPerFase && styles.chipTestoAttivo]}>Per fase</Text>
        </Pressable>
        <Pressable onPress={() => setRaggruppaPerFase(false)} style={[styles.chipRaggruppa, !raggruppaPerFase && styles.chipRaggruppaAttivo]}>
          <Text style={[styles.chipTesto, !raggruppaPerFase && styles.chipTestoAttivo]}>Per categoria</Text>
        </Pressable>
      </View>

      <SectionList
        sections={sezioni}
        keyExtractor={(e) => e.id}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={caricamento} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListEmptyComponent={!caricamento ? <Text style={styles.vuoto}>{ricerca ? "Nessun esercizio trovato." : "Nessun esercizio ancora. Usa il + qui sotto, oppure ✨ per farli proporre all'AI."}</Text> : null}
        renderSectionHeader={({ section }) => (
          <Pressable style={styles.intestazioneCategoria} onPress={() => commutaCategoria(section.titolo)}>
            <Text style={styles.titoloCategoria}>
              {(!ricerca && (categorieChiuse === null || categorieChiuse.has(section.titolo))) ? "▸" : "▾"} {section.titolo}
            </Text>
            <Text style={styles.conteggioCategoria}>{section.totale}</Text>
          </Pressable>
        )}
        renderItem={({ item }) => {
          const aperta = descrizioneAperta === item.id;
          return (
            <View style={styles.riga}>
              {/* Un tocco apre la descrizione sul posto (serve durante
                  l'allenamento), la freccia porta alla scheda completa
                  per modificarla. */}
              <Pressable style={styles.rigaTesta} onPress={() => setDescrizioneAperta(aperta ? null : item.id)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rigaNome}>{item.nome}</Text>
                  <Text style={styles.rigaSotto}>
                    {raggruppaPerFase
                      ? (item.categoria?.trim() || "senza categoria")
                      : (fasiAllenamento.find((f) => f.codice === (item.fase_consigliata ?? "tecnico"))?.etichetta ?? "")}
                  </Text>
                  {!!item.descrizione && !aperta && <Text style={styles.rigaDescrizione} numberOfLines={1}>{item.descrizione}</Text>}
                  {!item.descrizione && <Text style={styles.rigaDescrizione}>nessuna descrizione</Text>}
                </View>
                <Pressable onPress={() => router.push(`/esercizio/${item.id}`)} hitSlop={12} style={styles.tastoScheda}>
                  <Text style={styles.tastoSchedaTesto}>›</Text>
                </Pressable>
              </Pressable>
              {aperta && !!item.descrizione && <Text style={styles.rigaDescrizioneEstesa}>{item.descrizione}</Text>}
            </View>
          );
        }}
      />

      {puoScrivere && (
        <>
          <FabAggiungi onPress={() => setPopupAiAperto(true)} posizione="secondaria" icona="✨" />
          <FabAggiungi onPress={() => setPopupAperto(true)} />
        </>
      )}

      <PopupForm visibile={popupAperto} titolo="Nuovo esercizio" haModifiche={!!(nome.trim() || categoria.trim())} onChiudi={() => { setPopupAperto(false); setNome(""); setCategoria(""); }}>
        <TextInput style={styles.input} placeholder="Nome esercizio" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} autoFocus />
        <TextInput style={styles.input} placeholder="Categoria" placeholderTextColor={brand.colors.muted} value={categoria} onChangeText={setCategoria} />
        {categorieEsistenti.length > 0 && (
          <View style={styles.chipRiga}>
            {categorieEsistenti.map((c) => (
              <Pressable key={c} onPress={() => setCategoria(c)} style={[styles.chip, categoria === c && styles.chipAttivo]}>
                <Text style={[styles.chipTesto, categoria === c && styles.chipTestoAttivo]}>{c}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Pressable style={styles.bottone} onPress={aggiungi} disabled={!nome.trim()}>
          <Text style={styles.bottoneTesto}>Aggiungi esercizio</Text>
        </Pressable>
      </PopupForm>

      <Modal visible={popupAiAperto} animationType="slide" transparent onRequestClose={() => setPopupAiAperto(false)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <View style={styles.intestazionePopup}>
              <Text style={styles.titoloPopup}>Genera esercizi con AI</Text>
              <Pressable onPress={() => { setPopupAiAperto(false); setProposte([]); }}><Text style={styles.chiudiPopup}>✕</Text></Pressable>
            </View>

            {proposte.length === 0 ? (
              <>
                <Text style={styles.nota}>Gli esercizi già in catalogo vengono passati all'AI, che eviterà di riproporli.</Text>
                <TextInput style={styles.input} placeholder="Categoria (es. Ricezione)" placeholderTextColor={brand.colors.muted} value={categoriaAi} onChangeText={setCategoriaAi} />
                {categorieEsistenti.length > 0 && (
                  <View style={styles.chipRiga}>
                    {categorieEsistenti.map((c) => (
                      <Pressable key={c} onPress={() => setCategoriaAi(c)} style={[styles.chip, categoriaAi === c && styles.chipAttivo]}>
                        <Text style={[styles.chipTesto, categoriaAi === c && styles.chipTestoAttivo]}>{c}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                <View style={styles.chipRiga}>
                  {["3", "5", "8"].map((n) => (
                    <Pressable key={n} onPress={() => setQuantiAi(n)} style={[styles.chip, quantiAi === n && styles.chipAttivo]}>
                      <Text style={[styles.chipTesto, quantiAi === n && styles.chipTestoAttivo]}>{n} esercizi</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.etichettaOpzione}>Fase della seduta</Text>
                <View style={styles.chipRiga}>
                  <Pressable onPress={() => setFaseAi("qualsiasi")} style={[styles.chip, faseAi === "qualsiasi" && styles.chipAttivo]}>
                    <Text style={[styles.chipTesto, faseAi === "qualsiasi" && styles.chipTestoAttivo]}>Decide l'AI</Text>
                  </Pressable>
                  {fasiAllenamento.map((f) => (
                    <Pressable key={f.codice} onPress={() => setFaseAi(f.codice)} style={[styles.chip, faseAi === f.codice && styles.chipAttivo]}>
                      <Text style={[styles.chipTesto, faseAi === f.codice && styles.chipTestoAttivo]}>{f.etichetta}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.etichettaOpzione}>Per un ruolo specifico (lavoro a gruppi)</Text>
                <View style={styles.chipRiga}>
                  <Pressable onPress={() => setRuoloAi(null)} style={[styles.chip, !ruoloAi && styles.chipAttivo]}>
                    <Text style={[styles.chipTesto, !ruoloAi && styles.chipTestoAttivo]}>Tutti</Text>
                  </Pressable>
                  {ruoliCampo.map((r) => (
                    <Pressable key={r} onPress={() => setRuoloAi(ruoloAi === r ? null : r)} style={[styles.chip, ruoloAi === r && styles.chipAttivo]}>
                      <Text style={[styles.chipTesto, ruoloAi === r && styles.chipTestoAttivo]}>{r}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.etichettaOpzione}>Correttivi individuali (dalle carenze rilevate)</Text>
                <View style={styles.chipRiga}>
                  <Pressable onPress={() => setAtletaAi(null)} style={[styles.chip, !atletaAi && styles.chipAttivo]}>
                    <Text style={[styles.chipTesto, !atletaAi && styles.chipTestoAttivo]}>Nessuna</Text>
                  </Pressable>
                  {atlete.map((a) => (
                    <Pressable key={a.id} onPress={() => setAtletaAi(atletaAi?.id === a.id ? null : a)} style={[styles.chip, atletaAi?.id === a.id && styles.chipAttivo]}>
                      <Text style={[styles.chipTesto, atletaAi?.id === a.id && styles.chipTestoAttivo]}>{a.cognome}</Text>
                    </Pressable>
                  ))}
                </View>

                <Pressable onPress={() => setUsaPeriodo(!usaPeriodo)} style={styles.rigaInterruttore}>
                  <View style={[styles.quadratino, usaPeriodo && styles.quadratinoAttivo]}>{usaPeriodo && <Text style={styles.spunta}>✓</Text>}</View>
                  <Text style={styles.testoInterruttore}>Segui il periodo del piano annuale in corso</Text>
                </Pressable>

                <TextInput
                  style={[styles.input, { minHeight: 56, textAlignVertical: "top" }]}
                  multiline
                  placeholder="Indicazioni particolari (facoltativo): es. per under 14, con poco spazio, senza salti"
                  placeholderTextColor={brand.colors.muted}
                  value={istruzioniAi}
                  onChangeText={setIstruzioniAi}
                />
                <Pressable style={styles.bottone} onPress={onGeneraAi} disabled={generando || !categoriaAi.trim()}>
                  {generando ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Genera proposte</Text>}
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.nota}>Tocca una proposta per escluderla. Verranno aggiunte solo quelle selezionate.</Text>
                <View style={{ maxHeight: 360 }}>
                  <SectionList
                    sections={[{ titolo: "", totale: 0, data: proposte }]}
                    keyExtractor={(_, i) => String(i)}
                    renderSectionHeader={() => null}
                    renderItem={({ item, index }) => (
                      <Pressable style={[styles.proposta, scartate.has(index) && styles.propostaScartata]} onPress={() => commutaScarto(index)}>
                        <Text style={[styles.propostaNome, scartate.has(index) && styles.testoScartato]}>
                          {scartate.has(index) ? "✕ " : "✓ "}{item.nome}
                        </Text>
                        {!!item.descrizione && <Text style={styles.propostaDescrizione}>{item.descrizione}</Text>}
                      </Pressable>
                    )}
                  />
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable style={styles.bottoneSecondario} onPress={() => setProposte([])}><Text style={styles.bottoneSecondarioTesto}>Rigenera</Text></Pressable>
                  <Pressable style={[styles.bottone, { flex: 2 }]} onPress={salvaProposte}>
                    <Text style={styles.bottoneTesto}>Aggiungi {proposte.length - scartate.size} esercizi</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  barraRicerca: { flexDirection: "row", alignItems: "center", gap: 8, margin: 16, marginBottom: 8, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, paddingHorizontal: 12 },
  inputRicerca: { flex: 1, color: brand.colors.onSurface, paddingVertical: 10 },
  pulisci: { color: brand.colors.muted, fontSize: 16 },
  intestazioneCategoria: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: brand.colors.surface, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  titoloCategoria: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "800", textTransform: "uppercase" },
  conteggioCategoria: { color: brand.colors.muted, fontSize: 12, fontWeight: "700" },
  riga: { paddingLeft: 14, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaTesta: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, minHeight: 56 },
  rigaDescrizioneEstesa: { color: brand.colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21, paddingBottom: 12, paddingRight: 12 },
  tastoScheda: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  tastoSchedaTesto: { color: brand.colors.brand, fontSize: 22, fontWeight: "700" },
  rigaNome: { color: brand.colors.onSurface, fontSize: 15 },
  rigaRaggruppa: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  chipRaggruppa: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, backgroundColor: brand.colors.surfaceSecondary },
  chipRaggruppaAttivo: { backgroundColor: brand.colors.brand },
  rigaSotto: { color: brand.colors.brandSecondary, fontSize: 11, marginTop: 1 },
  rigaDescrizione: { color: brand.colors.muted, fontSize: 12, marginTop: 2 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  bottone: { backgroundColor: brand.colors.brand, padding: 12, borderRadius: 8, alignItems: "center", flex: 1 },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  bottoneSecondario: { flex: 1, borderColor: brand.colors.brand, borderWidth: 1, padding: 12, borderRadius: 8, alignItems: "center" },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "600" },
  nota: { color: brand.colors.muted, fontSize: 12 },
  chipRiga: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 14, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  etichettaOpzione: { color: brand.colors.muted, fontSize: 11, textTransform: "uppercase", marginTop: 4 },
  rigaInterruttore: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  quadratino: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: brand.colors.brand, alignItems: "center", justifyContent: "center" },
  quadratinoAttivo: { backgroundColor: brand.colors.brand },
  spunta: { color: "#000", fontWeight: "800", fontSize: 12 },
  testoInterruttore: { color: brand.colors.onSurface, fontSize: 13, flex: 1 },
  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10, maxHeight: "88%" },
  intestazionePopup: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  chiudiPopup: { color: brand.colors.muted, fontSize: 18 },
  proposta: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  propostaScartata: { opacity: 0.4 },
  propostaNome: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "600" },
  testoScartato: { textDecorationLine: "line-through" },
  propostaDescrizione: { color: brand.colors.muted, fontSize: 12, marginTop: 2 },
});
