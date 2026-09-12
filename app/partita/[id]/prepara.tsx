import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator, Modal, FlatList } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaAtlete } from "@/src/services/athletes";
import {
  avviaMatchConfermato,
  avviaPreparazioneMatch,
  chiServeDefaultNuovoSet,
  chiudiMatch,
  elencaConvocati,
  elencaFormazioneConPosizioni,
  impostaConvocati,
  impostaFormazioneIniziale,
} from "@/src/services/matches";
import { confermaAzione } from "@/src/lib/confermaAzione";
import { Campo9x9, type OccupanteCampo } from "@/src/components/Campo9x9";
import { brand } from "@/src/config";
import { supabaseClient } from "@/src/lib/supabase";
import type { Athlete, Match } from "@/src/types/database";

export default function PreparaPartita() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { team } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const [setId, setSetId] = useState<string | null>(null);
  const [numeroSet, setNumeroSet] = useState(1);
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [convocateIds, setConvocateIds] = useState<Set<string>>(new Set());
  const [liberoIds, setLiberoIds] = useState<Set<string>>(new Set());
  const [posizioni, setPosizioni] = useState<Record<number, string>>({});
  const [posizioneInModifica, setPosizioneInModifica] = useState<number | null>(null);
  const [chiServe, setChiServe] = useState<"noi" | "avversario">("noi");
  const [chiServeRichiesto, setChiServeRichiesto] = useState(true); // false = auto-dedotto, non richiesto (set 2-4)
  const [mostraFormazione, setMostraFormazione] = useState(false); // "pulsante dedicato": la formazione si apre solo dopo averlo premuto
  const [caricamento, setCaricamento] = useState(true);
  const [salvandoConvocati, setSalvandoConvocati] = useState(false);
  const [avviando, setAvviando] = useState(false);

  const carica = useCallback(async () => {
    if (!id || !team) return;
    setCaricamento(true);
    try {
      const { data: m } = await supabaseClient.from("matches").select("*").eq("id", id).single();
      setMatch(m ?? null);

      const nuovoSetId = await avviaPreparazioneMatch(id);
      setSetId(nuovoSetId);
      const { data: setRow } = await supabaseClient.from("match_sets").select("numero_set").eq("id", nuovoSetId).single();
      const numero = setRow?.numero_set ?? 1;
      setNumeroSet(numero);

      const [listaAtlete, convocati, formazioneAttuale] = await Promise.all([
        elencaAtlete(team.id),
        elencaConvocati(id),
        elencaFormazioneConPosizioni(nuovoSetId),
      ]);
      listaAtlete.sort((a, b) => (a.numero_maglia ?? 999) - (b.numero_maglia ?? 999));
      setAtlete(listaAtlete);
      setConvocateIds(new Set(convocati.map((c) => c.athlete_id)));
      setLiberoIds(new Set(convocati.filter((c) => c.is_libero).map((c) => c.athlete_id)));

      const posizioniIniziali: Record<number, string> = {};
      for (const riga of formazioneAttuale) if (riga.posizione) posizioniIniziali[riga.posizione] = riga.athlete_id;
      setPosizioni(posizioniIniziali);
      if (Object.keys(posizioniIniziali).length > 0) setMostraFormazione(true);

      // Chi serve: richiesto solo al 1° e al 5° set (per regolamento).
      // Negli altri, si alterna in automatico rispetto al set
      // precedente — non richiesto, mostrato solo come informazione.
      const defaultServizio = await chiServeDefaultNuovoSet(id, numero);
      if (defaultServizio) {
        setChiServe(defaultServizio);
        setChiServeRichiesto(false);
      } else {
        setChiServeRichiesto(true);
      }

      // I convocati si chiedono UNA SOLA VOLTA, all'avvio della partita
      // (set 1): dal secondo set in poi sono già fissati per l'intera
      // gara, si salta direttamente alla formazione.
      if (numero > 1 && convocati.length > 0) setMostraFormazione(true);
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    } finally {
      setCaricamento(false);
    }
  }, [id, team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  function toggleConvocata(athleteId: string) {
    setConvocateIds((prev) => {
      const nuovo = new Set(prev);
      if (nuovo.has(athleteId)) { nuovo.delete(athleteId); setLiberoIds((l) => { const n = new Set(l); n.delete(athleteId); return n; }); }
      else nuovo.add(athleteId);
      return nuovo;
    });
  }

  function toggleLibero(athleteId: string) {
    if (!convocateIds.has(athleteId)) return;
    setLiberoIds((prev) => {
      const nuovo = new Set(prev);
      if (nuovo.has(athleteId)) nuovo.delete(athleteId);
      else nuovo.add(athleteId);
      return nuovo;
    });
  }

  async function salvaConvocati() {
    if (!id) return;
    setSalvandoConvocati(true);
    try {
      await impostaConvocati(id, Array.from(convocateIds), Array.from(liberoIds));
      Alert.alert("Salvato", "Convocati aggiornati.");
    } catch (e) {
      Alert.alert("Errore convocati", (e as Error).message);
    } finally {
      setSalvandoConvocati(false);
    }
  }

  const atleteConvocate = atlete.filter((a) => convocateIds.has(a.id));
  // Esclude dal selettore le convocate già posizionate in UN'ALTRA
  // casella — richiesto esplicitamente: non deve essere possibile
  // selezionarle due volte, nemmeno per errore.
  const atleteDisponibiliPerPosizione = atleteConvocate.filter(
    (a) => !Object.entries(posizioni).some(([pos, athleteId]) => athleteId === a.id && Number(pos) !== posizioneInModifica),
  );

  const occupantiCampo: OccupanteCampo[] = Object.entries(posizioni).map(([pos, athleteId]) => {
    const a = atlete.find((x) => x.id === athleteId);
    return { posizione: Number(pos), cognome: a?.cognome ?? "?", numeroMaglia: a?.numero_maglia ?? null, ruolo: a?.ruolo_campo ?? null };
  });

  function assegnaPosizione(athleteId: string) {
    if (posizioneInModifica === null) return;
    setPosizioni((prev) => {
      const nuovo = { ...prev };
      for (const p of Object.keys(nuovo)) if (nuovo[Number(p)] === athleteId) delete nuovo[Number(p)];
      nuovo[posizioneInModifica] = athleteId;
      return nuovo;
    });
    setPosizioneInModifica(null);
  }

  /** Pulsante per singola casella: rimuove solo quella giocatrice, lasciando le altre posizioni intatte. */
  function rimuoviPosizione(pos: number) {
    setPosizioni((prev) => {
      const nuovo = { ...prev };
      delete nuovo[pos];
      return nuovo;
    });
  }

  /** Pulsante sopra lo schema: ripulisce l'intera formazione in un colpo solo. */
  function svuotaFormazione() {
    confermaAzione("Svuotare la formazione?", "Tutte le posizioni verranno rimosse.", "Svuota", () => setPosizioni({}), true);
  }

  /** Pulsante sopra lo schema: ruota l'intero schieramento di una posizione (stessa direzione oraria della rotazione automatica: 2→1, 1→6, 6→5, 5→4, 4→3, 3→2). Utile per impostare rapidamente formazioni "a scalare" senza riassegnare ogni casella a mano. */
  function ruotaFormazioneDiUnaPosizione() {
    setPosizioni((prev) => {
      const nuovo: Record<number, string> = {};
      if (prev[2]) nuovo[1] = prev[2];
      if (prev[1]) nuovo[6] = prev[1];
      if (prev[6]) nuovo[5] = prev[6];
      if (prev[5]) nuovo[4] = prev[5];
      if (prev[4]) nuovo[3] = prev[4];
      if (prev[3]) nuovo[2] = prev[3];
      return nuovo;
    });
  }

  const formazioneCompleta = Object.keys(posizioni).length === 6;

  async function salvaFormazione(): Promise<boolean> {
    if (!setId || !formazioneCompleta) return false;
    try {
      const payload = Object.fromEntries(Object.entries(posizioni).map(([p, a]) => [p, a]));
      await impostaFormazioneIniziale(setId, payload, chiServe);
      return true;
    } catch (e) {
      Alert.alert("Errore formazione", (e as Error).message);
      return false;
    }
  }

  async function onAvvia() {
    if (!id) return;
    setAvviando(true);
    try {
      const ok = await salvaFormazione();
      if (!ok) return;
      await avviaMatchConfermato(id);
      router.replace(`/partita/${id}`);
    } catch (e) {
      Alert.alert("Impossibile avviare", (e as Error).message);
    } finally {
      setAvviando(false);
    }
  }

  function onAnnullaChiudiPartita() {
    // Al primo set la partita non è mai iniziata: si può eliminare del
    // tutto. Dal secondo in poi ci sono già set giocati: eliminarla
    // cancellerebbe anche quelli, quindi la si CHIUDE soltanto,
    // conservando lo storico.
    if (numeroSet > 1) {
      confermaAzione("Chiudere la partita?", "I set già giocati restano registrati. Non sarà più possibile aggiungere eventi.", "Chiudi partita", async () => {
        try {
          await chiudiMatch(id!);
          router.replace("/(tabs)/partite");
        } catch (e) { Alert.alert("Errore", (e as Error).message); }
      }, true);
      return;
    }

    confermaAzione("Annullare e chiudere la partita?", "La partita verrà eliminata senza essere mai iniziata.", "Elimina partita", async () => {
      try {
        await supabaseClient.from("matches").delete().eq("id", id);
        router.replace("/(tabs)/partite");
      } catch (e) { Alert.alert("Errore", (e as Error).message); }
    }, true);
  }

  if (caricamento || !match) return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} /></View>;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 100 }}>
        <Text style={styles.titolo}>Prepara: vs {match.avversario} — Set {numeroSet}</Text>

        {numeroSet === 1 ? (
          <View style={styles.card}>
            <Text style={styles.sottotitolo}>1. Convocati per questa gara</Text>
            <Text style={styles.nota}>Seleziona chi è convocata (può essere meno dell'intera rosa). Segna anche chi gioca da Libero. Si chiede una sola volta: valida per tutta la partita.</Text>
            {atlete.map((a) => (
              <View key={a.id} style={styles.rigaConvocata}>
                <Pressable style={styles.rigaConvocataInfo} onPress={() => toggleConvocata(a.id)}>
                  <View style={[styles.checkbox, convocateIds.has(a.id) && styles.checkboxAttivo]}>
                    {convocateIds.has(a.id) && <Text style={styles.checkboxSpunta}>✓</Text>}
                  </View>
                  <Text style={styles.rigaConvocataTesto}>{a.numero_maglia ? `#${a.numero_maglia} ` : ""}{a.nome} {a.cognome}</Text>
                </Pressable>
                {convocateIds.has(a.id) && (
                  <Pressable onPress={() => toggleLibero(a.id)}>
                    <Text style={[styles.tagLibero, liberoIds.has(a.id) && styles.tagLiberoAttivo]}>LIB</Text>
                  </Pressable>
                )}
              </View>
            ))}
            <Pressable style={styles.bottoneSecondario} onPress={salvaConvocati} disabled={salvandoConvocati || convocateIds.size === 0}>
              {salvandoConvocati ? <ActivityIndicator color={brand.colors.brand} /> : <Text style={styles.bottoneSecondarioTesto}>Salva convocati ({convocateIds.size})</Text>}
            </Pressable>
          </View>
        ) : (
          <Text style={styles.nota}>Convocati già fissati per questa partita ({convocateIds.size}) — scegli solo la formazione per questo set.</Text>
        )}

        {!mostraFormazione ? (
          <Pressable style={styles.bottoneApriFormazione} onPress={() => setMostraFormazione(true)} disabled={convocateIds.size < 6}>
            <Text style={styles.bottoneApriFormazioneTesto}>{convocateIds.size < 6 ? `Servono almeno 6 convocate (${convocateIds.size}/6)` : "2. Imposta formazione iniziale →"}</Text>
          </Pressable>
        ) : (
          <View style={styles.card}>
            <Text style={styles.sottotitolo}>2. Formazione iniziale (tocca una posizione)</Text>
            <Text style={styles.nota}>Tocca una casella del campo, poi scegli la convocata da mettere lì. La posizione 1 è la zona di battuta. Una giocatrice già posizionata non compare più tra le scelte per un'altra casella.</Text>
            <View style={styles.rigaAzioniCampo}>
              <Pressable onPress={svuotaFormazione} style={styles.bottoneAzioneCampo}><Text style={styles.bottoneAzioneCampoTesto}>🗑 Svuota tutto</Text></Pressable>
              <Pressable onPress={ruotaFormazioneDiUnaPosizione} style={styles.bottoneAzioneCampo}><Text style={styles.bottoneAzioneCampoTesto}>↻ Ruota di 1</Text></Pressable>
            </View>
            <Campo9x9 occupanti={occupantiCampo} onTapPosizione={(p) => setPosizioneInModifica(p)} onRimuoviPosizione={rimuoviPosizione} consentiPosizioniVuote />

            <Text style={[styles.etichetta, { marginTop: 10 }]}>Chi serve per prima in questo set?</Text>
            {chiServeRichiesto ? (
              <View style={styles.selettoreRiga}>
                {(["noi", "avversario"] as const).map((v) => (
                  <Pressable key={v} onPress={() => setChiServe(v)} style={[styles.chip, chiServe === v && styles.chipAttivo]}>
                    <Text style={[styles.chipTesto, chiServe === v && styles.chipTestoAttivo]}>{v === "noi" ? "Noi" : "Loro"}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.nota}>{chiServe === "noi" ? "Noi" : "Loro"} — dedotto in automatico dall'alternanza con il set precedente (non richiesto ai set 2-4 per regolamento; verrà richiesto di nuovo al 5° set).</Text>
            )}

            <Pressable style={styles.bottoneSecondario} onPress={salvaFormazione} disabled={!formazioneCompleta}>
              <Text style={styles.bottoneSecondarioTesto}>{formazioneCompleta ? "Salva formazione" : `Formazione incompleta (${Object.keys(posizioni).length}/6)`}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <View style={styles.pieDiPagina}>
        {!avviando ? (
          <Pressable style={[styles.bottoneAvvio, !formazioneCompleta && styles.bottoneAvvioDisabilitato]} onPress={onAvvia} disabled={!formazioneCompleta}>
            <Text style={styles.bottoneAvvioTesto}>▶ {numeroSet === 1 ? "INIZIA PARTITA" : `INIZIA SET ${numeroSet}`}</Text>
          </Pressable>
        ) : (
          <ActivityIndicator color={brand.colors.brand} />
        )}
        <Pressable onPress={onAnnullaChiudiPartita} style={{ marginTop: 8 }}>
          <Text style={styles.linkAnnulla}>Annulla e chiudi partita</Text>
        </Pressable>
      </View>

      <Modal visible={posizioneInModifica !== null} animationType="fade" transparent onRequestClose={() => setPosizioneInModifica(null)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>Chi va in posizione {posizioneInModifica}?</Text>
            <FlatList
              data={atleteDisponibiliPerPosizione}
              keyExtractor={(a) => a.id}
              renderItem={({ item }) => (
                <Pressable style={styles.rigaSceltaAtleta} onPress={() => assegnaPosizione(item.id)}>
                  <Text style={styles.rigaSceltaAtletaTesto}>{item.numero_maglia ? `#${item.numero_maglia} ` : ""}{item.nome} {item.cognome}</Text>
                </Pressable>
              )}
              ListEmptyComponent={<Text style={styles.nota}>Tutte le convocate sono già posizionate altrove.</Text>}
            />
            <Pressable onPress={() => setPosizioneInModifica(null)}><Text style={styles.linkAnnulla}>Chiudi</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  titolo: { color: brand.colors.onSurface, fontSize: 20, fontWeight: "700" },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 8 },
  sottotitolo: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  nota: { color: brand.colors.muted, fontSize: 12 },
  etichetta: { color: brand.colors.onSurface, fontSize: 13, fontWeight: "600" },
  rigaConvocata: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaConvocataInfo: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  rigaConvocataTesto: { color: brand.colors.onSurface, fontSize: 14 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: brand.colors.brand, alignItems: "center", justifyContent: "center" },
  checkboxAttivo: { backgroundColor: brand.colors.brand },
  checkboxSpunta: { color: "#000", fontWeight: "800", fontSize: 12 },
  tagLibero: { color: brand.colors.muted, fontSize: 11, fontWeight: "700", borderWidth: 1, borderColor: brand.colors.muted, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tagLiberoAttivo: { color: brand.colors.brandSecondary, borderColor: brand.colors.brandSecondary },
  bottoneSecondario: { borderColor: brand.colors.brand, borderWidth: 1, padding: 10, borderRadius: 8, alignItems: "center", marginTop: 4 },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "700" },
  bottoneApriFormazione: { backgroundColor: brand.colors.surfaceSecondary, borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 10, padding: 14, alignItems: "center" },
  bottoneApriFormazioneTesto: { color: brand.colors.brandSecondary, fontWeight: "700" },
  rigaAzioniCampo: { flexDirection: "row", gap: 8 },
  bottoneAzioneCampo: { flex: 1, borderWidth: 1, borderColor: brand.colors.muted, borderRadius: 8, paddingVertical: 8, alignItems: "center" },
  bottoneAzioneCampoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  selettoreRiga: { flexDirection: "row", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  pieDiPagina: { padding: 16, borderTopWidth: 1, borderTopColor: brand.colors.border, alignItems: "center" },
  bottoneAvvio: { backgroundColor: brand.colors.success, paddingVertical: 16, paddingHorizontal: 40, borderRadius: 14, width: "100%", alignItems: "center" },
  bottoneAvvioDisabilitato: { backgroundColor: brand.colors.surfaceTertiary },
  bottoneAvvioTesto: { color: "#000", fontWeight: "800", fontSize: 18 },
  linkAnnulla: { color: brand.colors.error, fontSize: 13, fontWeight: "600" },
  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 20, gap: 10, maxHeight: "70%" },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  rigaSceltaAtleta: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaSceltaAtletaTesto: { color: brand.colors.onSurface, fontSize: 14 },
});
