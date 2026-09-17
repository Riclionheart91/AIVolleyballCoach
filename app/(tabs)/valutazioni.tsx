import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, FlatList, ScrollView, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaAtlete } from "@/src/services/athletes";
import {
  atleteDaValutare,
  decidiProposta,
  elencaPropostePendenti,
  elencaValutazioni,
  generaPropostaValutazioneAI,
  impostaCadenzaValutazione,
  registraValutazione,
  rigettaProposta,
  type AtletaDaValutare,
} from "@/src/services/evaluations";
import { SchedaRendimento } from "@/src/components/SchedaRendimento";
import { brand, fondamentali, uiStrings } from "@/src/config";
import type { Athlete, Evaluation, EvaluationProposal, Fondamentale } from "@/src/types/database";
import { avvisa } from "@/src/lib/confermaAzione";

export default function Valutazioni() {
  const { team, puoScrivere, ruolo, atletaId } = useAuth();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contenuto}>
      <Text style={styles.titolo}>{uiStrings.valutazioni.title}</Text>

      {puoScrivere && team && <SezioneCicloValutazione teamId={team.id} />}
      {puoScrivere && <SezioneValutazioneCoach teamId={team!.id} />}
      {ruolo === "atleta" && atletaId && <SezioneValutazionePersonale athleteId={atletaId} teamId={team!.id} />}
      {ruolo === "presidente" && team && <SezioneValutazionePresidente teamId={team.id} />}
    </ScrollView>
  );
}

/**
 * Ciclo di valutazione a cadenza configurabile: mostra sempre CHI è
 * oltre la scadenza, invece di lasciare all'allenatore il compito di
 * ricordarselo. Il promemoria compare anche nel centro notifiche.
 */
