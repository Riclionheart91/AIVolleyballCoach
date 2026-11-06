import { RinvioPromemoria } from "@/src/components/RinvioPromemoria";
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
import { TitoloGrande } from "@/src/components/TitoloGrande";
import { MenuAzioni } from "@/src/components/MenuAzioni";
import { SPAZIO_BARRA } from "@/src/lib/spazioBarra";

/** Testo dentro l'avatar: il numero di maglia, o le iniziali se manca. */
function testoAvatar(numero: number | string | null | undefined, nome?: string | null, cognome?: string | null): string {
  if (numero) return String(numero);
  return `${(nome ?? "").trim().charAt(0)}${(cognome ?? "").trim().charAt(0)}`.toUpperCase();
}

export default function Valutazioni() {
  const { team, puoScrivere, ruolo, atletaId } = useAuth();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contenuto}>
      <TitoloGrande titolo={uiStrings.valutazioni.title} />

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
    <View style={{ gap: 10 }}>
      <View style={styles.rigaIntestazione}>
        <Text style={styles.titoloSezione}>Da valutare ({daValutare.length})</Text>
        <Pressable onPress={() => setCadenzaInModifica(!cadenzaInModifica)} style={styles.bottoneSecondarioPill}>
          <Text style={styles.bottoneSecondarioPillTesto}>Cadenza</Text>
        </Pressable>
      </View>

      {daValutare.length > 0 && <RinvioPromemoria teamId={teamId} tipo="valutazioni" />}

      {cadenzaInModifica && (
        <View style={[styles.scheda, styles.rigaCadenza]}>
          <TextInput style={styles.inputCadenza} keyboardType="numeric" value={cadenza} onChangeText={setCadenza} />
          <Text style={[styles.vuoto, { flex: 1 }]}>giorni tra una valutazione e l'altra</Text>
          <Pressable onPress={salvaCadenza} style={styles.bottoneSecondarioPill}><Text style={styles.bottoneSecondarioPillTesto}>Salva</Text></Pressable>
        </View>
      )}

      {daValutare.length === 0 ? (
        <View style={[styles.scheda, { padding: 16 }]}><Text style={styles.vuoto}>Sono tutti valutati di recente.</Text></View>
      ) : (
        <>
          <View style={styles.scheda}>
            {daMostrare.map((a, i) => (
              <View key={a.athlete_id}>
                {i > 0 && <View style={[styles.separatore, { marginLeft: 66 }]} />}
                <View style={styles.rigaAtleta}>
                  <View style={styles.avatar}><Text style={styles.avatarTesto}>{testoAvatar(a.numero_maglia, a.nome, a.cognome)}</Text></View>
                  <Text style={styles.nomeAtleta} numberOfLines={1}>{a.nome} {a.cognome}</Text>
                  <Text style={[styles.rigaAndamentoValore, a.giorni_dall_ultima === null && styles.valoreMaiValutata]}>
                    {a.giorni_dall_ultima === null ? "mai valutata" : `${a.giorni_dall_ultima} gg fa`}
                  </Text>
                </View>
              </View>
            ))}
          </View>
          {daValutare.length > 5 && (
            <Pressable onPress={() => setMostraTutte(!mostraTutte)} style={styles.linkRiga}>
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
    <View style={{ gap: 16 }}>
      <View style={[styles.scheda, { padding: 16, gap: 12 }]}>
        <FlatList
          horizontal
          data={atlete}
          keyExtractor={(a) => a.id}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable onPress={() => setAtletaSelId(item.id)} hitSlop={4} style={[styles.chip, atletaSelId === item.id && styles.chipAttivo]}>
              <Text style={[styles.chipTesto, atletaSelId === item.id && styles.chipTestoAttivo]}>{item.nome} {item.cognome}</Text>
            </Pressable>
          )}
        />

        <View style={styles.selettoreRiga}>
          {fondamentali.map((f) => (
            <Pressable key={f} onPress={() => setFondamentale(f)} hitSlop={4} style={[styles.chip, fondamentale === f && styles.chipAttivo]}>
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
          maxLength={500} value={istruzioniExtra}
          onChangeText={setIstruzioniExtra}
        />

        <View style={styles.azioni}>
          <MenuAzioni
            titolo="Cosa vuoi fare?"
            testoPulsante="Valuta"
            occupato={generandoAI}
            stile={{ flexGrow: 1 }}
            voci={[
              { etichetta: "Registra il punteggio", icona: "checkmark-circle-outline", sotto: punteggio ? `${fondamentale}: ${punteggio}` : "Scrivi prima il punteggio (1-10)", disattiva: !punteggio, onPress: onRegistra },
              { etichetta: "Chiedi un suggerimento all'AI", icona: "sparkles-outline", sotto: atletaSelId ? "L'AI propone un voto: lo approvi o lo rigetti dopo" : "Scegli prima un'atleta", disattiva: !atletaSelId, onPress: onSuggerisciAI },
            ]}
          />
        </View>

        {messaggioAI && (
          <Text style={[styles.messaggio, messaggioAI.tipo === "errore" && styles.messaggioErrore, messaggioAI.tipo === "ok" && styles.messaggioOk]}>{messaggioAI.testo}</Text>
        )}
      </View>

      <View style={{ gap: 10 }}>
        <Pressable style={styles.rigaEspandi} onPress={() => setMostraProposteInAttesa(!mostraProposteInAttesa)}>
          <Text style={styles.titoloSezione}>{mostraProposteInAttesa ? "▾" : "▸"} {uiStrings.valutazioni.pendingSection}</Text>
          <View style={styles.badge}><Text style={styles.badgeTesto}>{proposteInAttesa.length}</Text></View>
        </Pressable>

        {mostraProposteInAttesa && (
          <View style={styles.scheda}>
            {proposteInAttesa.length === 0 && <Text style={[styles.vuoto, { padding: 16 }]}>Nessuna proposta in attesa.</Text>}
            {proposteInAttesa.map((item, i) => {
              const atleta = atlete.find((a) => a.id === item.athlete_id);
              return (
                <View key={item.id}>
                  {i > 0 && <View style={[styles.separatore, { marginLeft: 66 }]} />}
                  <View style={styles.cardProposta}>
                    <View style={styles.rigaAtletaSenzaPadding}>
                      <View style={styles.avatar}><Text style={styles.avatarTesto}>{atleta ? testoAvatar(atleta.numero_maglia, atleta.nome, atleta.cognome) : "?"}</Text></View>
                      <View style={{ flex: 1, gap: 1 }}>
                        <Text style={styles.cardPropostaTitolo}>{atleta ? `${atleta.nome} ${atleta.cognome}` : "Atleta"} — {item.fondamentale}: {item.valore_proposto}</Text>
                        {!!item.motivazione && <Text style={styles.cardPropostaMotivazione}>{item.motivazione}</Text>}
                      </View>
                    </View>
                    <View style={styles.azioniProposta}>
                      <Pressable style={styles.bottoneSecondario} onPress={() => onDecidiDallaLista(item)}><Text style={styles.bottoneSecondarioTesto}>Approva</Text></Pressable>
                      <Pressable style={styles.bottoneSecondarioRigetta} onPress={() => onRigettaDallaLista(item)}><Text style={styles.bottoneSecondarioRigettaTesto}>Rigetta</Text></Pressable>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
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


      <Text style={[styles.titoloSezione, { marginTop: 8 }]}>Storico per fondamentale</Text>
      <View style={styles.selettoreRiga}>
        {fondamentali.map((f) => (
          <Pressable key={f} onPress={() => setFondamentale(f)} hitSlop={4} style={[styles.chip, fondamentale === f && styles.chipAttivo]}>
            <Text style={[styles.chipTesto, fondamentale === f && styles.chipTestoAttivo]}>{f}</Text>
          </Pressable>
        ))}
      </View>
      {valutazioni.length === 0 ? (
        <View style={[styles.scheda, { padding: 16 }]}><Text style={styles.vuoto}>Nessuna valutazione ancora per questo fondamentale.</Text></View>
      ) : (
        <View style={styles.scheda}>
          {valutazioni.map((v, i) => (
            <View key={v.id}>
              {i > 0 && <View style={[styles.separatore, { marginLeft: 16 }]} />}
              <View style={styles.rigaAndamento}>
                <Text style={styles.rigaAndamentoTesto}>{v.data_valutazione.slice(0, 10)}</Text>
                <Text style={styles.rigaAndamentoValore}>{v.punteggio}</Text>
              </View>
            </View>
          ))}
        </View>
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
      <Text style={styles.titoloSezione}>Consultazione (sola lettura)</Text>
      <View style={styles.selettoreRiga}>
        {atlete.map((a) => (
          <Pressable key={a.id} onPress={() => setAtletaSelId(a.id)} hitSlop={4} style={[styles.chip, atletaSelId === a.id && styles.chipAttivo]}>
            <Text style={[styles.chipTesto, atletaSelId === a.id && styles.chipTestoAttivo]}>{a.nome} {a.cognome}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.selettoreRiga}>
        {fondamentali.map((f) => (
          <Pressable key={f} onPress={() => setFondamentale(f)} hitSlop={4} style={[styles.chip, fondamentale === f && styles.chipAttivo]}>
            <Text style={[styles.chipTesto, fondamentale === f && styles.chipTestoAttivo]}>{f}</Text>
          </Pressable>
        ))}
      </View>
      {valutazioni.length > 0 && (
        <View style={styles.scheda}>
          {valutazioni.map((v, i) => (
            <View key={v.id}>
              {i > 0 && <View style={[styles.separatore, { marginLeft: 16 }]} />}
              <View style={styles.rigaAndamento}>
                <Text style={styles.rigaAndamentoTesto}>{v.data_valutazione.slice(0, 10)}</Text>
                <Text style={styles.rigaAndamentoValore}>{v.punteggio}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 44, fontSize: 16 },
  container: { flex: 1, backgroundColor: brand.colors.surface },
  contenuto: { padding: 16, gap: 20, paddingBottom: SPAZIO_BARRA, width: "100%", maxWidth: 900, alignSelf: "center" },
  titoloSezione: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  scheda: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, overflow: "hidden" },
  separatore: { height: 1, backgroundColor: brand.colors.border },
  rigaIntestazione: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  rigaAtleta: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 14, minHeight: 60 },
  rigaAtletaSenzaPadding: { flexDirection: "row", alignItems: "center", gap: 12 },
  nomeAtleta: { flex: 1, color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  avatarTesto: { color: brand.colors.brand, fontSize: 15, fontWeight: "700" },
  rigaAndamento: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, paddingHorizontal: 16, minHeight: 48 },
  rigaAndamentoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 15 },
  rigaAndamentoValore: { color: brand.colors.brand, fontWeight: "700", fontSize: 14 },
  valoreMaiValutata: { color: brand.colors.warning },
  linkCadenza: { color: brand.colors.brandSecondary, fontSize: 14, fontWeight: "600" },
  linkRiga: { minHeight: 44, justifyContent: "center" },
  bottoneSecondarioPill: { backgroundColor: brand.colors.surfaceTertiary, borderRadius: 999, minHeight: 36, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  bottoneSecondarioPillTesto: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "600" },
  rigaCadenza: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  inputCadenza: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 10, padding: 8, minHeight: 44, width: 60, textAlign: "center", fontSize: 16, fontWeight: "700" },
  selettoreRiga: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 14, minHeight: 36, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, marginRight: 6, alignItems: "center", justifyContent: "center" },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14, fontWeight: "600" },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  inputPunteggio: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 12, padding: 12, minHeight: 48, fontSize: 18, textAlign: "center" },
  azioni: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  bottonePrimario: { flexGrow: 1, flexBasis: 160, backgroundColor: brand.colors.brand, paddingVertical: 8, paddingHorizontal: 20, minHeight: 44, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  bottonePrimarioTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
  bottoneAI: { flexGrow: 1, flexBasis: 160, backgroundColor: brand.colors.surfaceTertiary, paddingVertical: 8, paddingHorizontal: 20, minHeight: 44, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  bottoneAITesto: { color: brand.colors.onSurface, fontWeight: "600", fontSize: 16 },
  messaggio: { color: brand.colors.muted, fontSize: 13 },
  messaggioOk: { color: brand.colors.success },
  messaggioErrore: { color: brand.colors.error },
  rigaEspandi: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  badgeTesto: { color: brand.colors.onSurface, fontSize: 12, fontWeight: "700" },
  vuoto: { color: brand.colors.muted, fontSize: 14 },
  cardProposta: { paddingVertical: 12, paddingHorizontal: 14, gap: 10 },
  cardPropostaTitolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  cardPropostaMotivazione: { color: brand.colors.muted, fontSize: 13 },
  azioniProposta: { flexDirection: "row", gap: 8 },
  bottoneSecondario: { flex: 1, backgroundColor: brand.colors.success, minHeight: 36, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  bottoneSecondarioTesto: { color: "#000", fontWeight: "700", fontSize: 14 },
  bottoneSecondarioRigetta: { flex: 1, backgroundColor: brand.colors.surfaceTertiary, minHeight: 36, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  bottoneSecondarioRigettaTesto: { color: brand.colors.error, fontWeight: "600", fontSize: 14 },
});
