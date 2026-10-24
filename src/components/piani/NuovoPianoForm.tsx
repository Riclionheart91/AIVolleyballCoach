import { useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput } from "react-native";
import { brand } from "@/src/config";
import { avvisa, confermaAzione } from "@/src/lib/confermaAzione";
import { creaPianoPerPersone, type BozzaEsercizio } from "@/src/services/pianiIndividuali";
import { EditorEsercizio } from "@/src/components/piani/EditorEsercizio";
import { SelettorePersone } from "@/src/components/piani/SelettorePersone";
import type { Athlete } from "@/src/types/database";

const QUANDO: Record<string, string> = { riscaldamento: "riscaldamento", tecnico: "parte tecnica", autonomo: "in autonomia" };

/**
 * Nuovo piano individuale: titolo e obiettivo, gli esercizi (dal catalogo o scritti a mano) e le persone
 * a cui assegnarlo. Ogni persona riceve la sua copia, con gli svolgimenti da spuntare per conto suo.
 */
export function NuovoPianoForm({ teamId, atlete, preselezionate, onCreato, onAnnulla }: {
  teamId: string; atlete: Athlete[]; preselezionate?: string[]; onCreato: (quante: number) => void; onAnnulla?: () => void;
}) {
  const [titolo, setTitolo] = useState("");
  const [obiettivo, setObiettivo] = useState("");
  const [esercizi, setEsercizi] = useState<BozzaEsercizio[]>([]);
  const [persone, setPersone] = useState<Set<string>>(new Set(preselezionate ?? []));
  const [editor, setEditor] = useState<{ indice: number | null; iniziale: BozzaEsercizio | null } | null>(null);
  const [salvataggio, setSalvataggio] = useState(false);

  const pronto = titolo.trim().length > 0 && esercizi.length > 0 && persone.size > 0;

  async function crea() {
    if (!pronto) return;
    setSalvataggio(true);
    try {
      const quante = await creaPianoPerPersone(Array.from(persone), { titolo: titolo.trim(), obiettivo: obiettivo.trim(), fondamentale_target: null, data_fine: null }, esercizi);
      onCreato(quante);
    } catch (e) {
      avvisa("Piano non creato", (e as Error).message);
    } finally {
      setSalvataggio(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.titolo}>Nuovo piano</Text>
      <TextInput style={styles.input} placeholder="Titolo (es. Battuta in salto)" placeholderTextColor={brand.colors.muted} value={titolo} onChangeText={setTitolo} />
      <TextInput style={styles.input} placeholder="Obiettivo, in una frase (facoltativo)" placeholderTextColor={brand.colors.muted} value={obiettivo} onChangeText={setObiettivo} />

      <Text style={styles.sezione}>Esercizi ({esercizi.length})</Text>
      {esercizi.length === 0 && <Text style={styles.nota}>Aggiungi almeno un esercizio: scegli dal catalogo o scrivilo tu.</Text>}
      {esercizi.map((e, i) => (
        <View key={i} style={styles.esercizio}>
          <View style={{ flex: 1 }}>
            <Text style={styles.nomeEsercizio}>{e.nome}</Text>
            <Text style={styles.nota}>{e.volte_a_settimana}× a settimana · {e.durata_minuti}′ · {QUANDO[e.quando]}</Text>
          </View>
          <Pressable onPress={() => setEditor({ indice: i, iniziale: e })} hitSlop={8}><Text style={styles.azione}>Modifica</Text></Pressable>
          <Pressable onPress={() => setEsercizi(esercizi.filter((_, k) => k !== i))} hitSlop={8}><Text style={styles.azioneDistruttiva}>Togli</Text></Pressable>
        </View>
      ))}
      <Pressable style={styles.bottoneSecondario} onPress={() => setEditor({ indice: null, iniziale: null })}>
        <Text style={styles.bottoneSecondarioTesto}>+ Aggiungi esercizio</Text>
      </Pressable>

      <Text style={styles.sezione}>A chi lo assegni ({persone.size})</Text>
      <SelettorePersone atlete={atlete} selezionate={persone} onChange={setPersone} />

      <Pressable style={[styles.bottone, !pronto && { opacity: 0.4 }]} onPress={crea} disabled={!pronto || salvataggio}>
        <Text style={styles.bottoneTesto}>{salvataggio ? "Creo i piani…" : `Crea il piano per ${persone.size} ${persone.size === 1 ? "persona" : "persone"}`}</Text>
      </Pressable>
      {onAnnulla && (
        <Pressable onPress={() => (esercizi.length > 0 || titolo.trim() ? confermaAzione("Annullare?", "Il piano non salvato andrà perso.", "Annulla il piano", onAnnulla, true) : onAnnulla())}>
          <Text style={styles.annulla}>Annulla</Text>
        </Pressable>
      )}

      <EditorEsercizio
        visibile={!!editor}
        teamId={teamId}
        titolo={editor?.indice === null ? "Nuovo esercizio" : "Modifica esercizio"}
        iniziale={editor?.iniziale ?? null}
        onChiudi={() => setEditor(null)}
        onSalva={(b) => {
          setEsercizi((prec) => (editor?.indice === null || editor?.indice === undefined ? [...prec, b] : prec.map((x, k) => (k === editor.indice ? b : x))));
          setEditor(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 10 },
  titolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  sezione: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "800", textTransform: "uppercase", marginTop: 4 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  nota: { color: brand.colors.muted, fontSize: 12 },
  esercizio: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  nomeEsercizio: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "600" },
  azione: { color: brand.colors.brand, fontSize: 13, fontWeight: "600" },
  azioneDistruttiva: { color: brand.colors.error, fontSize: 13, fontWeight: "600" },
  bottoneSecondario: { borderWidth: 1, borderColor: brand.colors.brand, borderRadius: 8, padding: 10, alignItems: "center" },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "600" },
  bottone: { backgroundColor: brand.colors.brand, padding: 12, borderRadius: 8, alignItems: "center", marginTop: 6 },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  annulla: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 4 },
});