function SezioneCicloValutazione({ teamId }: { teamId: string }) {
  const [daValutare, setDaValutare] = useState<AtletaDaValutare[]>([]);
  const [mostraTutte, setMostraTutte] = useState(false);
  const [cadenzaInModifica, setCadenzaInModifica] = useState(false);
  const [cadenza, setCadenza] = useState("30");

  const carica = useCallback(async () => {
    try { setDaValutare(await atleteDaValutare(teamId)); } catch { setDaValutare([]); }
  }, [teamId]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function salvaCadenza() {
    const giorni = Number(cadenza);
    if (!giorni || giorni < 7 || giorni > 365) { avvisa("Cadenza non valida", "Indica un valore tra 7 e 365 giorni."); return; }
    try {
      await impostaCadenzaValutazione(teamId, giorni);
      setCadenzaInModifica(false);
      carica();
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  const daMostrare = mostraTutte ? daValutare : daValutare.slice(0, 5);

  return (
    <View style={styles.cardAndamento}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={styles.sottotitoloSezione}>Da valutare ({daValutare.length})</Text>
        <Pressable onPress={() => setCadenzaInModifica(!cadenzaInModifica)}>
          <Text style={styles.linkCadenza}>Cadenza</Text>
        </Pressable>
      </View>

      {cadenzaInModifica && (
        <View style={styles.rigaCadenza}>
          <TextInput style={styles.inputCadenza} keyboardType="numeric" value={cadenza} onChangeText={setCadenza} />
          <Text style={styles.vuoto}>giorni tra una valutazione e l'altra</Text>
          <Pressable onPress={salvaCadenza}><Text style={styles.linkCadenza}>Salva</Text></Pressable>
        </View>
      )}

      {daValutare.length === 0 ? (
        <Text style={styles.vuoto}>Sono tutti valutati di recente.</Text>
      ) : (
        <>
          {daMostrare.map((a) => (
            <View key={a.athlete_id} style={styles.rigaAndamento}>
              <Text style={styles.rigaAndamentoTesto}>{a.numero_maglia ? `#${a.numero_maglia} ` : ""}{a.nome} {a.cognome}</Text>
              <Text style={[styles.rigaAndamentoValore, a.giorni_dall_ultima === null && styles.valoreMaiValutata]}>
                {a.giorni_dall_ultima === null ? "mai valutata" : `${a.giorni_dall_ultima} gg fa`}
              </Text>
            </View>
          ))}
          {daValutare.length > 5 && (
            <Pressable onPress={() => setMostraTutte(!mostraTutte)}>
              <Text style={styles.linkCadenza}>{mostraTutte ? "Mostra meno" : `Mostra tutte (${daValutare.length})`}</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

/** Vista completa per allenatore/vice: identica al flusso manual-first già validato in GAS. */
function SezioneValutazioneCoach({ teamId }: { teamId: string }) {
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [atletaSelId, setAtletaSelId] = useState<string | null>(null);
  const [fondamentale, setFondamentale] = useState<Fondamentale>("Attacco");
  const [punteggio, setPunteggio] = useState("");
  const [propostaPendente, setPropostaPendente] = useState<{ proposta: EvaluationProposal; modificatoAMano: boolean } | null>(null);
  const [generandoAI, setGenerandoAI] = useState(false);
  const [istruzioniExtra, setIstruzioniExtra] = useState("");
  const [messaggioAI, setMessaggioAI] = useState<{ tipo: "ok" | "errore" | "avviso"; testo: string } | null>(null);
  const [proposteInAttesa, setProposteInAttesa] = useState<EvaluationProposal[]>([]);
  const [mostraProposteInAttesa, setMostraProposteInAttesa] = useState(false);

  const carica = useCallback(async () => {
    const lista = await elencaAtlete(teamId);
    setAtlete(lista);
    if (!atletaSelId && lista.length) setAtletaSelId(lista[0].id);
    setProposteInAttesa(await elencaPropostePendenti(teamId));
  }, [teamId, atletaSelId]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));
  useEffect(() => { setPropostaPendente(null); setMessaggioAI(null); }, [atletaSelId, fondamentale]);

  function onPunteggioModificato(testo: string) {
    setPunteggio(testo);
    if (propostaPendente && Number(testo) !== propostaPendente.proposta.valore_proposto) setPropostaPendente({ ...propostaPendente, modificatoAMano: true });
  }

  async function onRegistra() {
    if (!atletaSelId || !punteggio) return;
    const valore = Number(punteggio);
    if (Number.isNaN(valore) || valore < 1 || valore > 10) { avvisa("Punteggio non valido", "Inserisci un valore tra 1 e 10."); return; }
    try {
      if (!propostaPendente) {
        await registraValutazione(teamId, atletaSelId, fondamentale, valore);
      } else {
        await decidiProposta(propostaPendente.proposta.id, valore);
      }
      setPunteggio(""); setPropostaPendente(null);
      setMessaggioAI({ tipo: "ok", testo: "Valutazione registrata." });
      carica();
    } catch (e) {
      setMessaggioAI({ tipo: "errore", testo: (e as Error).message });
    }
  }

  async function onSuggerisciAI() {
    if (!atletaSelId) return;
    const atleta = atlete.find((a) => a.id === atletaSelId);
    if (!atleta) return;
    setGenerandoAI(true);
    setMessaggioAI({ tipo: "avviso", testo: uiStrings.valutazioni.aiGenerating });
    try {
      const storico = (await elencaValutazioni(atletaSelId, fondamentale)).slice(0, 5).map((v) => ({ punteggio: v.punteggio, data: v.data_valutazione }));
      const risultato = await generaPropostaValutazioneAI(teamId, atletaSelId, `${atleta.nome} ${atleta.cognome}`, fondamentale, storico, istruzioniExtra);
      if (risultato.errore || !risultato.proposta) {
        setMessaggioAI({ tipo: "errore", testo: `${risultato.messaggio} — ${uiStrings.valutazioni.aiFallback}.` });
        return;
      }
      setPropostaPendente({ proposta: risultato.proposta, modificatoAMano: false });
      setPunteggio(String(risultato.proposta.valore_proposto));
      setMessaggioAI({ tipo: "ok", testo: `Suggerimento AI: ${risultato.proposta.valore_proposto} (confidenza ${risultato.proposta.confidenza}, ${risultato.chiamateResidue}/${risultato.limite} chiamate residue oggi). ${risultato.proposta.motivazione} — modifica pure il punteggio prima di registrare, se non sei d'accordo.` });
      carica();
    } catch (e) {
      setMessaggioAI({ tipo: "errore", testo: `${(e as Error).message} — ${uiStrings.valutazioni.aiFallback}.` });
    } finally {
      setGenerandoAI(false);
    }
  }

  async function onDecidiDallaLista(p: EvaluationProposal) {
    try { await decidiProposta(p.id, p.valore_proposto); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
  }
  async function onRigettaDallaLista(p: EvaluationProposal) {
    try { await rigettaProposta(p.id); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.selettoreRiga}>
        <FlatList
          horizontal
          data={atlete}
          keyExtractor={(a) => a.id}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable onPress={() => setAtletaSelId(item.id)} style={[styles.chip, atletaSelId === item.id && styles.chipAttivo]}>
              <Text style={[styles.chipTesto, atletaSelId === item.id && styles.chipTestoAttivo]}>{item.nome} {item.cognome}</Text>
            </Pressable>
          )}
        />
      </View>

      <View style={styles.selettoreRiga}>
        {fondamentali.map((f) => (
          <Pressable key={f} onPress={() => setFondamentale(f)} style={[styles.chip, fondamentale === f && styles.chipAttivo]}>
            <Text style={[styles.chipTesto, fondamentale === f && styles.chipTestoAttivo]}>{f}</Text>
          </Pressable>
        ))}
      </View>

      <TextInput style={styles.inputPunteggio} placeholder="Punteggio (1-10)" placeholderTextColor={brand.colors.muted} keyboardType="numeric" value={punteggio} onChangeText={onPunteggioModificato} />

      <TextInput
        style={[styles.input, { minHeight: 52, textAlignVertical: "top" }]}
        multiline
        placeholder="Contesto per l'AI (facoltativo): es. rientra da infortunio, ha cambiato ruolo, ultime settimane con poche presenze"
        placeholderTextColor={brand.colors.muted}
        value={istruzioniExtra}
        onChangeText={setIstruzioniExtra}
      />

      <View style={styles.azioni}>
        <Pressable style={styles.bottonePrimario} onPress={onRegistra} disabled={!punteggio}>
          <Text style={styles.bottonePrimarioTesto}>Registra valutazione</Text>
        </Pressable>
        <Pressable style={styles.bottoneAI} onPress={onSuggerisciAI} disabled={generandoAI || !atletaSelId}>
          {generandoAI ? <ActivityIndicator color={brand.colors.brand} /> : <Text style={styles.bottoneAITesto}>{uiStrings.valutazioni.aiButton}</Text>}
        </Pressable>
      </View>

      {messaggioAI && (
        <Text style={[styles.messaggio, messaggioAI.tipo === "errore" && styles.messaggioErrore, messaggioAI.tipo === "ok" && styles.messaggioOk]}>{messaggioAI.testo}</Text>
      )}

      <Pressable style={styles.rigaEspandi} onPress={() => setMostraProposteInAttesa(!mostraProposteInAttesa)}>
        <Text style={styles.rigaEspandiTesto}>{mostraProposteInAttesa ? "▾" : "▸"} {uiStrings.valutazioni.pendingSection} ({proposteInAttesa.length})</Text>
      </Pressable>

      {mostraProposteInAttesa && (
        <View>
          {proposteInAttesa.length === 0 && <Text style={styles.vuoto}>Nessuna proposta in attesa.</Text>}
          {proposteInAttesa.map((item) => {
            const atleta = atlete.find((a) => a.id === item.athlete_id);
            return (
              <View key={item.id} style={styles.cardProposta}>
                <Text style={styles.cardPropostaTitolo}>{atleta ? `${atleta.nome} ${atleta.cognome}` : "Atleta"} — {item.fondamentale}: {item.valore_proposto}</Text>
                {!!item.motivazione && <Text style={styles.cardPropostaMotivazione}>{item.motivazione}</Text>}
                <View style={styles.azioniProposta}>
                  <Pressable style={styles.bottoneSecondario} onPress={() => onDecidiDallaLista(item)}><Text style={styles.bottoneSecondarioTesto}>Approva</Text></Pressable>
                  <Pressable style={styles.bottoneSecondarioRigetta} onPress={() => onRigettaDallaLista(item)}><Text style={styles.bottoneSecondarioRigettaTesto}>Rigetta</Text></Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** Vista dell'atleta: solo il proprio storico, mai quello delle compagne (RLS lo garantisce comunque anche se questa UI avesse un bug). */
function SezioneValutazionePersonale({ athleteId, teamId }: { athleteId: string; teamId: string }) {
  const [fondamentale, setFondamentale] = useState<Fondamentale>("Attacco");
  const [valutazioni, setValutazioni] = useState<Evaluation[]>([]);

  useFocusEffect(useCallback(() => { elencaValutazioni(athleteId, fondamentale).then(setValutazioni); }, [athleteId, fondamentale]));

  return (
    <View style={{ gap: 12 }}>
      <SchedaRendimento athleteId={athleteId} modificabile={false} />


      <Text style={[styles.sottotitoloSezione, { marginTop: 8 }]}>Storico per fondamentale</Text>
      <View style={styles.selettoreRiga}>
        {fondamentali.map((f) => (
          <Pressable key={f} onPress={() => setFondamentale(f)} style={[styles.chip, fondamentale === f && styles.chipAttivo]}>
            <Text style={[styles.chipTesto, fondamentale === f && styles.chipTestoAttivo]}>{f}</Text>
          </Pressable>
        ))}
      </View>
      {valutazioni.length === 0 ? (
        <Text style={styles.vuoto}>Nessuna valutazione ancora per questo fondamentale.</Text>
      ) : (
        valutazioni.map((v) => (
          <View key={v.id} style={styles.rigaAndamento}>
            <Text style={styles.rigaAndamentoTesto}>{v.data_valutazione.slice(0, 10)}</Text>
            <Text style={styles.rigaAndamentoValore}>{v.punteggio}</Text>
          </View>
        ))
      )}

    </View>
  );
}

/** Vista del presidente: sola lettura su tutte la rosa, nessun controllo di scrittura. */
function SezioneValutazionePresidente({ teamId }: { teamId: string }) {
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [atletaSelId, setAtletaSelId] = useState<string | null>(null);
  const [fondamentale, setFondamentale] = useState<Fondamentale>("Attacco");
  const [valutazioni, setValutazioni] = useState<Evaluation[]>([]);

  useFocusEffect(useCallback(() => {
    elencaAtlete(teamId).then((lista) => { setAtlete(lista); if (!atletaSelId && lista.length) setAtletaSelId(lista[0].id); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]));

  useFocusEffect(useCallback(() => { if (atletaSelId) elencaValutazioni(atletaSelId, fondamentale).then(setValutazioni); }, [atletaSelId, fondamentale]));

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.sottotitoloSezione}>Consultazione (sola lettura)</Text>
      <View style={styles.selettoreRiga}>
        {atlete.map((a) => (
          <Pressable key={a.id} onPress={() => setAtletaSelId(a.id)} style={[styles.chip, atletaSelId === a.id && styles.chipAttivo]}>
            <Text style={[styles.chipTesto, atletaSelId === a.id && styles.chipTestoAttivo]}>{a.nome} {a.cognome}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.selettoreRiga}>
        {fondamentali.map((f) => (
          <Pressable key={f} onPress={() => setFondamentale(f)} style={[styles.chip, fondamentale === f && styles.chipAttivo]}>
            <Text style={[styles.chipTesto, fondamentale === f && styles.chipTestoAttivo]}>{f}</Text>
          </Pressable>
        ))}
      </View>
      {valutazioni.map((v) => (
        <View key={v.id} style={styles.rigaAndamento}>
          <Text style={styles.rigaAndamentoTesto}>{v.data_valutazione.slice(0, 10)}</Text>
          <Text style={styles.rigaAndamentoValore}>{v.punteggio}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  container: { flex: 1, backgroundColor: brand.colors.surface },
  contenuto: { padding: 16, gap: 12, paddingBottom: 60 },
  titolo: { color: brand.colors.onSurface, fontSize: 20, fontWeight: "700" },
  sottotitoloSezione: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "700" },
  cardAndamento: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 12, gap: 6 },
  rigaAndamento: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaAndamentoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  rigaAndamentoValore: { color: brand.colors.brand, fontWeight: "700" },
  valoreMaiValutata: { color: brand.colors.warning },
  linkCadenza: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "600" },
  rigaCadenza: { flexDirection: "row", alignItems: "center", gap: 8 },
  inputCadenza: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 6, padding: 6, width: 50, textAlign: "center" },
  rigaAndamentoN: { color: brand.colors.muted, fontWeight: "400", fontSize: 11 },
  selettoreRiga: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brand.colors.surfaceSecondary, marginRight: 6 },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  inputPunteggio: { backgroundColor: brand.colors.surfaceSecondary, color: brand.colors.onSurface, borderRadius: 8, padding: 12, fontSize: 18, textAlign: "center" },
  azioni: { flexDirection: "row", gap: 8 },
  bottonePrimario: { flex: 1, backgroundColor: brand.colors.brand, padding: 12, borderRadius: 8, alignItems: "center" },
  bottonePrimarioTesto: { color: "#000", fontWeight: "700" },
  bottoneAI: { flex: 1, borderWidth: 1, borderColor: brand.colors.brandSecondary, padding: 12, borderRadius: 8, alignItems: "center" },
  bottoneAITesto: { color: brand.colors.brandSecondary, fontWeight: "700" },
  messaggio: { color: brand.colors.muted, fontSize: 13 },
  messaggioOk: { color: brand.colors.success },
  messaggioErrore: { color: brand.colors.error },
  rigaEspandi: { marginTop: 4 },
  rigaEspandiTesto: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "600" },
  vuoto: { color: brand.colors.muted, fontSize: 13 },
  cardProposta: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, padding: 12, marginTop: 8, gap: 6 },
  cardPropostaTitolo: { color: brand.colors.onSurface, fontWeight: "600" },
  cardPropostaMotivazione: { color: brand.colors.muted, fontSize: 12 },
  azioniProposta: { flexDirection: "row", gap: 8 },
  bottoneSecondario: { borderColor: brand.colors.success, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  bottoneSecondarioTesto: { color: brand.colors.success, fontWeight: "600", fontSize: 13 },
  bottoneSecondarioRigetta: { borderColor: brand.colors.error, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  bottoneSecondarioRigettaTesto: { color: brand.colors.error, fontWeight: "600", fontSize: 13 },
});
