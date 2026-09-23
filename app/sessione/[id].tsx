import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaEsercizi } from "@/src/services/exercises";
import {
  avviaEsercizio,
  avviaSessione,
  concludiEsercizio,
  concludiSessione,
  elencaSessione,
  type VoceSessione,
} from "@/src/services/trainingPlan";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { brand, etichetteFase, fasiAllenamento } from "@/src/config";
import { supabaseClient } from "@/src/lib/supabase";
import type { Training } from "@/src/types/database";

function mmss(secondi: number): string {
  const m = Math.floor(secondi / 60);
  const s = secondi % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Esecuzione della seduta, pensata prima per lo smartphone: si usa in
 * piedi, con una mano, spesso con poca luce. Perciò l'esercizio in
 * corso occupa la parte alta con la DESCRIZIONE sempre leggibile (per
 * spiegarlo alla rosa senza uscire dalla schermata), il cronometro è
 * grande, e i comandi stanno in basso dove arriva il pollice.
 */
export default function SessioneAllenamento() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { team, puoScrivere } = useAuth();
  const [training, setTraining] = useState<Training | null>(null);
  const [voci, setVoci] = useState<VoceSessione[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [espansa, setEspansa] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const carica = useCallback(async () => {
    if (!id || !team) return;
    setCaricamento(true);
    try {
      const { data: t } = await supabaseClient.from("trainings").select("*").eq("id", id).single();
      setTraining(t ?? null);
      const catalogo = await elencaEsercizi(team.id);
      setVoci(await elencaSessione(id, catalogo));
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCaricamento(false);
    }
  }, [id, team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const inCorso = voci.find((v) => v.iniziato_il && !v.concluso_il);
  const sessioneAvviata = !!training?.iniziato_il && !training?.concluso_il;

  function secondi(v: VoceSessione): number {
    if (v.durata_effettiva_secondi != null) return v.durata_effettiva_secondi;
    if (!v.iniziato_il) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(v.iniziato_il).getTime()) / 1000));
  }

  const daFare = voci.filter((v) => !v.concluso_il && v.id !== inCorso?.id);
  const prossimo = daFare[0];
  const totalePianificato = voci.reduce((s, v) => s + (v.durata_minuti ?? 0), 0);
  const totaleEffettivo = Math.round(voci.reduce((s, v) => s + secondi(v), 0) / 60);

  async function azione(fn: () => Promise<void>) {
    try { await fn(); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  function onChiudiSessione() {
    if (!id) return;
    confermaAzione("Chiudere la sessione?", "L'esercizio in corso verrà fermato e i tempi salvati.", "Chiudi sessione", () => azione(() => concludiSessione(id)));
  }

  if (caricamento || !training) return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} /></View>;

  const secondiInCorso = inCorso ? secondi(inCorso) : 0;
  const pianificatoSec = (inCorso?.durata_minuti ?? 0) * 60;
  const oltre = pianificatoSec > 0 && secondiInCorso > pianificatoSec;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.tastoIndietro}>
          <Text style={styles.indietro}>←</Text>
        </Pressable>
        <Text style={styles.titoloHeader} numberOfLines={1}>{training.titolo}</Text>
        <Text style={styles.contatore}>{voci.filter((v) => v.concluso_il).length}/{voci.length}</Text>
      </View>

      {inCorso ? (
        <View style={styles.riquadroInCorso}>
          <Text style={styles.etichettaInCorso}>IN CORSO · {etichetteFase[inCorso.fase ?? "tecnico"] ?? ""}</Text>
          <Text style={styles.nomeInCorso}>{inCorso.nome}</Text>
          <Text style={[styles.cronometro, oltre && styles.cronometroOltre]}>{mmss(secondiInCorso)}</Text>
          <Text style={styles.sottoCronometro}>
            previsti {inCorso.durata_minuti ?? 0} min{oltre ? " · oltre il previsto" : ""}
          </Text>

          <ScrollView style={styles.areaDescrizione} contentContainerStyle={{ paddingBottom: 8 }}>
            <Text style={styles.descrizioneInCorso}>
              {inCorso.descrizione || "Nessuna descrizione per questo esercizio. Puoi aggiungerla dalla scheda dell'esercizio, così la ritrovi qui la prossima volta."}
            </Text>
            {!!inCorso.note && <Text style={styles.noteInCorso}>Note del piano: {inCorso.note}</Text>}
          </ScrollView>
        </View>
      ) : (
        <View style={styles.riquadroFermo}>
          <Text style={styles.testoFermo}>
            {!sessioneAvviata
              ? "Sessione non avviata."
              : daFare.length === 0
                ? "Tutti gli esercizi completati."
                : "Nessun esercizio in corso: avvia il prossimo dal pulsante in basso."}
          </Text>
          <Text style={styles.riepilogoFermo}>Pianificato {totalePianificato} min · svolto {totaleEffettivo} min</Text>
        </View>
      )}

      <Text style={styles.etichettaElenco}>Esercizi della seduta</Text>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}>
        {fasiAllenamento.map((f) => {
          const dellaFase = voci.filter((v) => (v.fase ?? "tecnico") === f.codice);
          if (dellaFase.length === 0) return null;
          const fattiFase = dellaFase.filter((v) => v.concluso_il).length;

          // Sottogruppo dentro la fase: es. Tecnico > Battuta, Tecnico >
          // Attacco, Situazionale > Globale. L'ordine dei sottogruppi
          // segue l'ordine di comparsa nel piano, non l'alfabeto.
          const sottogruppi: string[] = [];
          for (const v of dellaFase) {
            const cat = v.categoria || "Altro";
            if (!sottogruppi.includes(cat)) sottogruppi.push(cat);
          }

          return (
            <View key={f.codice}>
              <View style={styles.intestazioneFaseSessione}>
                <Text style={styles.titoloFaseSessione}>{f.etichetta}</Text>
                <Text style={styles.contatoreFase}>{fattiFase}/{dellaFase.length}</Text>
              </View>
              {sottogruppi.map((cat) => (
                <View key={cat}>
                  {sottogruppi.length > 1 && <Text style={styles.titoloSottogruppo}>{cat}</Text>}
                  {dellaFase.filter((v) => (v.categoria || "Altro") === cat).map((v) => {
                    const attivo = inCorso?.id === v.id;
                    const fatto = !!v.concluso_il;
                    const aperta = espansa === v.id;
                    return (
                      <View key={v.id} style={[styles.riga, attivo && styles.rigaAttiva, fatto && styles.rigaFatta]}>
                        <Pressable style={styles.rigaTesta} onPress={() => setEspansa(aperta ? null : v.id)}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rigaNome} numberOfLines={aperta ? undefined : 1}>{fatto ? "✓ " : ""}{v.nome}</Text>
                            <Text style={styles.rigaDettaglio}>
                              {v.ruolo_target ? `solo ${v.ruolo_target} · ` : ""}{v.durata_minuti ?? 0} min{(attivo || fatto) ? ` · reale ${mmss(secondi(v))}` : ""}
                              {v.descrizione ? (aperta ? "" : " · tocca per la descrizione") : ""}
                            </Text>
                          </View>
                          {puoScrivere && sessioneAvviata && !attivo && (
                            <Pressable style={styles.tastoRiga} onPress={() => azione(() => avviaEsercizio(v.id))} hitSlop={8}>
                              <Text style={styles.tastoRigaTesto}>{fatto ? "↻" : "▶"}</Text>
                            </Pressable>
                          )}
                        </Pressable>
                        {aperta && !!v.descrizione && <Text style={styles.rigaDescrizione}>{v.descrizione}</Text>}
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.rigaGlobale}>
        <Pressable style={styles.bottoneGlobale} onPress={() => router.push(`/globale/${id}`)}>
          <Text style={styles.bottoneGlobaleTesto}>🏐 Globale tracciato</Text>
        </Pressable>
      </View>


      {puoScrivere && (
        <View style={styles.barraComandi}>
          {!sessioneAvviata ? (
            <Pressable style={styles.tastoPrincipale} onPress={() => azione(() => avviaSessione(id!))}>
              <Text style={styles.tastoPrincipaleTesto}>{training.concluso_il ? "▶ RIAPRI" : "▶ INIZIA ALLENAMENTO"}</Text>
            </Pressable>
          ) : inCorso ? (
            <>
              <Pressable style={styles.tastoSecondarioGrande} onPress={() => azione(() => concludiEsercizio(inCorso.id))}>
                <Text style={styles.tastoSecondarioGrandeTesto}>■ Fine</Text>
              </Pressable>
              {prossimo && (
                <Pressable style={styles.tastoPrincipale} onPress={() => azione(() => avviaEsercizio(prossimo.id))}>
                  <Text style={styles.tastoPrincipaleTesto} numberOfLines={1}>▶ {prossimo.nome}</Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              {prossimo ? (
                <Pressable style={styles.tastoPrincipale} onPress={() => azione(() => avviaEsercizio(prossimo.id))}>
                  <Text style={styles.tastoPrincipaleTesto} numberOfLines={1}>▶ {prossimo.nome}</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.tastoSecondarioGrande} onPress={onChiudiSessione}>
                  <Text style={styles.tastoSecondarioGrandeTesto}>■ Chiudi sessione</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      )}

      {puoScrivere && sessioneAvviata && (inCorso || prossimo) && (
        <Pressable onPress={onChiudiSessione} style={styles.linkChiudi}>
          <Text style={styles.linkChiudiTesto}>Chiudi sessione</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  // Area di tocco generosa: si usa in piedi, spesso di fretta.
  tastoIndietro: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  indietro: { color: brand.colors.brand, fontSize: 24, fontWeight: "700" },
  titoloHeader: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700", flex: 1 },
  contatore: { color: brand.colors.muted, fontSize: 13, fontWeight: "700" },

  riquadroInCorso: { backgroundColor: brand.colors.surfaceSecondary, margin: 12, borderRadius: 16, padding: 16, borderWidth: 2, borderColor: brand.colors.brand, maxHeight: "46%" },
  etichettaInCorso: { color: brand.colors.brand, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  nomeInCorso: { color: brand.colors.onSurface, fontSize: 20, fontWeight: "800", marginTop: 2 },
  cronometro: { color: brand.colors.onSurface, fontSize: 44, fontWeight: "800", marginTop: 4 },
  cronometroOltre: { color: brand.colors.warning },
  sottoCronometro: { color: brand.colors.muted, fontSize: 12 },
  areaDescrizione: { marginTop: 10 },
  descrizioneInCorso: { color: brand.colors.onSurface, fontSize: 16, lineHeight: 24 },
  noteInCorso: { color: brand.colors.brandSecondary, fontSize: 13, marginTop: 8 },

  riquadroFermo: { backgroundColor: brand.colors.surfaceSecondary, margin: 12, borderRadius: 16, padding: 20, alignItems: "center", gap: 6 },
  testoFermo: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "600", textAlign: "center" },
  riepilogoFermo: { color: brand.colors.muted, fontSize: 13 },

  intestazioneFaseSessione: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 10, paddingBottom: 4 },
  titoloFaseSessione: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  titoloSottogruppo: { color: brand.colors.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", paddingTop: 6, paddingBottom: 2, paddingLeft: 4 },
  rigaGlobale: { paddingHorizontal: 12, paddingBottom: 10 },
  bottoneGlobale: { borderWidth: 1, borderColor: brand.colors.brandSecondary, paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  bottoneGlobaleTesto: { color: brand.colors.brandSecondary, fontWeight: "700" },
  contatoreFase: { color: brand.colors.muted, fontSize: 11, fontWeight: "700" },
  etichettaElenco: { color: brand.colors.muted, fontSize: 11, textTransform: "uppercase", paddingHorizontal: 16, paddingBottom: 4 },
  riga: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, marginBottom: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: "transparent" },
  rigaAttiva: { borderColor: brand.colors.brand },
  rigaFatta: { opacity: 0.55 },
  rigaTesta: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, minHeight: 56 },
  rigaNome: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "600" },
  rigaDettaglio: { color: brand.colors.muted, fontSize: 12, marginTop: 2 },
  rigaDescrizione: { color: brand.colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21, paddingBottom: 12 },
  tastoRiga: { width: 44, height: 44, borderRadius: 22, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  tastoRigaTesto: { color: brand.colors.brand, fontSize: 18, fontWeight: "800" },

  barraComandi: { flexDirection: "row", gap: 10, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: brand.colors.border },
  tastoPrincipale: { flex: 2, backgroundColor: brand.colors.success, paddingVertical: 18, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tastoPrincipaleTesto: { color: "#000", fontWeight: "800", fontSize: 16 },
  tastoSecondarioGrande: { flex: 1, backgroundColor: brand.colors.error, paddingVertical: 18, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tastoSecondarioGrandeTesto: { color: "#fff", fontWeight: "800", fontSize: 16 },
  linkChiudi: { alignItems: "center", paddingVertical: 10 },
  linkChiudiTesto: { color: brand.colors.muted, fontSize: 12 },
});
