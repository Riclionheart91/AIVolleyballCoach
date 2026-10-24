import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, TextInput, ActivityIndicator } from "react-native";
import { brand } from "@/src/config";
import { elencaEsercizi } from "@/src/services/exercises";
import type { BozzaEsercizio } from "@/src/services/pianiIndividuali";
import type { Exercise } from "@/src/types/database";

const QUANDO: { valore: BozzaEsercizio["quando"]; etichetta: string }[] = [
  { valore: "riscaldamento", etichetta: "Riscaldamento" },
  { valore: "tecnico", etichetta: "Parte tecnica" },
  { valore: "autonomo", etichetta: "In autonomia" },
];

export const BOZZA_VUOTA: BozzaEsercizio = { exercise_id: null, nome: "", indicazioni: "", volte_a_settimana: 2, durata_minuti: 10, quando: "riscaldamento" };

/**
 * Un esercizio del piano: si sceglie dal catalogo (i campi si riempiono da soli e restano ritoccabili)
 * oppure si scrive da zero. Serve per aggiungere, modificare e sostituire.
 */
export function EditorEsercizio({ visibile, teamId, titolo, iniziale, onSalva, onChiudi }: {
  visibile: boolean; teamId: string; titolo: string; iniziale?: BozzaEsercizio | null;
  onSalva: (b: BozzaEsercizio) => void | Promise<void>; onChiudi: () => void;
}) {
  const [bozza, setBozza] = useState<BozzaEsercizio>(BOZZA_VUOTA);
  const [catalogo, setCatalogo] = useState<Exercise[] | null>(null);
  const [cerca, setCerca] = useState("");
  const [mostraCatalogo, setMostraCatalogo] = useState(false);
  const [salvataggio, setSalvataggio] = useState(false);

  useEffect(() => {
    if (!visibile) return;
    setBozza(iniziale ?? BOZZA_VUOTA);
    setCerca("");
    setMostraCatalogo(!iniziale);
  }, [visibile, iniziale]);

  useEffect(() => {
    if (visibile && mostraCatalogo && catalogo === null) elencaEsercizi(teamId).then(setCatalogo).catch(() => setCatalogo([]));
  }, [visibile, mostraCatalogo, catalogo, teamId]);

  const filtrati = (catalogo ?? []).filter((e) => !cerca.trim() || `${e.nome} ${e.categoria ?? ""}`.toLowerCase().includes(cerca.trim().toLowerCase())).slice(0, 40);

  function daCatalogo(e: Exercise) {
    setBozza((b) => ({ ...b, exercise_id: e.id, nome: e.nome, indicazioni: e.descrizione ?? "" }));
    setMostraCatalogo(false);
  }

  async function salva() {
    if (!bozza.nome.trim()) return;
    setSalvataggio(true);
    try { await onSalva(bozza); } finally { setSalvataggio(false); }
  }

  return (
    <Modal visible={visibile} animationType="slide" transparent onRequestClose={onChiudi}>
      <View style={styles.sfondo}>
        <View style={styles.carta}>
          <ScrollView contentContainerStyle={{ gap: 10 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.titolo}>{titolo}</Text>

            <View style={styles.riga}>
              <Pressable style={[styles.chip, mostraCatalogo && styles.chipAttivo]} onPress={() => setMostraCatalogo(true)}>
                <Text style={[styles.chipTesto, mostraCatalogo && styles.chipTestoAttivo]}>📚 Dal catalogo</Text>
              </Pressable>
              <Pressable style={[styles.chip, !mostraCatalogo && styles.chipAttivo]} onPress={() => setMostraCatalogo(false)}>
                <Text style={[styles.chipTesto, !mostraCatalogo && styles.chipTestoAttivo]}>✍️ A mano</Text>
              </Pressable>
            </View>

            {mostraCatalogo ? (
              <>
                <TextInput style={styles.input} placeholder="Cerca un esercizio" placeholderTextColor={brand.colors.muted} value={cerca} onChangeText={setCerca} />
                {catalogo === null ? <ActivityIndicator color={brand.colors.brand} /> : filtrati.length === 0 ? (
                  <Text style={styles.nota}>Nessun esercizio trovato. Passa ad "A mano" per scriverlo tu.</Text>
                ) : filtrati.map((e) => (
                  <Pressable key={e.id} style={styles.voce} onPress={() => daCatalogo(e)}>
                    <Text style={styles.voceNome}>{e.nome}</Text>
                    {!!e.categoria && <Text style={styles.nota}>{e.categoria}</Text>}
                  </Pressable>
                ))}
              </>
            ) : (
              <>
                {bozza.exercise_id && <Text style={styles.nota}>Dal catalogo: puoi ritoccare nome, indicazioni e frequenza solo per questo piano.</Text>}
                <TextInput style={styles.input} placeholder="Nome dell'esercizio" placeholderTextColor={brand.colors.muted} value={bozza.nome} onChangeText={(t) => setBozza({ ...bozza, nome: t })} />
                <TextInput style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]} multiline placeholder="Come si esegue e cosa curare" placeholderTextColor={brand.colors.muted} value={bozza.indicazioni} onChangeText={(t) => setBozza({ ...bozza, indicazioni: t })} />

                <View style={styles.rigaNumeri}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.etichetta}>Volte a settimana</Text>
                    <View style={styles.stepper}>
                      <Pressable style={styles.stepperTasto} onPress={() => setBozza({ ...bozza, volte_a_settimana: Math.max(1, bozza.volte_a_settimana - 1) })}><Text style={styles.stepperTesto}>−</Text></Pressable>
                      <Text style={styles.stepperValore}>{bozza.volte_a_settimana}</Text>
                      <Pressable style={styles.stepperTasto} onPress={() => setBozza({ ...bozza, volte_a_settimana: Math.min(7, bozza.volte_a_settimana + 1) })}><Text style={styles.stepperTesto}>+</Text></Pressable>
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.etichetta}>Minuti</Text>
                    <View style={styles.stepper}>
                      <Pressable style={styles.stepperTasto} onPress={() => setBozza({ ...bozza, durata_minuti: Math.max(5, bozza.durata_minuti - 5) })}><Text style={styles.stepperTesto}>−</Text></Pressable>
                      <Text style={styles.stepperValore}>{bozza.durata_minuti}</Text>
                      <Pressable style={styles.stepperTasto} onPress={() => setBozza({ ...bozza, durata_minuti: Math.min(90, bozza.durata_minuti + 5) })}><Text style={styles.stepperTesto}>+</Text></Pressable>
                    </View>
                  </View>
                </View>

                <Text style={styles.etichetta}>Quando</Text>
                <View style={styles.riga}>
                  {QUANDO.map((q) => (
                    <Pressable key={q.valore} style={[styles.chip, bozza.quando === q.valore && styles.chipAttivo]} onPress={() => setBozza({ ...bozza, quando: q.valore })}>
                      <Text style={[styles.chipTesto, bozza.quando === q.valore && styles.chipTestoAttivo]}>{q.etichetta}</Text>
                    </Pressable>
                  ))}
                </View>

                <Pressable style={[styles.bottone, !bozza.nome.trim() && { opacity: 0.4 }]} onPress={salva} disabled={!bozza.nome.trim() || salvataggio}>
                  <Text style={styles.bottoneTesto}>{salvataggio ? "Salvo…" : "Salva esercizio"}</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
          <Pressable onPress={onChiudi}><Text style={styles.chiudi}>Annulla</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sfondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 20 },
  carta: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 18, gap: 10, maxHeight: "92%" },
  titolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  riga: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  nota: { color: brand.colors.muted, fontSize: 12 },
  voce: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  voceNome: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "600" },
  etichetta: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "700", marginBottom: 4 },
  rigaNumeri: { flexDirection: "row", gap: 16 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepperTasto: { width: 36, height: 36, borderRadius: 8, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  stepperTesto: { color: brand.colors.onSurface, fontSize: 20, fontWeight: "700" },
  stepperValore: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700", minWidth: 28, textAlign: "center" },
  bottone: { backgroundColor: brand.colors.brand, padding: 12, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  chiudi: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 6 },
});
