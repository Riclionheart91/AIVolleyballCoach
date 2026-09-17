import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, TextInput } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  aggiungiEsercizioPiano, cambiaStatoPiano, creaPianoIndividuale, elencaEserciziPiano,
  elencaPianiIndividuali, eliminaPianoIndividuale, generaPianoIndividualeAI, impostaSvolgimentiSettimana, svolgimentiDellaSettimana,
  type EsercizioPiano, type PianoIndividuale,
} from "@/src/services/pianiIndividuali";
import { elencaEsercizi } from "@/src/services/exercises";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";

const ETICHETTE_QUANDO: Record<string, string> = {
  riscaldamento: "nel riscaldamento",
  tecnico: "nella parte tecnica",
  autonomo: "in autonomia",
};

/**
 * Piani individuali: programma personale costruito sulle carenze
 * rilevate dalle valutazioni. La spunta di svolgimento la mette anche
 * la persona interessata — è lei a sapere se l'ha fatto, e passare
 * dall'allenatore vanificherebbe il senso del lavoro autonomo.
 */
export function PianiIndividuali({ teamId, athleteId, nomePersona, ruolo, modificabile }: {
  teamId: string; athleteId: string; nomePersona: string; ruolo: string | null; modificabile: boolean;
}) {
  const [piani, setPiani] = useState<PianoIndividuale[]>([]);
  const [espanso, setEspanso] = useState<string | null>(null);
  const [esercizi, setEsercizi] = useState<EsercizioPiano[]>([]);
  const [svolgimentiSettimana, setSvolgimentiSettimana] = useState<Record<string, number>>({});
  const [caricamento, setCaricamento] = useState(true);
  const [generando, setGenerando] = useState(false);
  const [istruzioni, setIstruzioni] = useState("");
  const [mostraIstruzioni, setMostraIstruzioni] = useState(false);

  const carica = useCallback(async () => {
    setCaricamento(true);
    try { setPiani(await elencaPianiIndividuali(athleteId)); }
    catch (e) { avvisa("Errore", (e as Error).message); }
    finally { setCaricamento(false); }
  }, [athleteId]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function apri(pianoId: string) {
    if (espanso === pianoId) { setEspanso(null); return; }
    setEspanso(pianoId);
    try {
      setEsercizi(await elencaEserciziPiano(pianoId));
      setSvolgimentiSettimana(await svolgimentiDellaSettimana(pianoId));
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  async function onGenera() {
    setGenerando(true);
    try {
      const catalogo = await elencaEsercizi(teamId).catch(() => []);
      const r = await generaPianoIndividualeAI(teamId, athleteId, nomePersona, ruolo, catalogo, istruzioni);
      if (r.errore || !r.esercizi || r.esercizi.length === 0) {
        avvisa("Piano non creato", r.messaggio ?? "Nessuna proposta utilizzabile.");
        return;
      }
      const pianoId = await creaPianoIndividuale(athleteId, r.titolo ?? `Piano — ${nomePersona}`, r.obiettivo ?? "", null, null);
      for (let i = 0; i < r.esercizi.length; i++) {
        const e = r.esercizi[i];
        await aggiungiEsercizioPiano(pianoId, {
          nome_libero: e.nome,
          indicazioni: e.indicazioni,
          volte_a_settimana: e.volte_a_settimana,
          durata_minuti: e.durata_minuti,
          quando: e.quando as EsercizioPiano["quando"],
          ordine: i,
        });
      }
      setIstruzioni(""); setMostraIstruzioni(false);
      carica();
      avvisa("Piano creato", `${r.esercizi.length} esercizi, costruiti sulle carenze rilevate dalle valutazioni.`);
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setGenerando(false);
    }
  }

  async function commutaSvolto(pe: EsercizioPiano, indiceSeduta: number) {
    const fatteOra = svolgimentiSettimana[pe.id] ?? 0;
    // Toccare una spunta già verde toglie quella e le successive:
    // l'ordine delle sedute è progressivo.
    const nuoveFatte = fatteOra > indiceSeduta ? indiceSeduta : indiceSeduta + 1;
    setSvolgimentiSettimana((prec) => ({ ...prec, [pe.id]: nuoveFatte }));
    try { await impostaSvolgimentiSettimana(pe.id, nuoveFatte); carica(); }
    catch (e) { avvisa("Errore", (e as Error).message); carica(); }
  }

  if (caricamento) return <ActivityIndicator color={brand.colors.brand} style={{ marginTop: 16 }} />;

  return (
    <View style={{ gap: 10 }}>
      {piani.length === 0 && (
        <Text style={styles.nota}>
          Nessun piano individuale. Un piano raccoglie pochi esercizi mirati alle carenze rilevate, da fare nel riscaldamento o in autonomia.
        </Text>
      )}

      {piani.map((p) => {
        const percentuale = p.attesi_settimana > 0
          ? Math.min(100, Math.round((p.svolgimenti_settimana / p.attesi_settimana) * 100))
          : 0;
        return (
          <View key={p.id} style={[styles.card, p.stato !== "attivo" && styles.cardSpenta]}>
            <Pressable onPress={() => apri(p.id)}>
              <View style={styles.rigaTitolo}>
                <Text style={styles.titolo}>{p.titolo}</Text>
                <Text style={styles.percentuale}>{percentuale}%</Text>
              </View>
              {!!p.obiettivo && <Text style={styles.obiettivo}>{p.obiettivo}</Text>}
              <Text style={styles.dettaglio}>
                {p.numero_esercizi} esercizi · {p.svolgimenti_settimana}/{p.attesi_settimana} svolgimenti questa settimana
                {p.stato !== "attivo" ? ` · ${p.stato}` : ""}
              </Text>
              <View style={styles.barraSfondo}>
                <View style={[styles.barraRiempimento, { width: `${percentuale}%` }]} />
              </View>
            </Pressable>

            {espanso === p.id && (
              <View style={styles.dettaglioPiano}>
                {esercizi.map((pe) => (
                  <View key={pe.id} style={styles.rigaEsercizio}>
                    {/* Una spunta per ciascuna delle sedute settimanali
                        previste: con una sola non si distingueva la
                        prima seduta dalla seconda. */}
                    <View style={styles.colonnaSpunte}>
                      {Array.from({ length: pe.volte_a_settimana }).map((_, n) => {
                        const fatta = (svolgimentiSettimana[pe.id] ?? 0) > n;
                        return (
                          <Pressable
                            key={n}
                            onPress={() => commutaSvolto(pe, n)}
                            style={[styles.spunta, fatta && styles.spuntaAttiva]}
                          >
                            {fatta ? <Text style={styles.spuntaSegno}>✓</Text> : <Text style={styles.numeroSeduta}>{n + 1}</Text>}
                          </Pressable>
                        );
                      })}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nomeEsercizio}>{pe.nome_libero ?? "Esercizio"}</Text>
                      <Text style={styles.indicazioni}>{pe.indicazioni}</Text>
                      <Text style={styles.frequenza}>
                        {pe.volte_a_settimana}× a settimana · {pe.durata_minuti ?? 10}′ · {ETICHETTE_QUANDO[pe.quando]}
                      </Text>
                    </View>
                  </View>
                ))}
                <Text style={styles.nota}>Tocca i quadratini numerati per segnare le sedute svolte questa settimana.</Text>

                {modificabile && (
                  <View style={styles.rigaAzioni}>
                    <Pressable onPress={() => cambiaStatoPiano(p.id, p.stato === "attivo" ? "concluso" : "attivo").then(carica)}>
                      <Text style={styles.azione}>{p.stato === "attivo" ? "Concludi" : "Riattiva"}</Text>
                    </Pressable>
                    <Pressable onPress={() => confermaAzione("Eliminare il piano?", "Verranno persi anche gli svolgimenti registrati.", "Elimina", async () => {
                      await eliminaPianoIndividuale(p.id); setEspanso(null); carica();
                    }, true)}>
                      <Text style={styles.azioneDistruttiva}>Elimina</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}
          </View>
        );
      })}

      {modificabile && (
        <>
          {mostraIstruzioni && (
            <TextInput
              style={styles.input}
              multiline
              placeholder="Indicazioni particolari (facoltativo): es. rientra da infortunio alla spalla, ha poco tempo"
              placeholderTextColor={brand.colors.muted}
              value={istruzioni}
              onChangeText={setIstruzioni}
            />
          )}
          <View style={styles.rigaGenerazione}>
            <Pressable style={styles.bottoneNota} onPress={() => setMostraIstruzioni(!mostraIstruzioni)}>
              <Text style={styles.bottoneNotaTesto}>{mostraIstruzioni ? "−" : "+"}</Text>
            </Pressable>
            <Pressable style={styles.bottoneAI} onPress={onGenera} disabled={generando}>
              {generando
                ? <ActivityIndicator color={brand.colors.brandSecondary} />
                : <Text style={styles.bottoneAITesto}>✨ Crea piano</Text>}
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 6 },
  cardSpenta: { opacity: 0.6 },
  rigaTitolo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titolo: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700", flex: 1 },
  percentuale: { color: brand.colors.brand, fontSize: 16, fontWeight: "800" },
  obiettivo: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  dettaglio: { color: brand.colors.muted, fontSize: 11 },
  barraSfondo: { height: 6, backgroundColor: brand.colors.surfaceTertiary, borderRadius: 3, overflow: "hidden" },
  barraRiempimento: { height: "100%", backgroundColor: brand.colors.brand },
  dettaglioPiano: { gap: 10, marginTop: 8, borderTopWidth: 1, borderTopColor: brand.colors.border, paddingTop: 10 },
  rigaEsercizio: { flexDirection: "row", gap: 10, alignItems: "flex-start", minHeight: 48, paddingVertical: 4 },
  colonnaSpunte: { gap: 4 },
  numeroSeduta: { color: brand.colors.muted, fontSize: 11, fontWeight: "700" },
  spunta: { width: 30, height: 30, borderRadius: 6, borderWidth: 2, borderColor: brand.colors.brand, alignItems: "center", justifyContent: "center", marginTop: 2 },
  spuntaAttiva: { backgroundColor: brand.colors.brand },
  spuntaSegno: { color: "#000", fontWeight: "800", fontSize: 14 },
  nomeEsercizio: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "600" },
  indicazioni: { color: brand.colors.onSurfaceSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  frequenza: { color: brand.colors.brandSecondary, fontSize: 11, marginTop: 2 },
  rigaAzioni: { flexDirection: "row", justifyContent: "flex-end", gap: 16 },
  azione: { color: brand.colors.brand, fontSize: 13, fontWeight: "600" },
  azioneDistruttiva: { color: brand.colors.error, fontSize: 13, fontWeight: "600" },
  nota: { color: brand.colors.muted, fontSize: 12, lineHeight: 17 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10, minHeight: 56, textAlignVertical: "top" },
  rigaGenerazione: { flexDirection: "row", gap: 8 },
  bottoneAI: { flex: 1, borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  bottoneAITesto: { color: brand.colors.brandSecondary, fontWeight: "700" },
  bottoneNota: { width: 44, borderWidth: 1, borderColor: brand.colors.muted, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  bottoneNotaTesto: { color: brand.colors.muted, fontSize: 20, fontWeight: "700" },
});
