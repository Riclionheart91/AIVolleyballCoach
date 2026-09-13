import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import {
  accettaPropostaPiano,
  aggiornaPianoAnnuale,
  creaPianoAnnuale,
  creaPropostaAggiornamento,
  elencaPropostePendentiPiano,
  generaPianoAnnualeAI,
  leggiPianoAnnuale,
  rifiutaPropostaPiano,
  serveProporreAggiornamento,
} from "@/src/services/pianoAnnuale";
import { elencaAtlete } from "@/src/services/athletes";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import type { PianoAnnuale, PropostaAggiornamentoPiano } from "@/src/types/database";

/**
 * "Gestione dei cicli": pianificazione annuale (periodizzazione)
 * generabile via AI, sempre modificabile a mano, con proposte di
 * aggiornamento quando conviene rivederla (30+ giorni dall'ultima
 * proposta, o nuove valutazioni disponibili) — controllato quando si
 * apre questa schermata, non con un vero cron in background (vedi
 * nota nella migrazione 0012).
 */
export default function PianificazioneAnnuale() {
  const { team, stagioneAttiva } = useAuth();
  const [piano, setPiano] = useState<PianoAnnuale | null>(null);
  const [titolo, setTitolo] = useState("Piano annuale");
  const [contenuto, setContenuto] = useState("");
  const [proposte, setProposte] = useState<PropostaAggiornamentoPiano[]>([]);
  const [suggerisciAggiornamento, setSuggerisciAggiornamento] = useState(false);
  const [caricamento, setCaricamento] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [percentuale, setPercentuale] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [inModifica, setInModifica] = useState(false);

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      const p = await leggiPianoAnnuale(team.id, stagioneAttiva?.id ?? null);
      setPiano(p);
      if (p) {
        setTitolo(p.titolo);
        setContenuto(p.contenuto);
        setProposte(await elencaPropostePendentiPiano(p.id));
        setSuggerisciAggiornamento(await serveProporreAggiornamento(p, team.id));
      }
    } finally {
      setCaricamento(false);
    }
  }, [team, stagioneAttiva]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function costruisciContestoSquadra(): Promise<string> {
    if (!team) return "";
    const atlete = await elencaAtlete(team.id);
    const perRuolo = atlete.reduce<Record<string, number>>((acc, a) => {
      const r = a.ruolo_campo ?? "senza ruolo assegnato";
      acc[r] = (acc[r] ?? 0) + 1;
      return acc;
    }, {});
    const composizione = Object.entries(perRuolo).map(([r, n]) => `${n} ${r}`).join(", ");
    return `Squadra di ${atlete.length} atlete (${composizione}). Stagione: ${stagioneAttiva?.nome ?? "non specificata"}.`;
  }

  async function onGenera() {
    if (!team) return;
    setGenerando(true);
    setPercentuale(5);
    const intervallo = setInterval(() => setPercentuale((p) => (p < 90 ? p + Math.max(1, Math.round((90 - p) * 0.15)) : p)), 400);
    try {
      const contesto = await costruisciContestoSquadra();
      const r = await generaPianoAnnualeAI(team.id, contesto, piano?.contenuto);
      if (r.errore || !r.contenuto) { avvisa("Generazione non riuscita", r.messaggio ?? "Errore sconosciuto"); return; }
      setPercentuale(100);

      if (!piano) {
        const nuovo = await creaPianoAnnuale(team.id, stagioneAttiva?.id ?? null, titolo, r.contenuto, true);
        setPiano(nuovo);
        setContenuto(r.contenuto);
      } else {
        await creaPropostaAggiornamento(piano.id, r.contenuto, "Generata su richiesta");
        avvisa("Proposta generata", "Trovi la proposta di aggiornamento qui sotto: puoi accettarla o rifiutarla.");
        carica();
      }
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      clearInterval(intervallo);
      setGenerando(false);
      setTimeout(() => setPercentuale(0), 600);
    }
  }

  async function onSalva() {
    if (!team) return;
    setSalvando(true);
    try {
      if (piano) {
        await aggiornaPianoAnnuale(piano.id, titolo, contenuto);
      } else {
        const nuovo = await creaPianoAnnuale(team.id, stagioneAttiva?.id ?? null, titolo, contenuto, false);
        setPiano(nuovo);
      }
      setInModifica(false);
      carica();
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function onAccettaProposta(p: PropostaAggiornamentoPiano) {
    confermaAzione("Applicare questo aggiornamento?", "Il contenuto attuale del piano verrà sostituito con questa proposta.", "Applica", async () => {
      try {
        await accettaPropostaPiano(p.id);
        carica();
      } catch (e) { avvisa("Errore", (e as Error).message); }
    });
  }

  async function onRifiutaProposta(p: PropostaAggiornamentoPiano) {
    try {
      await rifiutaPropostaPiano(p.id);
      carica();
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  if (caricamento) return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← Impostazioni</Text></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {suggerisciAggiornamento && piano && (
          <View style={styles.bannerSuggerimento}>
            <Text style={styles.bannerSuggerimentoTesto}>
              È passato un po' dall'ultimo controllo (30+ giorni) o ci sono valutazioni nuove: potrebbe convenire generare una proposta di aggiornamento del piano.
            </Text>
          </View>
        )}

        <View style={styles.rigaGenerazione}>
          <Pressable style={styles.bottoneAI} onPress={onGenera} disabled={generando}>
            {generando ? <Text style={styles.bottoneAITesto}>{percentuale}%</Text> : <Text style={styles.bottoneAITesto}>✨ {piano ? "Genera proposta di aggiornamento" : "Genera con AI"}</Text>}
          </Pressable>
        </View>
        {generando && (
          <View style={styles.barraSfondo}><View style={[styles.barraRiempimento, { width: `${percentuale}%` }]} /></View>
        )}
        <Text style={styles.nota}>La proposta usa la composizione attuale della rosa e (se presente) il piano già in uso — resta sempre da confermare prima di sostituire quello attuale.</Text>

        {proposte.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sottotitolo}>Proposte in attesa</Text>
            {proposte.map((p) => (
              <View key={p.id} style={styles.proposta}>
                <Text style={styles.propostaMotivo}>{p.motivo} — {new Date(p.creato_il).toLocaleDateString("it-IT")}</Text>
                <Text style={styles.propostaContenuto} numberOfLines={6}>{p.contenuto_proposto}</Text>
                <View style={styles.propostaAzioni}>
                  <Pressable onPress={() => onRifiutaProposta(p)}><Text style={styles.linkRifiuta}>Rifiuta</Text></Pressable>
                  <Pressable style={styles.bottoneAccetta} onPress={() => onAccettaProposta(p)}><Text style={styles.bottoneAccettaTesto}>Applica</Text></Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.sottotitolo}>{piano ? "Piano attuale" : "Nessun piano ancora"}</Text>
            {piano && !inModifica && <Pressable onPress={() => setInModifica(true)}><Text style={styles.linkModifica}>Modifica</Text></Pressable>}
          </View>

          {inModifica || !piano ? (
            <>
              <TextInput style={styles.input} placeholder="Titolo" placeholderTextColor={brand.colors.muted} value={titolo} onChangeText={setTitolo} />
              <TextInput style={[styles.input, { minHeight: 220, textAlignVertical: "top" }]} multiline placeholder="Descrivi qui i macrocicli/mesocicli/microcicli della stagione, oppure genera con AI qui sopra." placeholderTextColor={brand.colors.muted} value={contenuto} onChangeText={setContenuto} />
              <Pressable style={styles.bottone} onPress={onSalva} disabled={salvando || !contenuto.trim()}>
                {salvando ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Salva</Text>}
              </Pressable>
            </>
          ) : (
            <Text style={styles.contenutoTesto}>{piano.contenuto}</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  bannerSuggerimento: { backgroundColor: brand.colors.surfaceSecondary, borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 10, padding: 12 },
  bannerSuggerimentoTesto: { color: brand.colors.onSurface, fontSize: 13 },
  rigaGenerazione: { flexDirection: "row" },
  bottoneAI: { flex: 1, borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  bottoneAITesto: { color: brand.colors.brandSecondary, fontWeight: "700" },
  barraSfondo: { height: 4, backgroundColor: brand.colors.surfaceTertiary, borderRadius: 2, overflow: "hidden" },
  barraRiempimento: { height: "100%", backgroundColor: brand.colors.brandSecondary },
  nota: { color: brand.colors.muted, fontSize: 12 },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 10 },
  sottotitolo: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  linkModifica: { color: brand.colors.brand, fontWeight: "600", fontSize: 13 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  bottone: { backgroundColor: brand.colors.brand, padding: 12, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  contenutoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  proposta: { borderTopWidth: 1, borderTopColor: brand.colors.border, paddingTop: 10, gap: 6 },
  propostaMotivo: { color: brand.colors.muted, fontSize: 11 },
  propostaContenuto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  propostaAzioni: { flexDirection: "row", justifyContent: "flex-end", gap: 16, alignItems: "center" },
  linkRifiuta: { color: brand.colors.error, fontSize: 13, fontWeight: "600" },
  bottoneAccetta: { backgroundColor: brand.colors.success, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8 },
  bottoneAccettaTesto: { color: "#000", fontWeight: "700", fontSize: 13 },
});
