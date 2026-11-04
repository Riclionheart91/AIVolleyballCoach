import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, SectionList } from "react-native";
import { carenzeAtleta, creaEsercizio, generaEserciziAI, type EsercizioProposto } from "@/src/services/exercises";
import { leggiBloccoPerData } from "@/src/services/trainingPlan";
import { ruoliCampo, fasiAllenamento, brand } from "@/src/config";
import { avvisa } from "@/src/lib/confermaAzione";
import type { Athlete, Exercise } from "@/src/types/database";

/**
 * Maschera di creazione esercizi: manuale (nome + categoria, con le
 * categorie già esistenti proposte come scelta rapida) oppure assistita
 * dall'AI (stessa proposta con descrizione, fase, correttivi individuali
 * ecc. già usata nel catalogo). Un unico componente condiviso tra la tab
 * Esercizi e la creazione al volo dal piano di una seduta, così è
 * davvero la stessa maschera in entrambi i posti — non una versione
 * ridotta che manca dei campi generati dall'AI.
 */
export function CreaEsercizio({
  teamId,
  eserciziEsistenti,
  atlete = [],
  modoIniziale = "manuale",
  onCreati,
}: {
  teamId: string;
  eserciziEsistenti: Exercise[];
  atlete?: Athlete[];
  modoIniziale?: "manuale" | "ai";
  onCreati: (nuovi: Exercise[]) => void;
}) {
  const [modo, setModo] = useState<"manuale" | "ai">(modoIniziale);

  // --- Manuale ---
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [creandoManuale, setCreandoManuale] = useState(false);

  // --- AI ---
  const [categoriaAi, setCategoriaAi] = useState("");
  const [quantiAi, setQuantiAi] = useState("5");
  const [istruzioniAi, setIstruzioniAi] = useState("");
  const [faseAi, setFaseAi] = useState<"qualsiasi" | "riscaldamento" | "tecnico" | "situazionale" | "defaticamento">("qualsiasi");
  const [ruoloAi, setRuoloAi] = useState<string | null>(null);
  const [atletaAi, setAtletaAi] = useState<Athlete | null>(null);
  const [usaPeriodo, setUsaPeriodo] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [proposte, setProposte] = useState<EsercizioProposto[]>([]);
  const [scartate, setScartate] = useState<Set<number>>(new Set());
  const [salvandoProposte, setSalvandoProposte] = useState(false);

  const categorieEsistenti = [...new Set(eserciziEsistenti.map((e) => e.categoria?.trim()).filter(Boolean) as string[])].sort();

  async function creaManuale() {
    if (!nome.trim()) return;
    setCreandoManuale(true);
    try {
      const ex = await creaEsercizio(teamId, { nome: nome.trim(), categoria: categoria.trim() || null, descrizione: descrizione.trim() });
      setNome(""); setCategoria(""); setDescrizione("");
      onCreati([ex]);
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCreandoManuale(false);
    }
  }

  async function onGeneraAi() {
    if (!teamId || !categoriaAi.trim()) return;
    setGenerando(true);
    setProposte([]);
    setScartate(new Set());
    try {
      // Periodo del piano annuale in corso: se c'è, gli esercizi lo seguono.
      const periodo = usaPeriodo ? await leggiBloccoPerData(teamId, new Date().toISOString()).catch(() => null) : null;

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

      const r = await generaEserciziAI(teamId, categoriaAi.trim(), Number(quantiAi) || 5, eserciziEsistenti, istruzioniAi, {
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
    const daSalvare = proposte.filter((_, i) => !scartate.has(i));
    if (daSalvare.length === 0) return;
    setSalvandoProposte(true);
    try {
      const creati: Exercise[] = [];
      for (const p of daSalvare) {
        creati.push(await creaEsercizio(teamId, { nome: p.nome, categoria: p.categoria || null, descrizione: p.descrizione, fase_consigliata: p.fase } as Partial<Exercise> as Pick<Exercise, "nome" | "categoria" | "descrizione">));
      }
      setProposte([]);
      onCreati(creati);
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setSalvandoProposte(false);
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
    <View style={{ gap: 10 }}>
      <View style={styles.rigaRaggruppa}>
        <Pressable onPress={() => setModo("manuale")} style={[styles.chipRaggruppa, modo === "manuale" && styles.chipRaggruppaAttivo]}>
          <Text style={[styles.chipTesto, modo === "manuale" && styles.chipTestoAttivo]}>Manuale</Text>
        </Pressable>
        <Pressable onPress={() => setModo("ai")} style={[styles.chipRaggruppa, modo === "ai" && styles.chipRaggruppaAttivo]}>
          <Text style={[styles.chipTesto, modo === "ai" && styles.chipTestoAttivo]}>✨ Genera con AI</Text>
        </Pressable>
      </View>

      {modo === "manuale" ? (
        <View style={{ gap: 8 }}>
          <TextInput style={styles.input} placeholder="Nome esercizio" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} autoFocus />
          <TextInput style={styles.input} placeholder="Categoria" placeholderTextColor={brand.colors.muted} value={categoria} onChangeText={setCategoria} />
          {categorieEsistenti.length > 0 && (
            <View style={styles.chipRiga}>
              {categorieEsistenti.map((c) => (
                <Pressable key={c} onPress={() => setCategoria(c)} hitSlop={4} style={[styles.chip, categoria === c && styles.chipAttivo]}>
                  <Text style={[styles.chipTesto, categoria === c && styles.chipTestoAttivo]}>{c}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <TextInput
            style={[styles.input, { minHeight: 56, textAlignVertical: "top" }]}
            multiline
            placeholder="Descrizione (facoltativa): come si svolge, obiettivo, criterio di riuscita"
            placeholderTextColor={brand.colors.muted}
            value={descrizione}
            onChangeText={setDescrizione}
          />
          <Pressable style={styles.bottone} onPress={creaManuale} disabled={creandoManuale || !nome.trim()}>
            {creandoManuale ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Aggiungi esercizio</Text>}
          </Pressable>
        </View>
      ) : proposte.length === 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.nota}>Gli esercizi già in catalogo vengono passati all'AI, che eviterà di riproporli.</Text>
          <TextInput style={styles.input} placeholder="Categoria (es. Ricezione)" placeholderTextColor={brand.colors.muted} value={categoriaAi} onChangeText={setCategoriaAi} />
          {categorieEsistenti.length > 0 && (
            <View style={styles.chipRiga}>
              {categorieEsistenti.map((c) => (
                <Pressable key={c} onPress={() => setCategoriaAi(c)} hitSlop={4} style={[styles.chip, categoriaAi === c && styles.chipAttivo]}>
                  <Text style={[styles.chipTesto, categoriaAi === c && styles.chipTestoAttivo]}>{c}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={styles.chipRiga}>
            {["3", "5", "8"].map((n) => (
              <Pressable key={n} onPress={() => setQuantiAi(n)} hitSlop={4} style={[styles.chip, quantiAi === n && styles.chipAttivo]}>
                <Text style={[styles.chipTesto, quantiAi === n && styles.chipTestoAttivo]}>{n} esercizi</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.etichettaOpzione}>Fase della seduta</Text>
          <View style={styles.chipRiga}>
            <Pressable onPress={() => setFaseAi("qualsiasi")} hitSlop={4} style={[styles.chip, faseAi === "qualsiasi" && styles.chipAttivo]}>
              <Text style={[styles.chipTesto, faseAi === "qualsiasi" && styles.chipTestoAttivo]}>Decide l'AI</Text>
            </Pressable>
            {fasiAllenamento.map((f) => (
              <Pressable key={f.codice} onPress={() => setFaseAi(f.codice)} hitSlop={4} style={[styles.chip, faseAi === f.codice && styles.chipAttivo]}>
                <Text style={[styles.chipTesto, faseAi === f.codice && styles.chipTestoAttivo]}>{f.etichetta}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.etichettaOpzione}>Per un ruolo specifico (lavoro a gruppi)</Text>
          <View style={styles.chipRiga}>
            <Pressable onPress={() => setRuoloAi(null)} hitSlop={4} style={[styles.chip, !ruoloAi && styles.chipAttivo]}>
              <Text style={[styles.chipTesto, !ruoloAi && styles.chipTestoAttivo]}>Tutti</Text>
            </Pressable>
            {ruoliCampo.map((r) => (
              <Pressable key={r} onPress={() => setRuoloAi(ruoloAi === r ? null : r)} hitSlop={4} style={[styles.chip, ruoloAi === r && styles.chipAttivo]}>
                <Text style={[styles.chipTesto, ruoloAi === r && styles.chipTestoAttivo]}>{r}</Text>
              </Pressable>
            ))}
          </View>

          {atlete.length > 0 && (
            <>
              <Text style={styles.etichettaOpzione}>Correttivi individuali (dalle carenze rilevate)</Text>
              <View style={styles.chipRiga}>
                <Pressable onPress={() => setAtletaAi(null)} hitSlop={4} style={[styles.chip, !atletaAi && styles.chipAttivo]}>
                  <Text style={[styles.chipTesto, !atletaAi && styles.chipTestoAttivo]}>Nessuna</Text>
                </Pressable>
                {atlete.map((a) => (
                  <Pressable key={a.id} onPress={() => setAtletaAi(atletaAi?.id === a.id ? null : a)} hitSlop={4} style={[styles.chip, atletaAi?.id === a.id && styles.chipAttivo]}>
                    <Text style={[styles.chipTesto, atletaAi?.id === a.id && styles.chipTestoAttivo]}>{a.cognome}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Pressable onPress={() => setUsaPeriodo(!usaPeriodo)} style={styles.rigaInterruttore}>
            <View style={[styles.quadratino, usaPeriodo && styles.quadratinoAttivo]}>{usaPeriodo && <Text style={styles.spunta}>✓</Text>}</View>
            <Text style={styles.testoInterruttore}>Segui il periodo del piano annuale in corso</Text>
          </Pressable>

          <TextInput
            style={[styles.input, { minHeight: 56, textAlignVertical: "top" }]}
            multiline
            placeholder="Indicazioni particolari (facoltativo): es. per under 14, con poco spazio, senza salti"
            placeholderTextColor={brand.colors.muted}
            maxLength={500} value={istruzioniAi}
            onChangeText={setIstruzioniAi}
          />
          <Pressable style={styles.bottone} onPress={onGeneraAi} disabled={generando || !categoriaAi.trim()}>
            {generando ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Genera proposte</Text>}
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={styles.nota}>Tocca una proposta per escluderla. Verranno aggiunte solo quelle selezionate.</Text>
          <View style={{ maxHeight: 320 }}>
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
            <Pressable style={[styles.bottone, { flex: 2 }]} onPress={salvaProposte} disabled={salvandoProposte || proposte.length - scartate.size === 0}>
              {salvandoProposte ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Aggiungi {proposte.length - scartate.size} esercizi</Text>}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rigaRaggruppa: { flexDirection: "row", backgroundColor: brand.colors.surfaceTertiary, borderRadius: 12, padding: 2 },
  chipRaggruppa: { flex: 1, minHeight: 40, paddingHorizontal: 14, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  chipRaggruppaAttivo: { backgroundColor: brand.colors.brand },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 44, fontSize: 16 },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 12, paddingHorizontal: 20, minHeight: 48, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
  bottoneSecondario: { flex: 1, backgroundColor: brand.colors.surfaceTertiary, paddingVertical: 12, paddingHorizontal: 16, minHeight: 48, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  bottoneSecondarioTesto: { color: brand.colors.onSurface, fontWeight: "600", fontSize: 16 },
  nota: { color: brand.colors.muted, fontSize: 13 },
  chipRiga: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 14, minHeight: 36, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14, fontWeight: "600" },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  etichettaOpzione: { color: brand.colors.muted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6 },
  rigaInterruttore: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, minHeight: 44 },
  quadratino: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: brand.colors.brand, alignItems: "center", justifyContent: "center" },
  quadratinoAttivo: { backgroundColor: brand.colors.brand },
  spunta: { color: "#000", fontWeight: "800", fontSize: 13 },
  testoInterruttore: { color: brand.colors.onSurface, fontSize: 14, flex: 1 },
  proposta: { paddingVertical: 12, minHeight: 44, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  propostaScartata: { opacity: 0.4 },
  propostaNome: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  testoScartato: { textDecorationLine: "line-through" },
  propostaDescrizione: { color: brand.colors.muted, fontSize: 13, marginTop: 2 },
});
