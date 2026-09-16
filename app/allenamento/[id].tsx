import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Modal, FlatList } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { creaEsercizio, elencaEsercizi } from "@/src/services/exercises";
import { elencaPianoAllenamento, generaPianoAllenamentoAI, impostaPianoAllenamento, leggiBloccoPerData, type VoceRiepilogoPiano } from "@/src/services/trainingPlan";
import { avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import { supabaseClient } from "@/src/lib/supabase";
import type { Exercise, Training } from "@/src/types/database";

export default function PianoAllenamento() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { team, puoScrivere } = useAuth();
  const [training, setTraining] = useState<Training | null>(null);
  const [catalogo, setCatalogo] = useState<Exercise[]>([]);
  const [argomento, setArgomento] = useState("");
  const [durataObiettivo, setDurataObiettivo] = useState("120");
  const [esercizi, setEsercizi] = useState<VoceRiepilogoPiano[]>([]);
  const [mostraCatalogo, setMostraCatalogo] = useState(false);
  const [categorieEspanse, setCategorieEspanse] = useState<Set<string>>(new Set());
  const [generando, setGenerando] = useState(false);
  const [percentualeGenerazione, setPercentualeGenerazione] = useState(0);
  const [erroreGenerazione, setErroreGenerazione] = useState<string | null>(null);
  const [bloccoPeriodo, setBloccoPeriodo] = useState<{ nome: string; tipo: string } | null>(null);
  const [istruzioniExtra, setIstruzioniExtra] = useState("");
  const [sceltaGenerazione, setSceltaGenerazione] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const carica = useCallback(async () => {
    if (!id || !team) return;
    const { data: t } = await supabaseClient.from("trainings").select("*").eq("id", id).single();
    setTraining(t ?? null);
    setArgomento(t?.argomento ?? "");
    const cat = await elencaEsercizi(team.id);
    setCatalogo(cat);
    if (t?.data) setBloccoPeriodo(await leggiBloccoPerData(team.id, t.data).catch(() => null));
    const piano = await elencaPianoAllenamento(id);
    setEsercizi(piano.map((p) => ({
      exerciseId: p.exercise_id,
      nome: cat.find((c) => c.id === p.exercise_id)?.nome ?? "Esercizio",
      durataMinuti: p.durata_minuti ?? 10,
      note: p.note ?? "",
    })));
  }, [id, team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  const totaleMinuti = esercizi.reduce((s, e) => s + (e.durataMinuti || 0), 0);

  function aggiungiEsercizio(ex: Exercise) {
    setEsercizi((prev) => [...prev, { exerciseId: ex.id, nome: ex.nome, durataMinuti: 15, note: "" }]);
    setMostraCatalogo(false);
  }

  function rimuoviEsercizio(indice: number) {
    setEsercizi((prev) => prev.filter((_, i) => i !== indice));
  }

  function toggleCategoria(categoria: string) {
    setCategorieEspanse((prev) => {
      const nuovo = new Set(prev);
      if (nuovo.has(categoria)) nuovo.delete(categoria);
      else nuovo.add(categoria);
      return nuovo;
    });
  }

  const ETICHETTA_SENZA_CATEGORIA = "Senza categoria";
  const catalogoPerCategoria = catalogo.reduce<Record<string, Exercise[]>>((acc, ex) => {
    const chiave = ex.categoria?.trim() || ETICHETTA_SENZA_CATEGORIA;
    (acc[chiave] ??= []).push(ex);
    return acc;
  }, {});

  function aggiornaDurata(indice: number, testo: string) {
    const valore = Number(testo) || 0;
    setEsercizi((prev) => prev.map((e, i) => (i === indice ? { ...e, durataMinuti: valore } : e)));
  }

  function onGeneraAI() {
    if (!team) return;
    // Con un piano già avviato la scelta non è ovvia: a volte si vuole
    // ripartire da zero, altre aggiungere una parte (tipicamente il
    // tecnico specifico dopo aver messo a mano il riscaldamento).
    // Chiederlo evita di cancellare lavoro già fatto.
    if (esercizi.length > 0) setSceltaGenerazione(true);
    else eseguiGenerazione("sostituisci");
  }

  async function eseguiGenerazione(modo: "sostituisci" | "aggiungi") {
    if (!team) return;
    setSceltaGenerazione(false);
    {
      setGenerando(true);
      setErroreGenerazione(null);
      setPercentualeGenerazione(5);
      // Una singola chiamata AI non ha un progresso reale misurabile:
      // questa percentuale è simulata (sale fino al 90% mentre si
      // aspetta, salta al 100% al termine) — dà comunque un riscontro
      // molto più chiaro di uno spinner fermo, specie se il provider
      // ci mette qualche secondo a rispondere.
      const intervallo = setInterval(() => {
        setPercentualeGenerazione((p) => (p < 90 ? p + Math.max(1, Math.round((90 - p) * 0.15)) : p));
      }, 400);

      try {
        const r = await generaPianoAllenamentoAI(team!.id, argomento || "allenamento generico", Number(durataObiettivo) || 120, catalogo, training?.data, istruzioniExtra);
        if (r.errore || !r.esercizi) {
          const messaggio = r.messaggio ?? "Errore sconosciuto";
          setErroreGenerazione(messaggio);
          avvisa("Generazione non riuscita", messaggio);
          return;
        }
        setPercentualeGenerazione(100);
        // In "aggiungi" si scartano le proposte già presenti nel piano:
        // senza questo controllo l'AI ripropone volentieri esercizi
        // che ha appena visto nel catalogo.
        // Esercizi proposti ma non in catalogo: si aggiungono al
        // catalogo e al piano, così la proposta non va persa.
        const daCatalogare = r.nuovi ?? [];
        const creati: typeof r.esercizi = [];
        for (const n of daCatalogare) {
          try {
            const ex = await creaEsercizio(team!.id, { nome: n.nome, categoria: n.categoria || null, descrizione: n.descrizione });
            creati.push({ exerciseId: ex.id, nome: ex.nome, durataMinuti: n.durataMinuti, note: "" });
          } catch { /* un nome duplicato non deve fermare il resto */ }
        }
        if (creati.length > 0) {
          setCatalogo(await elencaEsercizi(team!.id));
          avvisa("Nuovi esercizi", `${creati.length} esercizi non presenti in catalogo sono stati aggiunti e inseriti nel piano.`);
        }
        const tutti = [...r.esercizi, ...creati];

        if (modo === "aggiungi") {
          const giaPresenti = new Set(esercizi.map((e) => e.exerciseId));
          const nuovi = tutti.filter((e) => !giaPresenti.has(e.exerciseId));
          setEsercizi((prec) => [...prec, ...nuovi]);
          if (nuovi.length < tutti.length) {
            avvisa("Alcune proposte scartate", `${tutti.length - nuovi.length} esercizi erano già nel piano.`);
          }
        } else {
          setEsercizi(tutti);
          if (r.argomentoSuggerito) setArgomento(r.argomentoSuggerito);
        }
      } catch (e) {
        const messaggio = (e as Error).message;
        console.error("Errore generazione piano AI:", e);
        setErroreGenerazione(messaggio);
        avvisa("Errore", messaggio);
      } finally {
        clearInterval(intervallo);
        setGenerando(false);
        setTimeout(() => setPercentualeGenerazione(0), 600);
      }
    }
  }

  async function salva() {
    if (!id || !team) return;
    setSalvando(true);
    try {
      // Gli esercizi proposti dall'AI e non presenti in catalogo vanno
      // creati prima: il piano può puntare solo a esercizi esistenti.
      const daSalvare = [...esercizi];
      for (let i = 0; i < daSalvare.length; i++) {
        if (!daSalvare[i].exerciseId) {
          const creato = await creaEsercizio(team.id, {
            nome: daSalvare[i].nome,
            categoria: daSalvare[i].categoria ?? null,
            descrizione: daSalvare[i].descrizione ?? "",
          });
          daSalvare[i] = { ...daSalvare[i], exerciseId: creato.id, nuovo: false };
        }
      }
      setEsercizi(daSalvare);
      await impostaPianoAllenamento(id, argomento, daSalvare);
      avvisa("Salvato", "Piano allenamento aggiornato.");
      router.back();
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (!training) return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← {training.titolo}</Text></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={styles.card}>
          <Text style={styles.etichetta}>Argomento della sessione</Text>
          <TextInput style={styles.input} placeholder="Es. difesa e copertura attacco" placeholderTextColor={brand.colors.muted} value={argomento} onChangeText={setArgomento} />

          <View style={styles.rigaGenerazione}>
            <View style={{ flex: 1 }}>
              <Text style={styles.etichetta}>Durata obiettivo (min)</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={durataObiettivo} onChangeText={setDurataObiettivo} />
            </View>
            <Pressable style={styles.bottoneAI} onPress={onGeneraAI} disabled={generando}>
              {generando ? <Text style={styles.bottoneAITesto}>{percentualeGenerazione}%</Text> : <Text style={styles.bottoneAITesto}>✨ Genera con AI</Text>}
            </Pressable>
          </View>
          {generando && (
            <View style={styles.barraAvanzamentoSfondo}>
              <View style={[styles.barraAvanzamentoRiempimento, { width: `${percentualeGenerazione}%` }]} />
            </View>
          )}
          {erroreGenerazione && !generando && <Text style={styles.erroreTesto}>{erroreGenerazione}</Text>}
          {bloccoPeriodo && <Text style={styles.notaPeriodo}>📋 Periodo del piano annuale: {bloccoPeriodo.nome} ({bloccoPeriodo.tipo.replace(/_/g, " ")}) — la proposta AI ne terrà conto.</Text>}
          <TextInput
            style={[styles.input, { minHeight: 56, textAlignVertical: "top" }]}
            multiline
            placeholder="Indicazioni per questa seduta (facoltativo): es. poche atlete disponibili, lavorare sul muro, niente salti per infortuni"
            placeholderTextColor={brand.colors.muted}
            value={istruzioniExtra}
            onChangeText={setIstruzioniExtra}
          />
          <Text style={styles.nota}>La proposta AI usa solo esercizi già nel tuo catalogo, e resta modificabile prima di salvare — se non risponde, costruisci il piano scegliendo qui sotto.</Text>
        </View>

        <View style={styles.card}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.etichetta}>Esercizi ({totaleMinuti} min totali)</Text>
            <Pressable onPress={() => setMostraCatalogo(true)}><Text style={styles.linkAggiungi}>+ Aggiungi</Text></Pressable>
          </View>

          {esercizi.length === 0 ? (
            <Text style={styles.nota}>Nessun esercizio ancora in questo piano.</Text>
          ) : (
            Object.entries(
              esercizi.reduce<Record<string, { e: VoceRiepilogoPiano; i: number }[]>>((acc, e, i) => {
                const cat = catalogo.find((c) => c.id === e.exerciseId)?.categoria?.trim() || "Senza categoria";
                (acc[cat] ??= []).push({ e, i });
                return acc;
              }, {}),
            ).sort(([a], [b]) => a.localeCompare(b)).map(([categoria, voci]) => (
              <View key={categoria}>
                <Text style={styles.etichettaCategoriaPiano}>{categoria}</Text>
                {voci.map(({ e, i }) => (
                  <View key={i} style={styles.rigaEsercizio}>
                    <Text style={styles.rigaEsercizioNome}>{e.nuovo ? "✨ " : ""}{e.nome}</Text>
                    <TextInput style={styles.inputDurata} keyboardType="numeric" value={String(e.durataMinuti)} onChangeText={(t) => aggiornaDurata(i, t)} />
                    <Text style={styles.nota}>min</Text>
                    <Pressable onPress={() => rimuoviEsercizio(i)}><Text style={styles.rimuovi}>✕</Text></Pressable>
                  </View>
                ))}
              </View>
            ))
          )}
        </View>

        <Pressable style={styles.bottoneSalva} onPress={salva} disabled={salvando}>
          {salvando ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneSalvaTesto}>Salva piano</Text>}
        </Pressable>
      </ScrollView>

      <Modal visible={sceltaGenerazione} animationType="fade" transparent onRequestClose={() => setSceltaGenerazione(false)}>
        <View style={styles.sfondoPopup}>
          <View style={[styles.cartaPopup, { maxHeight: undefined }]}>
            <Text style={styles.titoloPopup}>Il piano contiene già {esercizi.length} esercizi</Text>
            <Text style={styles.nota}>Cosa vuoi fare con la proposta dell'assistente?</Text>

            <Pressable style={styles.bottoneSceltaPrimaria} onPress={() => eseguiGenerazione("aggiungi")}>
              <Text style={styles.bottoneSceltaPrimariaTesto}>Aggiungi al piano</Text>
              <Text style={styles.bottoneSceltaNota}>Gli esercizi già inseriti restano dove sono</Text>
            </Pressable>

            <Pressable style={styles.bottoneSceltaSecondaria} onPress={() => eseguiGenerazione("sostituisci")}>
              <Text style={styles.bottoneSceltaSecondariaTesto}>Sostituisci tutto</Text>
              <Text style={styles.bottoneSceltaNota}>Il piano attuale viene rifatto da zero</Text>
            </Pressable>

            <Pressable onPress={() => setSceltaGenerazione(false)}>
              <Text style={styles.annullaScelta}>Annulla</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={mostraCatalogo} animationType="slide" transparent onRequestClose={() => setMostraCatalogo(false)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <View style={styles.intestazionePopup}>
              <Text style={styles.titoloPopup}>Scegli un esercizio</Text>
              <Pressable onPress={() => setMostraCatalogo(false)}><Text style={styles.chiudiPopup}>✕</Text></Pressable>
            </View>
            {catalogo.length === 0 ? (
              <Text style={styles.nota}>Nessun esercizio nel catalogo — aggiungine dalla tab Esercizi.</Text>
            ) : (
              <FlatList
                data={Object.keys(catalogoPerCategoria).sort()}
                keyExtractor={(c) => c}
                renderItem={({ item: categoria }) => (
                  <View>
                    <Pressable style={styles.rigaCategoria} onPress={() => toggleCategoria(categoria)}>
                      <Text style={styles.rigaCategoriaTesto}>{categorieEspanse.has(categoria) ? "▾" : "▸"} {categoria} ({catalogoPerCategoria[categoria].length})</Text>
                    </Pressable>
                    {categorieEspanse.has(categoria) && catalogoPerCategoria[categoria].map((ex) => (
                      <Pressable key={ex.id} style={styles.rigaCatalogo} onPress={() => aggiungiEsercizio(ex)}>
                        <Text style={styles.rigaCatalogoTesto}>{ex.nome}</Text>
                        {!!ex.descrizione && <Text style={styles.rigaCatalogoDescrizione} numberOfLines={2}>{ex.descrizione}</Text>}
                      </Pressable>
                    ))}
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 8 },
  etichetta: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 14 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  nota: { color: brand.colors.muted, fontSize: 12 },
  notaPeriodo: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "600" },
  rigaGenerazione: { flexDirection: "row", gap: 10, alignItems: "flex-end" },
  bottoneAI: { borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, justifyContent: "center", minWidth: 60, alignItems: "center" },
  barraAvanzamentoSfondo: { height: 4, backgroundColor: brand.colors.surfaceTertiary, borderRadius: 2, overflow: "hidden" },
  barraAvanzamentoRiempimento: { height: "100%", backgroundColor: brand.colors.brandSecondary },
  erroreTesto: { color: brand.colors.error, fontSize: 12 },
  bottoneAITesto: { color: brand.colors.brandSecondary, fontWeight: "700" },
  linkAggiungi: { color: brand.colors.brand, fontWeight: "600", fontSize: 13 },
  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 8, maxHeight: "80%" },
  intestazionePopup: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  chiudiPopup: { color: brand.colors.muted, fontSize: 18 },
  rigaCategoria: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaCategoriaTesto: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "700" },
  rigaCatalogo: { paddingVertical: 8, paddingLeft: 20, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaCatalogoTesto: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "600" },
  rigaCatalogoDescrizione: { color: brand.colors.muted, fontSize: 12, marginTop: 2, lineHeight: 17 },
  bottoneSceltaPrimaria: { backgroundColor: brand.colors.brand, borderRadius: 10, padding: 14, alignItems: "center", gap: 2 },
  bottoneSceltaPrimariaTesto: { color: "#000", fontWeight: "800", fontSize: 15 },
  bottoneSceltaSecondaria: { borderWidth: 1, borderColor: brand.colors.brand, borderRadius: 10, padding: 14, alignItems: "center", gap: 2 },
  bottoneSceltaSecondariaTesto: { color: brand.colors.brand, fontWeight: "800", fontSize: 15 },
  bottoneSceltaNota: { color: brand.colors.muted, fontSize: 11 },
  annullaScelta: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 8 },
  etichettaCategoriaPiano: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "700", marginTop: 8, textTransform: "uppercase" },
  rigaEsercizio: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: brand.colors.border },
  rigaEsercizioNome: { color: brand.colors.onSurface, flex: 1, fontSize: 14 },
  inputDurata: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 6, padding: 6, width: 44, textAlign: "center" },
  rimuovi: { color: brand.colors.error, fontSize: 16, paddingHorizontal: 4 },
  bottoneSalva: { backgroundColor: brand.colors.brand, padding: 14, borderRadius: 10, alignItems: "center" },
  bottoneSalvaTesto: { color: "#000", fontWeight: "700" },
});
