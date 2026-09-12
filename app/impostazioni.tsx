import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert, Switch } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { impostaLinkSporteasy, leggiIntegrazione } from "@/src/services/sporteasy";
import { elencaProvider, salvaProvider, type AiProviderConfig } from "@/src/services/aiProviders";
import { DEFAULT_CAMPIONATO, creaCampionato, disattivaCampionato, elencaCampionati } from "@/src/services/championships";
import { brand } from "@/src/config";
import type { Campionato } from "@/src/types/database";

const PROVIDER_CODICI = ["GEMINI", "GROQ", "OPENROUTER"] as const;

export default function Impostazioni() {
  const { team, puoScrivere, isSuperuser } = useAuth();
  const [linkSporteasy, setLinkSporteasy] = useState("");
  const [providerSquadra, setProviderSquadra] = useState<AiProviderConfig[]>([]);
  const [providerGlobali, setProviderGlobali] = useState<AiProviderConfig[]>([]);
  const [campionati, setCampionati] = useState<Campionato[]>([]);
  const [nuovoCampionatoNome, setNuovoCampionatoNome] = useState("");
  const [nuovoCampionatoFederazione, setNuovoCampionatoFederazione] = useState<Campionato["federazione"]>("FIPAV");

  const carica = useCallback(async () => {
    if (!team) return;
    const integ = await leggiIntegrazione(team.id).catch(() => null);
    if (integ?.sporteasy_ical_url) setLinkSporteasy(integ.sporteasy_ical_url);
    if (puoScrivere) setProviderSquadra(await elencaProvider(team.id).catch(() => []));
    if (isSuperuser) setProviderGlobali(await elencaProvider(null).catch(() => []));
    if (puoScrivere) setCampionati(await elencaCampionati(team.id).catch(() => []));
  }, [team, puoScrivere, isSuperuser]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function aggiungiCampionato() {
    if (!team || !nuovoCampionatoNome.trim()) return;
    try {
      await creaCampionato(team.id, { ...DEFAULT_CAMPIONATO, nome: nuovoCampionatoNome.trim(), federazione: nuovoCampionatoFederazione });
      setNuovoCampionatoNome("");
      carica();
    } catch (e) { Alert.alert("Errore", (e as Error).message); }
  }

  async function rimuoviCampionato(id: string) {
    try { await disattivaCampionato(id); carica(); } catch (e) { Alert.alert("Errore", (e as Error).message); }
  }

  async function salvaSporteasy() {
    if (!team || !linkSporteasy.trim()) return;
    try {
      await impostaLinkSporteasy(team.id, linkSporteasy.trim());
      Alert.alert("Salvato", "Link calendario aggiornato.");
    } catch (e) { Alert.alert("Errore", (e as Error).message); }
  }

  function rigaProvider(config: AiProviderConfig | undefined, codice: (typeof PROVIDER_CODICI)[number], teamId: string | null, lista: AiProviderConfig[], setLista: (l: AiProviderConfig[]) => void) {
    const attuale: AiProviderConfig = config ?? { id: "", team_id: teamId, provider_code: codice, enabled: true, priority: PROVIDER_CODICI.indexOf(codice) + 1, modello: null };

    async function aggiorna(patch: Partial<AiProviderConfig>) {
      const nuovo = { ...attuale, ...patch };
      try {
        await salvaProvider({ team_id: teamId, provider_code: codice, enabled: nuovo.enabled, priority: nuovo.priority, modello: nuovo.modello });
        setLista(lista.some((p) => p.provider_code === codice) ? lista.map((p) => (p.provider_code === codice ? { ...p, ...patch } : p)) : [...lista, nuovo]);
      } catch (e) { Alert.alert("Errore", (e as Error).message); }
    }

    return (
      <View key={codice} style={styles.rigaProvider}>
        <Text style={styles.rigaProviderNome}>{codice}</Text>
        <Switch value={attuale.enabled} onValueChange={(v) => aggiorna({ enabled: v })} trackColor={{ true: brand.colors.brand }} />
        <TextInput
          style={styles.inputPriorita}
          keyboardType="numeric"
          value={String(attuale.priority)}
          onChangeText={(t) => aggiorna({ priority: Number(t) || attuale.priority })}
        />
        <TextInput
          style={styles.inputModello}
          placeholder="modello (opzionale)"
          placeholderTextColor={brand.colors.muted}
          value={attuale.modello ?? ""}
          onChangeText={(t) => aggiorna({ modello: t || null })}
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 20 }}>
      <View style={styles.card}>
        <Text style={styles.sezioneTitolo}>Integrazione SportEasy</Text>
        <Text style={styles.nota}>Link calendario iCal della squadra (SportEasy → Impostazioni squadra → Esporta calendario). La sincronizzazione vera e propria si lancia dalla tab Partite.</Text>
        <TextInput style={styles.input} placeholder="webcal://calendar.sporteasy.net/..." placeholderTextColor={brand.colors.muted} autoCapitalize="none" value={linkSporteasy} onChangeText={setLinkSporteasy} editable={puoScrivere} />
        {puoScrivere && (
          <Pressable style={styles.bottone} onPress={salvaSporteasy}><Text style={styles.bottoneTesto}>Salva link</Text></Pressable>
        )}
      </View>

      {puoScrivere && (
        <Pressable style={styles.card} onPress={() => router.push("/pianificazione-annuale")}>
          <Text style={styles.sezioneTitolo}>Pianificazione annuale (gestione cicli) →</Text>
          <Text style={styles.nota}>Periodizzazione della stagione (macrocicli/mesocicli/microcicli), generabile con AI e aggiornabile nel tempo in base alle valutazioni delle atlete.</Text>
        </Pressable>
      )}

      {puoScrivere && (
        <View style={styles.card}>
          <Text style={styles.sezioneTitolo}>Campionati</Text>
          <Text style={styles.nota}>Una squadra può giocare più campionati/federazioni insieme (es. FIPAV e CSI): ogni partita sceglie il proprio quando la crei nella tab Partite. Regole di base precompilate (25 punti/set, 15 al 5°, 6 sostituzioni, 2 Libero) — modificabili dopo la creazione se servisse.</Text>
          {campionati.map((c) => (
            <View key={c.id} style={styles.rigaCampionato}>
              <Text style={styles.rigaCampionatoTesto}>{c.nome} ({c.federazione}) — distinta {c.distinta_min_giocatrici}-{c.distinta_max_giocatrici}</Text>
              <Pressable onPress={() => rimuoviCampionato(c.id)}><Text style={styles.rimuoviCampionato}>Rimuovi</Text></Pressable>
            </View>
          ))}
          <View style={styles.rigaProvider}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="Nome campionato (es. Serie C 2026/27)" placeholderTextColor={brand.colors.muted} value={nuovoCampionatoNome} onChangeText={setNuovoCampionatoNome} />
          </View>
          <View style={styles.selettoreFederazione}>
            {(["FIPAV", "PGS", "CSI", "ALTRO"] as const).map((f) => (
              <Pressable key={f} onPress={() => setNuovoCampionatoFederazione(f)} style={[styles.chipFederazione, nuovoCampionatoFederazione === f && styles.chipFederazioneAttivo]}>
                <Text style={[styles.chipFederazioneTesto, nuovoCampionatoFederazione === f && styles.chipFederazioneTestoAttivo]}>{f}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.bottone} onPress={aggiungiCampionato} disabled={!nuovoCampionatoNome.trim()}>
            <Text style={styles.bottoneTesto}>Aggiungi campionato</Text>
          </Pressable>
        </View>
      )}

      {puoScrivere && (
        <View style={styles.card}>
          <Text style={styles.sezioneTitolo}>Provider AI — questa squadra</Text>
          <Text style={styles.nota}>Priorità più bassa = provato per primo. Lascia il modello vuoto per usare il default. Queste righe sovrascrivono, per la tua squadra, i default globali sotto (se presenti).</Text>
          {PROVIDER_CODICI.map((c) => rigaProvider(providerSquadra.find((p) => p.provider_code === c), c, team!.id, providerSquadra, setProviderSquadra))}
        </View>
      )}

      {isSuperuser && (
        <View style={styles.card}>
          <Text style={styles.sezioneTitolo}>Provider AI — default globali (superuser)</Text>
          <Text style={styles.nota}>Si applicano a tutte le squadre che non hanno impostato un proprio override sopra.</Text>
          {PROVIDER_CODICI.map((c) => rigaProvider(providerGlobali.find((p) => p.provider_code === c), c, null, providerGlobali, setProviderGlobali))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 10 },
  sezioneTitolo: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  nota: { color: brand.colors.muted, fontSize: 12 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  bottone: { backgroundColor: brand.colors.brand, padding: 10, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  rigaProvider: { flexDirection: "row", alignItems: "center", gap: 8 },
  rigaProviderNome: { color: brand.colors.onSurface, fontWeight: "600", width: 90 },
  inputPriorita: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 6, padding: 6, width: 40, textAlign: "center" },
  inputModello: { flex: 1, backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 6, padding: 6, fontSize: 12 },
  rigaCampionato: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaCampionatoTesto: { color: brand.colors.onSurface, fontSize: 13, flex: 1 },
  rimuoviCampionato: { color: brand.colors.error, fontSize: 12, fontWeight: "600" },
  selettoreFederazione: { flexDirection: "row", gap: 6 },
  chipFederazione: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 14, backgroundColor: brand.colors.surfaceTertiary },
  chipFederazioneAttivo: { backgroundColor: brand.colors.brand },
  chipFederazioneTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  chipFederazioneTestoAttivo: { color: "#000", fontWeight: "700" },
});
