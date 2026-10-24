import { useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { brand } from "@/src/config";
import { avvisa } from "@/src/lib/confermaAzione";
import { impostaFormazioneIniziale } from "@/src/services/matches";
import type { Athlete } from "@/src/types/database";

interface Props {
  setId: string;
  numeroSet: number;
  /** Convocate che possono partire in campo (senza Libero). */
  atlete: Athlete[];
  precedente: { formazione: { athlete_id: string; posizione: number }[]; chi_ha_servito_per_primo: "noi" | "avversario" | null } | null;
  /** Risultato dei set gia' giocati, per ricordare dove si e' arrivati (es. "25-21 · 18-25"). */
  risultatiPrecedenti: string;
  haTurno: boolean;
  nomeTurno: string | null;
  onSubentra: () => void;
  onFatto: () => void;
}

// Disposizione sul campo visto dalla nostra parte: rete in alto, 4-3-2 davanti e 5-6-1 dietro.
const RIGHE: number[][] = [[4, 3, 2], [5, 6, 1]];

/**
 * Formazione di partenza di un set per lo scout ospite: si propone quella del set precedente,
 * si puo' correggere toccando una posizione e poi la giocatrice.
 */
export function FormazioneOspite({ setId, numeroSet, atlete, precedente, risultatiPrecedenti, haTurno, nomeTurno, onSubentra, onFatto }: Props) {
  const idUtilizzabili = new Set(atlete.map((a) => a.id));
  const iniziale: Record<number, string> = {};
  for (const r of precedente?.formazione ?? []) if (idUtilizzabili.has(r.athlete_id)) iniziale[r.posizione] = r.athlete_id;
  const [posizioni, setPosizioni] = useState<Record<number, string>>(Object.keys(iniziale).length === 6 ? iniziale : {});
  const [scelta, setScelta] = useState<number | null>(null);
  const [chiServe, setChiServe] = useState<"noi" | "avversario">(precedente?.chi_ha_servito_per_primo === "noi" ? "avversario" : "noi");
  const [inCorso, setInCorso] = useState(false);

  const usate = new Set(Object.values(posizioni));
  const libere = atlete.filter((a) => !usate.has(a.id));
  const completa = Object.keys(posizioni).length === 6;
  const nomeDi = (id?: string) => {
    const a = atlete.find((x) => x.id === id);
    return a ? `${a.numero_maglia != null ? `#${a.numero_maglia} ` : ""}${a.cognome}` : "—";
  };

  function assegna(athleteId: string) {
    if (scelta === null) { avvisa("Scegli prima la posizione", "Tocca una posizione sul campo e poi la giocatrice."); return; }
    setPosizioni((p) => ({ ...p, [scelta]: athleteId }));
    // Passa alla prossima posizione ancora vuota.
    const prossima = [1, 2, 3, 4, 5, 6].find((n) => n !== scelta && !posizioni[n]);
    setScelta(prossima ?? null);
  }

  async function inizia() {
    if (!completa || inCorso) return;
    setInCorso(true);
    try {
      await impostaFormazioneIniziale(setId, Object.fromEntries(Object.entries(posizioni).map(([p, a]) => [p, a])), chiServe);
      onFatto();
    } catch (e) {
      avvisa("Formazione non salvata", (e as Error).message);
    } finally {
      setInCorso(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.contenitore}>
      <Text style={styles.titolo}>Set {numeroSet}: formazione di partenza</Text>
      {!!risultatiPrecedenti && <Text style={styles.nota}>Set conclusi: {risultatiPrecedenti}. In attesa della nuova formazione.</Text>}
      {!haTurno && (
        <View style={styles.banner}>
          <Text style={styles.bannerTesto}>{nomeTurno ? `La formazione la sta inserendo ${nomeTurno}.` : "Nessuno sta registrando."}</Text>
          <Pressable style={styles.bottoneSecondario} onPress={onSubentra}>
            <Text style={styles.bottoneSecondarioTesto}>{nomeTurno ? "Subentra" : "Prendi il turno"}</Text>
          </Pressable>
        </View>
      )}
      <Text style={styles.nota}>
        {Object.keys(iniziale).length === 6 ? "Proposta la formazione di partenza del set precedente: correggila se serve." : "Tocca una posizione e poi la giocatrice."}
      </Text>

      <View style={styles.campo}>
        <Text style={styles.rete}>RETE</Text>
        {RIGHE.map((riga, i) => (
          <View key={i} style={styles.riga}>
            {riga.map((n) => (
              <Pressable key={n} disabled={!haTurno} onPress={() => setScelta(scelta === n ? null : n)} style={[styles.posizione, scelta === n && styles.posizioneScelta]}>
                <Text style={styles.numeroPosizione}>{n}</Text>
                <Text style={styles.nomePosizione} numberOfLines={1}>{nomeDi(posizioni[n])}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>

      <Text style={styles.sezione}>Chi serve per primo</Text>
      <View style={styles.rigaChip}>
        {(["noi", "avversario"] as const).map((c) => (
          <Pressable key={c} disabled={!haTurno} onPress={() => setChiServe(c)} style={[styles.chip, chiServe === c && styles.chipAttivo]}>
            <Text style={[styles.chipTesto, chiServe === c && styles.chipTestoAttivo]}>{c === "noi" ? "Noi" : "Loro"}</Text>
          </Pressable>
        ))}
      </View>

      {haTurno && libere.length > 0 && (
        <>
          <Text style={styles.sezione}>Giocatrici disponibili</Text>
          <View style={styles.rigaChip}>
            {libere.map((a) => (
              <Pressable key={a.id} onPress={() => assegna(a.id)} style={styles.chip}>
                <Text style={styles.chipTesto}>{a.numero_maglia != null ? `#${a.numero_maglia} ` : ""}{a.cognome}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      {haTurno && (
        <Pressable disabled={!completa || inCorso} onPress={inizia} style={[styles.bottone, (!completa || inCorso) && { opacity: 0.4 }]}>
          <Text style={styles.bottoneTesto}>{inCorso ? "Un attimo…" : completa ? `Inizia il set ${numeroSet}` : `Mancano ${6 - Object.keys(posizioni).length} posizioni`}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenitore: { padding: 16, gap: 12, alignItems: "stretch", maxWidth: 520, alignSelf: "center", width: "100%" },
  titolo: { color: brand.colors.onSurface, fontSize: 20, fontWeight: "700", textAlign: "center" },
  nota: { color: brand.colors.muted, fontSize: 12, textAlign: "center", lineHeight: 17 },
  banner: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, padding: 12, gap: 8, alignItems: "center" },
  bannerTesto: { color: brand.colors.onSurface, fontSize: 13, textAlign: "center" },
  campo: { backgroundColor: "#1a3a2a", borderRadius: 12, borderWidth: 2, borderColor: brand.colors.brand, padding: 8, gap: 8 },
  rete: { color: "#fff", fontSize: 10, fontWeight: "700", letterSpacing: 2, textAlign: "center", borderBottomWidth: 3, borderBottomColor: "#fff", paddingBottom: 2 },
  riga: { flexDirection: "row", gap: 8 },
  posizione: { flex: 1, minHeight: 64, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 10, alignItems: "center", justifyContent: "center", padding: 4, borderWidth: 2, borderColor: "transparent" },
  posizioneScelta: { borderColor: brand.colors.brand, backgroundColor: "rgba(255,255,255,0.25)" },
  numeroPosizione: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "700" },
  nomePosizione: { color: "#fff", fontSize: 13, fontWeight: "700" },
  sezione: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  rigaChip: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 14, borderRadius: 10, alignItems: "center", marginTop: 4 },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
  bottoneSecondario: { borderColor: brand.colors.brandSecondary, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10 },
  bottoneSecondarioTesto: { color: brand.colors.brandSecondary, fontWeight: "600", fontSize: 13 },
});
