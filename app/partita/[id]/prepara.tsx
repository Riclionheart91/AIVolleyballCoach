import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useFocusEffect, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaAtlete } from "@/src/services/athletes";
import {
  avviaMatchConfermato,
  avviaPreparazioneMatch,
  chiServeDefaultNuovoSet,
  chiudiMatch,
  elencaConvocati,
  verificaFormazione,
  elencaFormazioneConPosizioni,
  impostaConvocati,
  impostaFormazioneIniziale,
  formazioneInizialeSet,
} from "@/src/services/matches";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { CorreggiFormazione } from "@/src/components/CorreggiFormazione";
import { brand } from "@/src/config";
import { supabaseClient } from "@/src/lib/supabase";
import type { Athlete, Match } from "@/src/types/database";

/** Distinta di gara: al massimo 12 atlete (Libero escluso) più 2 Liberi, cioe' 14 a referto. */
const MAX_CONVOCATE = 12;
const MAX_LIBERI = 2;

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
  // Formazione di partenza del set precedente (vuota al 1° set o se non disponibile).
  const [formazionePrecedente, setFormazionePrecedente] = useState<Record<number, string>>({});
  // Schermata della formazione (la stessa della correzione a partita iniziata).
  const [popupFormazione, setPopupFormazione] = useState(false);
  const [chiServe, setChiServe] = useState<"noi" | "avversario">("noi");
  const [chiServeRichiesto, setChiServeRichiesto] = useState(true); // false = auto-dedotto, non richiesto (set 2-4)
  const [mostraFormazione, setMostraFormazione] = useState(false); // "pulsante dedicato": la formazione si apre solo dopo averlo premuto
  const [caricamento, setCaricamento] = useState(true);
  const [salvandoConvocati, setSalvandoConvocati] = useState(false);
  const [avviando, setAvviando] = useState(false);
  const [avvisiFormazione, setAvvisiFormazione] = useState<string[]>([]);

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

      // Dal 2° set in poi: la formazione di partenza del set appena
      // concluso, da poter riproporre con un tocco.
      if (numero > 1) {
        const { data: setPrecedente } = await supabaseClient.from("match_sets").select("id").eq("match_id", id).eq("numero_set", numero - 1).maybeSingle();
        setFormazionePrecedente(setPrecedente ? await formazioneInizialeSet(setPrecedente.id) : {});
      } else {
        setFormazionePrecedente({});
      }

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
      if (numero > 1 && convocati.length > 0) {
        setMostraFormazione(true);
        if (Object.keys(posizioniIniziali).length === 0) setPopupFormazione(true);
      }
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCaricamento(false);
    }
  }, [id, team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  const nLiberiConvocati = Array.from(liberoIds).filter((x) => convocateIds.has(x)).length;
  const nConvocateGioco = convocateIds.size - nLiberiConvocati;

  function toggleConvocata(athleteId: string) {
    if (convocateIds.has(athleteId)) {
      setConvocateIds((prev) => { const n = new Set(prev); n.delete(athleteId); return n; });
      setLiberoIds((l) => { const n = new Set(l); n.delete(athleteId); return n; });
      return;
    }
    if (nConvocateGioco >= MAX_CONVOCATE) {
      avvisa(`Massimo ${MAX_CONVOCATE} convocate`, `La distinta ha al massimo ${MAX_CONVOCATE} atlete più ${MAX_LIBERI} Liberi (14 a referto). Togline una prima di aggiungerne un'altra.`);
      return;
    }
    setConvocateIds((prev) => new Set(prev).add(athleteId));
  }

  function toggleLibero(athleteId: string) {
    if (!convocateIds.has(athleteId)) return;
    if (liberoIds.has(athleteId)) {
      // Torna atleta di gioco: serve posto tra le 12.
      if (nConvocateGioco >= MAX_CONVOCATE) { avvisa(`Massimo ${MAX_CONVOCATE} convocate`, `Ci sono già ${MAX_CONVOCATE} atlete oltre ai Liberi: togline una prima.`); return; }
      setLiberoIds((prev) => { const n = new Set(prev); n.delete(athleteId); return n; });
      return;
    }
    if (nLiberiConvocati >= MAX_LIBERI) {
      avvisa(`Massimo ${MAX_LIBERI} Liberi`, `Sono già indicati ${MAX_LIBERI} Liberi: togline uno prima di indicarne un altro.`);
      return;
    }
    setLiberoIds((prev) => new Set(prev).add(athleteId));
  }

  async function salvaConvocati() {
    if (!id) return;
    if (nConvocateGioco > MAX_CONVOCATE || nLiberiConvocati > MAX_LIBERI) {
      avvisa("Distinta troppo lunga", `Al massimo ${MAX_CONVOCATE} atlete più ${MAX_LIBERI} Liberi.`);
      return;
    }
    setSalvandoConvocati(true);
    try {
      await impostaConvocati(id, Array.from(convocateIds), Array.from(liberoIds));
      // Passa subito alla formazione invece di lasciare la persona a
      // dover cercare il pulsante "2. Imposta formazione" — è il passo
      // naturale successivo, non serve chiederlo di nuovo.
      if (convocateIds.size >= 6) { setMostraFormazione(true); setPopupFormazione(true); }
      else avvisa("Salvato", "Convocati aggiornati. Ne servono almeno 6 per passare alla formazione.");
    } catch (e) {
      avvisa("Errore convocati", (e as Error).message);
    } finally {
      setSalvandoConvocati(false);
    }
  }

  const formazioneCompleta = Object.keys(posizioni).length === 6;

  async function salvaFormazione(): Promise<boolean> {
    if (!setId || !formazioneCompleta) return false;
    try {
      const payload = Object.fromEntries(Object.entries(posizioni).map(([p, a]) => [p, a]));
      await impostaFormazioneIniziale(setId, payload, chiServe);
      // Controlli di regolamento sulla disposizione dichiarata: avvisano
      // ma non bloccano, perché in allenamento una disposizione
      // irregolare può essere voluta.
      setAvvisiFormazione((await verificaFormazione(setId)).map((a) => a.avviso));
      return true;
    } catch (e) {
      avvisa("Errore formazione", (e as Error).message);
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
      avvisa("Impossibile avviare", (e as Error).message);
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
        } catch (e) { avvisa("Errore", (e as Error).message); }
      }, true);
      return;
    }

    confermaAzione("Annullare e chiudere la partita?", "La partita verrà eliminata senza essere mai iniziata.", "Elimina partita", async () => {
      try {
        const { error } = await supabaseClient.from("matches").delete().eq("id", id);
        if (error) throw error;
        router.replace("/(tabs)/partite");
      } catch (e) { avvisa("Errore", (e as Error).message); }
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
            <Text style={styles.nota}>Seleziona chi è convocato (al massimo 12 atlete più 2 Liberi, può essere meno dell'intera rosa). Segna anche chi gioca da Libero. Si chiede una sola volta: valida per tutta la partita.</Text>
            {atlete.map((a) => (
              <View key={a.id} style={styles.rigaConvocata}>
                <Pressable style={styles.rigaConvocataInfo} onPress={() => toggleConvocata(a.id)}>
                  <View style={[styles.checkbox, convocateIds.has(a.id) && styles.checkboxAttivo]}>
                    {convocateIds.has(a.id) && <Text style={styles.checkboxSpunta}>✓</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rigaConvocataTesto}>{a.numero_maglia ? `#${a.numero_maglia} ` : ""}{a.nome} {a.cognome}</Text>
                    <Text style={styles.rigaConvocataRuolo}>{a.ruolo_campo ?? "ruolo non indicato"}</Text>
                  </View>
                </Pressable>
                {convocateIds.has(a.id) && (
                  <Pressable onPress={() => toggleLibero(a.id)}>
                    <Text style={[styles.tagLibero, liberoIds.has(a.id) && styles.tagLiberoAttivo]}>LIB</Text>
                  </Pressable>
                )}
              </View>
            ))}
            <Text style={styles.nota}>
              Convocate: {nConvocateGioco} su {MAX_CONVOCATE} · Liberi: {nLiberiConvocati} su {MAX_LIBERI}
            </Text>
            {nConvocateGioco === MAX_CONVOCATE && nLiberiConvocati === 1 && (
              <Text style={styles.avvisoRegolamento}>
                ⚠ 12 atlete più 1 solo Libero (13 a referto) non è una composizione ammessa dal regolamento 2026/2027 (PGS e norme dei campionati di categoria): indica anche il secondo Libero oppure togli una convocata.
              </Text>
            )}
            <Pressable style={styles.bottoneSecondario} onPress={salvaConvocati} disabled={salvandoConvocati || convocateIds.size === 0}>
              {salvandoConvocati ? <ActivityIndicator color={brand.colors.brand} /> : <Text style={styles.bottoneSecondarioTesto}>Salva convocati ({convocateIds.size})</Text>}
            </Pressable>
          </View>
        ) : (
          <Text style={styles.nota}>Convocati già fissati per questa partita ({convocateIds.size}) — scegli solo la formazione per questo set.</Text>
        )}

        {!mostraFormazione ? (
          <Pressable style={styles.bottoneApriFormazione} onPress={() => { setMostraFormazione(true); setPopupFormazione(true); }} disabled={convocateIds.size < 6}>
            <Text style={styles.bottoneApriFormazioneTesto}>{convocateIds.size < 6 ? `Servono almeno 6 convocati (${convocateIds.size}/6)` : "2. Imposta formazione iniziale →"}</Text>
          </Pressable>
        ) : (
          <View style={styles.card}>
            <Text style={styles.sottotitolo}>2. Formazione del set {numeroSet}</Text>
            {formazioneCompleta ? (
              <View style={{ gap: 4 }}>
                {[1, 2, 3, 4, 5, 6].map((pos) => {
                  const a = atlete.find((x) => x.id === posizioni[pos]);
                  return (
                    <Text key={pos} style={styles.rigaFormazione}>
                      <Text style={styles.numeroPosizione}>{pos}{pos === 1 ? " (battuta)" : ""}  </Text>
                      {a ? `${a.numero_maglia != null ? `#${a.numero_maglia} ` : ""}${a.cognome}` : "—"}
                    </Text>
                  );
                })}
                <Text style={styles.nota}>Batte per primo: {chiServe === "noi" ? "noi" : "loro"}.</Text>
              </View>
            ) : (
              <Text style={styles.nota}>Formazione incompleta ({Object.keys(posizioni).length}/6): impostala per poter avviare.</Text>
            )}
            {avvisiFormazione.map((a, i) => (
              <Text key={i} style={styles.avvisoRegolamento}>⚠ {a}</Text>
            ))}
            <Pressable style={styles.bottoneSecondario} onPress={() => setPopupFormazione(true)}>
              <Text style={styles.bottoneSecondarioTesto}>{formazioneCompleta ? "Modifica la formazione" : "Imposta la formazione"}</Text>
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

      <CorreggiFormazione
        modo="iniziale"
        visibile={popupFormazione}
        setId={setId ?? ""}
        matchId={id ?? ""}
        numeroSet={numeroSet}
        atlete={atlete}
        convocateIds={Array.from(convocateIds)}
        liberiIds={liberoIds}
        inCampo={[]}
        chiServe={chiServe}
        liberoInCampo={false}
        puoCambiareDistinta={false}
        posizioniIniziali={posizioni}
        formazionePrecedente={formazionePrecedente}
        notaChiBatte={chiServeRichiesto ? undefined : "Dedotto in automatico dall'alternanza con il set precedente (non richiesto ai set 2-4 per regolamento; verrà richiesto di nuovo al 5° set)."}
        onSalva={async (nuove, chiBatte) => {
          if (!setId) throw new Error("Il set non è ancora pronto: riprova tra un attimo.");
          await impostaFormazioneIniziale(setId, Object.fromEntries(Object.entries(nuove).map(([p, a]) => [p, a])), chiBatte);
          setPosizioni(nuove);
          setChiServe(chiBatte);
          setAvvisiFormazione((await verificaFormazione(setId)).map((x) => x.avviso));
        }}
        onChiudi={() => setPopupFormazione(false)}
        onAggiornato={() => undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  titolo: { color: brand.colors.onSurface, fontSize: 20, fontWeight: "700" },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 8 },
  sottotitolo: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  nota: { color: brand.colors.muted, fontSize: 12 },
  rigaFormazione: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "600" },
  numeroPosizione: { color: brand.colors.muted, fontSize: 12, fontWeight: "700" },
  avvisoRegolamento: { color: brand.colors.warning, fontSize: 12, lineHeight: 17 },
  etichetta: { color: brand.colors.onSurface, fontSize: 13, fontWeight: "600" },
  rigaConvocata: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaConvocataInfo: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  rigaConvocataTesto: { color: brand.colors.onSurface, fontSize: 14 },
  rigaConvocataRuolo: { color: brand.colors.muted, fontSize: 11 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: brand.colors.brand, alignItems: "center", justifyContent: "center" },
  checkboxAttivo: { backgroundColor: brand.colors.brand },
  checkboxSpunta: { color: "#000", fontWeight: "800", fontSize: 12 },
  tagLibero: { color: brand.colors.muted, fontSize: 11, fontWeight: "700", borderWidth: 1, borderColor: brand.colors.muted, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tagLiberoAttivo: { color: brand.colors.brandSecondary, borderColor: brand.colors.brandSecondary },
  bottoneSecondario: { borderColor: brand.colors.brand, borderWidth: 1, padding: 10, borderRadius: 8, alignItems: "center", marginTop: 4 },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "700" },
  bottoneApriFormazione: { backgroundColor: brand.colors.surfaceSecondary, borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 10, padding: 14, alignItems: "center" },
  bottoneApriFormazioneTesto: { color: brand.colors.brandSecondary, fontWeight: "700" },
  bottoneStessaFormazione: { borderWidth: 1, borderColor: brand.colors.brand, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, alignItems: "center", minHeight: 46, justifyContent: "center" },
  bottoneStessaFormazioneAttivo: { backgroundColor: brand.colors.surfaceTertiary, borderColor: brand.colors.success },
  bottoneStessaFormazioneTesto: { color: brand.colors.onSurface, fontSize: 13, fontWeight: "700", textAlign: "center" },
  rigaAzioniCampo: { flexDirection: "row", gap: 8 },
  bottoneAzioneCampo: { flex: 1, borderWidth: 1, borderColor: brand.colors.muted, borderRadius: 8, paddingVertical: 12, alignItems: "center", minHeight: 44, justifyContent: "center" },
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
  rigaSceltaAtleta: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border, minHeight: 52, justifyContent: "center" },
  rigaSceltaAtletaTesto: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "600" },
});
