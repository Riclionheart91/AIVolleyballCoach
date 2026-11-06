import { RinvioPromemoria } from "@/src/components/RinvioPromemoria";
import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Modal, Animated } from "react-native";
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
  preparaControlloATappeto,
  eseguiControlloATappeto,
  type AtletaDaValutare,
} from "@/src/services/evaluations";
import { SchedaRendimento } from "@/src/components/SchedaRendimento";
import { brand, fondamentali, uiStrings } from "@/src/config";
import type { Athlete, Evaluation, EvaluationProposal, Fondamentale } from "@/src/types/database";
import { avvisa, confermaAzione } from "@/src/lib/confermaAzione";
import { TitoloGrande } from "@/src/components/TitoloGrande";
import { MenuAzioni } from "@/src/components/MenuAzioni";
import { SPAZIO_BARRA } from "@/src/lib/spazioBarra";
import { TitoloCompatto, stileFisso, useScorrimentoIOS } from "@/src/lib/scorrimentoIOS";
import { BarraRicerca } from "@/src/components/BarraRicerca";
import { useTrascinaPerChiudere } from "@/src/lib/trascinaPerChiudere";

/** Testo dentro l'avatar: il numero di maglia, o le iniziali se manca. */
function testoAvatar(numero: number | string | null | undefined, nome?: string | null, cognome?: string | null): string {
  if (numero) return String(numero);
  return `${(nome ?? "").trim().charAt(0)}${(cognome ?? "").trim().charAt(0)}`.toUpperCase();
}

export default function Valutazioni() {
  const { team, puoScrivere, ruolo, atletaId } = useAuth();
  // Il "tira per aggiornare" richiama il caricamento dell'elenco, registrato da ElencoValutazioni.
  const aggiornaRef = useRef<(() => Promise<void>) | null>(null);
  const registraAggiorna = useCallback((f: () => Promise<void>) => { aggiornaRef.current = f; }, []);
  const { scrollY, propsLista, indicatore } = useScorrimentoIOS(() => aggiornaRef.current?.());

  return (
    <View style={styles.container}>
    <TitoloCompatto titolo={uiStrings.valutazioni.title} scrollY={scrollY} />
    {indicatore}
    <ScrollView style={styles.container} contentContainerStyle={[styles.contenuto, puoScrivere && { gap: 0 }]} keyboardShouldPersistTaps="handled" {...propsLista}>
      <TitoloGrande titolo={uiStrings.valutazioni.title} />

      {puoScrivere && team && <ElencoValutazioni teamId={team.id} registraAggiorna={registraAggiorna} />}
      {ruolo === "atleta" && atletaId && <SezioneValutazionePersonale athleteId={atletaId} teamId={team!.id} />}
      {ruolo === "presidente" && team && <SezioneValutazionePresidente teamId={team.id} />}
    </ScrollView>
    </View>
  );
}

type Scheda = "da_valutare" | "tutte" | "proposte";

/**
 * Valutazioni per allenatore/vice: un elenco di atlete (da valutare / tutte / proposte AI) con ricerca fissa.
 * Si tocca un'atleta e si valuta in un foglio dal basso, con tutti i fondamentali insieme.
 */
function ElencoValutazioni({ teamId, registraAggiorna }: { teamId: string; registraAggiorna: (f: () => Promise<void>) => void }) {
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [daValutare, setDaValutare] = useState<AtletaDaValutare[]>([]);
  const [proposte, setProposte] = useState<EvaluationProposal[]>([]);
  const [scheda, setScheda] = useState<Scheda>("da_valutare");
  const [ricerca, setRicerca] = useState("");
  const [atletaAperta, setAtletaAperta] = useState<Athlete | null>(null);
  const [cadenzaInModifica, setCadenzaInModifica] = useState(false);
  const [cadenza, setCadenza] = useState("30");
  const [controllo, setControllo] = useState<{ fatti: number; totale: number } | null>(null);
  const [esitoControllo, setEsitoControllo] = useState<{ tipo: "ok" | "errore"; testo: string } | null>(null);

  const carica = useCallback(async () => {
    const [lista, dv, pr] = await Promise.all([
      elencaAtlete(teamId),
      atleteDaValutare(teamId).catch(() => [] as AtletaDaValutare[]),
      elencaPropostePendenti(teamId).catch(() => [] as EvaluationProposal[]),
    ]);
    setAtlete(lista); setDaValutare(dv); setProposte(pr);
  }, [teamId]);

  useFocusEffect(useCallback(() => { carica().catch(() => { /* l'elenco resta quello precedente */ }); }, [carica]));
  useEffect(() => { registraAggiorna(carica); }, [carica, registraAggiorna]);

  async function salvaCadenza() {
    const giorni = Number(cadenza);
    if (!giorni || giorni < 7 || giorni > 365) { avvisa("Cadenza non valida", "Indica un valore tra 7 e 365 giorni."); return; }
    try {
      await impostaCadenzaValutazione(teamId, giorni);
      setCadenzaInModifica(false);
      carica();
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  /** Controllo a tappeto: prepara, chiede conferma (consuma chiamate AI del giorno) ed esegue. */
  async function avviaControllo() {
    if (controllo) return;
    setEsitoControllo(null);
    try {
      const prep = await preparaControlloATappeto(teamId, atlete, proposte);
      if (prep.gruppi.length === 0) {
        setEsitoControllo({ tipo: "ok", testo: "Niente da controllare: nessuna atleta ha uno storico di valutazioni (o le sue proposte sono già in attesa). Registra prima qualche valutazione." });
        return;
      }
      const n = prep.gruppi.length;
      confermaAzione(
        "Controllo AI su tutta la rosa",
        `L'AI rilegge lo storico di ${prep.atleteControllate} atlete (senza nomi) e propone un aggiornamento solo dove serve. Usa ${n} ${n === 1 ? "chiamata" : "chiamate"} AI del limite giornaliero. Le proposte non cambiano nulla: le approvi o le rigetti tu.`,
        "Avvia il controllo",
        async () => {
          setControllo({ fatti: 0, totale: n });
          try {
            const esito = await eseguiControlloATappeto(teamId, prep.gruppi, (fatti, totale) => setControllo({ fatti, totale }));
            const resto = esito.chiamateResidue != null ? ` (chiamate AI residue oggi: ${esito.chiamateResidue}/${esito.limite})` : "";
            if (esito.errore) {
              setEsitoControllo({ tipo: "errore", testo: `${esito.messaggio ?? "Errore"}${esito.proposteCreate ? ` — nel frattempo sono state create ${esito.proposteCreate} proposte.` : ""}` });
            } else {
              setEsitoControllo({
                tipo: "ok",
                testo: esito.proposteCreate === 0
                  ? `Controllate ${prep.atleteControllate} atlete: nessun aggiornamento necessario${resto}.`
                  : `Controllate ${prep.atleteControllate} atlete: ${esito.proposteCreate} ${esito.proposteCreate === 1 ? "proposta" : "proposte"} di aggiornamento${resto}.`,
              });
              if (esito.proposteCreate > 0) setScheda("proposte");
            }
          } catch (e) {
            setEsitoControllo({ tipo: "errore", testo: (e as Error).message });
          } finally {
            setControllo(null);
            carica();
          }
        },
      );
    } catch (e) {
      setEsitoControllo({ tipo: "errore", testo: (e as Error).message });
    }
  }

  async function onDecidi(p: EvaluationProposal) {
    try { await decidiProposta(p.id, p.valore_proposto); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
  }
  async function onRigetta(p: EvaluationProposal) {
    try { await rigettaProposta(p.id); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  const giorniPer = new Map(daValutare.map((d) => [d.athlete_id, d.giorni_dall_ultima] as const));
  const q = ricerca.trim().toLowerCase();
  const corrisponde = (a: { nome: string; cognome: string; numero_maglia?: number | string | null }) =>
    !q || `${a.nome} ${a.cognome} ${a.numero_maglia ?? ""}`.toLowerCase().includes(q);
  const righe = (scheda === "da_valutare" ? atlete.filter((a) => giorniPer.has(a.id)) : atlete)
    .filter(corrisponde)
    .sort((a, b) => {
      // Le più "scoperte" per prime: mai valutate, poi dalla valutazione più vecchia.
      const ga = giorniPer.has(a.id) ? (giorniPer.get(a.id) ?? 9999) : -1;
      const gb = giorniPer.has(b.id) ? (giorniPer.get(b.id) ?? 9999) : -1;
      return gb - ga;
    });
  const proposteFiltrate = proposte.filter((p) => { const a = atlete.find((x) => x.id === p.athlete_id); return !a || corrisponde(a); });

  return (
    <>
      <View style={[stileFisso, styles.bloccoFisso]}>
        <View style={styles.rigaRicerca}>
          <View style={{ flex: 1 }}>
            <BarraRicerca value={ricerca} onChangeText={setRicerca} placeholder="Cerca atleta" accessibilityLabel="Cerca un'atleta" />
          </View>
          <MenuAzioni
            titolo="Valutazioni"
            voci={[{ etichetta: "Controllo AI su tutta la rosa", icona: "sparkles-outline", sotto: "L'AI rilegge lo storico e propone aggiornamenti", onPress: avviaControllo }, { etichetta: "Cadenza delle valutazioni", icona: "timer-outline", sotto: "Ogni quanti giorni un'atleta torna \"da valutare\"", onPress: () => setCadenzaInModifica(true) }]}
          />
        </View>
        <View style={styles.segmenti} accessibilityRole="tablist">
          {([["da_valutare", "Da valutare", daValutare.length], ["tutte", "Tutte", atlete.length], ["proposte", "Proposte AI", proposte.length]] as const).map(([k, etichetta, n]) => (
            <Pressable key={k} onPress={() => setScheda(k)} style={[styles.segmento, scheda === k && styles.segmentoAttivo]} accessibilityRole="tab" accessibilityState={{ selected: scheda === k }}>
              <Text style={[styles.segmentoTesto, scheda === k && styles.segmentoTestoAttivo]} numberOfLines={1}>{etichetta} {n}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ gap: 12 }}>
      <Pressable
        onPress={avviaControllo}
        disabled={!!controllo}
        style={[styles.bottoneControllo, !!controllo && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel="Controllo AI su tutta la rosa"
      >
        <Text style={styles.bottoneControlloTesto}>{controllo ? `Controllo in corso… ${controllo.fatti}/${controllo.totale}` : "✨ Controllo AI su tutta la rosa"}</Text>
        {!controllo && <Text style={styles.bottoneControlloSotto}>Suggerisce gli aggiornamenti dove servono</Text>}
      </Pressable>
      {esitoControllo && (
        <Text style={[styles.messaggio, esitoControllo.tipo === "errore" && styles.messaggioErrore, esitoControllo.tipo === "ok" && styles.messaggioOk]}>{esitoControllo.testo}</Text>
      )}
      {cadenzaInModifica && (
        <View style={[styles.scheda, styles.rigaCadenza]}>
          <TextInput style={styles.inputCadenza} keyboardType="numeric" value={cadenza} onChangeText={setCadenza} />
          <Text style={[styles.vuoto, { flex: 1 }]}>giorni tra una valutazione e l'altra</Text>
          <Pressable onPress={salvaCadenza} style={styles.bottoneSecondarioPill}><Text style={styles.bottoneSecondarioPillTesto}>Salva</Text></Pressable>
          <Pressable onPress={() => setCadenzaInModifica(false)} hitSlop={8}><Text style={styles.linkCadenza}>Chiudi</Text></Pressable>
        </View>
      )}

      {scheda === "da_valutare" && daValutare.length > 0 && !q && <RinvioPromemoria teamId={teamId} tipo="valutazioni" />}

      {scheda !== "proposte" && (
        righe.length === 0 ? (
          <View style={[styles.scheda, { padding: 16 }]}>
            <Text style={styles.vuoto}>{q ? "Nessuna atleta trovata." : scheda === "da_valutare" ? "Sono tutte valutate di recente." : "Nessuna atleta in rosa."}</Text>
          </View>
        ) : (
          <View style={styles.scheda}>
            {righe.map((a, i) => {
              const giorni = giorniPer.get(a.id);
              const dovuta = giorniPer.has(a.id);
              return (
                <View key={a.id}>
                  {i > 0 && <View style={[styles.separatore, { marginLeft: 66 }]} />}
                  <Pressable style={styles.rigaAtleta} onPress={() => setAtletaAperta(a)} accessibilityRole="button" accessibilityLabel={`Valuta ${a.nome} ${a.cognome}`}>
                    <View style={styles.avatar}><Text style={styles.avatarTesto}>{testoAvatar(a.numero_maglia, a.nome, a.cognome)}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nomeAtleta} numberOfLines={1}>{a.nome} {a.cognome}</Text>
                      {!!a.ruolo_campo && <Text style={styles.sottoAtleta} numberOfLines={1}>{a.ruolo_campo}</Text>}
                    </View>
                    <Text style={[styles.rigaAndamentoValore, dovuta && giorni === null && styles.valoreMaiValutata, !dovuta && styles.valoreRecente]}>
                      {!dovuta ? "di recente" : giorni === null ? "mai valutata" : `${giorni} gg fa`}
                    </Text>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )
      )}

      {scheda === "proposte" && (
        <View style={styles.scheda}>
          {proposteFiltrate.length === 0 && <Text style={[styles.vuoto, { padding: 16 }]}>Nessuna proposta in attesa. Le trovi qui quando chiedi un suggerimento all'AI e non lo registri subito.</Text>}
          {proposteFiltrate.map((item, i) => {
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
                    <Pressable style={styles.bottoneSecondario} onPress={() => onDecidi(item)}><Text style={styles.bottoneSecondarioTesto}>Approva</Text></Pressable>
                    <Pressable style={styles.bottoneSecondarioRigetta} onPress={() => onRigetta(item)}><Text style={styles.bottoneSecondarioRigettaTesto}>Rigetta</Text></Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
      </View>

      <FoglioValutazione teamId={teamId} atleta={atletaAperta} onChiudi={() => setAtletaAperta(null)} onSalvato={() => { setAtletaAperta(null); carica(); }} onAggiorna={carica} />
    </>
  );
}

/** Foglio dal basso per valutare un'atleta: tutti i fondamentali con punteggio da 1 a 10 e suggerimento AI per ciascuno. */
function FoglioValutazione({ teamId, atleta, onChiudi, onSalvato, onAggiorna }: {
  teamId: string; atleta: Athlete | null; onChiudi: () => void; onSalvato: () => void; onAggiorna: () => void;
}) {
  const [voti, setVoti] = useState<Partial<Record<Fondamentale, number>>>({});
  const [ultimi, setUltimi] = useState<Partial<Record<Fondamentale, number>>>({});
  const [proposte, setProposte] = useState<Partial<Record<Fondamentale, EvaluationProposal>>>({});
  const [generando, setGenerando] = useState<Fondamentale | null>(null);
  const [contesto, setContesto] = useState("");
  const [mostraContesto, setMostraContesto] = useState(false);
  const [messaggio, setMessaggio] = useState<{ tipo: "ok" | "errore" | "avviso"; testo: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const trascina = useTrascinaPerChiudere(onChiudi);

  useEffect(() => {
    setVoti({}); setUltimi({}); setProposte({}); setContesto(""); setMostraContesto(false); setMessaggio(null); setGenerando(null);
    if (!atleta) return;
    let attivo = true;
    Promise.all(fondamentali.map((f) => elencaValutazioni(atleta.id, f).then((l) => [f, l[0]?.punteggio] as const).catch(() => [f, undefined] as const)))
      .then((coppie) => { if (!attivo) return; const m: Partial<Record<Fondamentale, number>> = {}; for (const [f, v] of coppie) if (v != null) m[f] = v; setUltimi(m); });
    return () => { attivo = false; };
  }, [atleta]);

  async function suggerisci(f: Fondamentale) {
    if (!atleta) return;
    setGenerando(f);
    setMessaggio({ tipo: "avviso", testo: uiStrings.valutazioni.aiGenerating });
    try {
      const storico = (await elencaValutazioni(atleta.id, f)).slice(0, 5).map((v) => ({ punteggio: v.punteggio, data: v.data_valutazione }));
      const r = await generaPropostaValutazioneAI(teamId, atleta.id, `${atleta.nome} ${atleta.cognome}`, f, storico, contesto);
      if (r.errore || !r.proposta) { setMessaggio({ tipo: "errore", testo: `${r.messaggio} — puoi scegliere il punteggio a mano.` }); return; }
      const p = r.proposta;
      setProposte((prec) => ({ ...prec, [f]: p }));
      setVoti((prec) => ({ ...prec, [f]: p.valore_proposto }));
      setMessaggio({ tipo: "ok", testo: `${f}: suggerito ${p.valore_proposto} (confidenza ${p.confidenza}, ${r.chiamateResidue}/${r.limite} chiamate residue oggi). ${p.motivazione} — cambialo pure se non sei d'accordo.` });
      onAggiorna();
    } catch (e) {
      setMessaggio({ tipo: "errore", testo: `${(e as Error).message} — puoi scegliere il punteggio a mano.` });
    } finally {
      setGenerando(null);
    }
  }

  async function salva() {
    if (!atleta) return;
    const scelti = fondamentali.filter((f) => voti[f] != null);
    if (scelti.length === 0) return;
    setSalvando(true);
    try {
      for (const f of scelti) {
        const valore = voti[f] as number;
        const p = proposte[f];
        if (p) await decidiProposta(p.id, valore);
        else await registraValutazione(teamId, atleta.id, f, valore);
      }
      onSalvato();
    } catch (e) {
      setMessaggio({ tipo: "errore", testo: (e as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  const quanti = fondamentali.filter((f) => voti[f] != null).length;

  return (
    <Modal visible={!!atleta} animationType="fade" transparent onRequestClose={onChiudi}>
      <Pressable style={styles.sfondoFoglio} onPress={onChiudi}>
        <Animated.View style={[styles.cartaFoglio, trascina.stile]} onStartShouldSetResponder={() => true}>
          <View {...trascina.panHandlers} style={styles.testaFoglio}>
            <View style={styles.manigliaFoglio} />
            {!!atleta && (
              <View style={styles.rigaAtletaSenzaPadding}>
                <View style={styles.avatar}><Text style={styles.avatarTesto}>{testoAvatar(atleta.numero_maglia, atleta.nome, atleta.cognome)}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.titoloFoglio} numberOfLines={1}>{atleta.nome} {atleta.cognome}</Text>
                  {!!atleta.ruolo_campo && <Text style={styles.sottoAtleta}>{atleta.ruolo_campo}</Text>}
                </View>
                <Pressable onPress={onChiudi} hitSlop={10} accessibilityLabel="Chiudi"><Text style={styles.chiudiFoglio}>✕</Text></Pressable>
              </View>
            )}
          </View>

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 14, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
            {fondamentali.map((f) => (
              <View key={f} style={{ gap: 6 }}>
                <View style={styles.rigaFondamentale}>
                  <Text style={styles.nomeFondamentale}>{f}</Text>
                  {ultimi[f] != null && <Text style={styles.ultimoVoto}>ultimo: {ultimi[f]}</Text>}
                  {voti[f] != null && !Number.isInteger(voti[f]) && <Text style={styles.votoMezzo}>→ {voti[f]}</Text>}
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={() => suggerisci(f)} disabled={generando !== null} hitSlop={8} style={[styles.tastoAI, generando !== null && { opacity: 0.5 }]} accessibilityLabel={`Suggerimento AI per ${f}`}>
                    <Text style={styles.tastoAITesto}>{generando === f ? "…" : "✨ AI"}</Text>
                  </Pressable>
                </View>
                <View style={styles.rigaVoti}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => setVoti((prec) => { const nuovo = { ...prec }; if (prec[f] === n) delete nuovo[f]; else nuovo[f] = n; return nuovo; })}
                      style={[styles.voto, voti[f] === n && styles.votoAttivo]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: voti[f] === n }}
                      accessibilityLabel={`${f} ${n}`}
                    >
                      <Text style={[styles.votoTesto, voti[f] === n && styles.votoTestoAttivo]}>{n}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}

            {mostraContesto ? (
              <TextInput
                style={[styles.input, { minHeight: 52, textAlignVertical: "top" }]}
                multiline
                placeholder="Contesto per l'AI: es. rientra da infortunio, ha cambiato ruolo, poche presenze"
                placeholderTextColor={brand.colors.muted}
                maxLength={500}
                value={contesto}
                onChangeText={setContesto}
              />
            ) : (
              <Pressable onPress={() => setMostraContesto(true)} style={styles.linkRiga}><Text style={styles.linkCadenza}>+ Aggiungi contesto per l'AI</Text></Pressable>
            )}

            {messaggio && <Text style={[styles.messaggio, messaggio.tipo === "errore" && styles.messaggioErrore, messaggio.tipo === "ok" && styles.messaggioOk]}>{messaggio.testo}</Text>}
          </ScrollView>

          <Pressable onPress={salva} disabled={quanti === 0 || salvando} style={[styles.bottonePrimarioFoglio, (quanti === 0 || salvando) && { opacity: 0.4 }]} accessibilityRole="button">
            <Text style={styles.bottonePrimarioTesto}>{salvando ? "Salvo…" : quanti === 0 ? "Scegli almeno un punteggio" : quanti === 1 ? "Salva 1 valutazione" : `Salva ${quanti} valutazioni`}</Text>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
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
  bottoneControllo: { backgroundColor: brand.colors.surfaceSecondary, borderWidth: 1, borderColor: brand.colors.brand, borderRadius: 16, minHeight: 56, paddingVertical: 10, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", gap: 2 },
  bottoneControlloTesto: { color: brand.colors.brand, fontSize: 16, fontWeight: "700" },
  bottoneControlloSotto: { color: brand.colors.muted, fontSize: 12 },
  bloccoFisso: { marginHorizontal: -16, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10, gap: 10, marginBottom: 14 },
  rigaRicerca: { flexDirection: "row", alignItems: "center", gap: 10 },
  segmenti: { flexDirection: "row", backgroundColor: "rgba(118,118,128,0.24)", borderRadius: 10, padding: 2 },
  segmento: { flex: 1, minHeight: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  segmentoAttivo: { backgroundColor: brand.colors.surfaceTertiary },
  segmentoTesto: { color: brand.colors.muted, fontSize: 13, fontWeight: "600" },
  segmentoTestoAttivo: { color: brand.colors.onSurface },
  sottoAtleta: { color: brand.colors.muted, fontSize: 13 },
  valoreRecente: { color: brand.colors.muted, fontWeight: "500" },
  chevron: { color: brand.colors.muted, fontSize: 22, marginLeft: 2 },
  sfondoFoglio: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end", padding: 8 },
  cartaFoglio: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 20, padding: 16, gap: 12, maxHeight: "92%", maxWidth: 560, width: "100%", alignSelf: "center" },
  testaFoglio: { gap: 10 },
  manigliaFoglio: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.22)" },
  titoloFoglio: { color: brand.colors.onSurface, fontSize: 19, fontWeight: "700" },
  chiudiFoglio: { color: brand.colors.muted, fontSize: 18, fontWeight: "700", padding: 4 },
  rigaFondamentale: { flexDirection: "row", alignItems: "center", gap: 10 },
  nomeFondamentale: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  votoMezzo: { color: brand.colors.brand, fontSize: 14, fontWeight: "800" },
  ultimoVoto: { color: brand.colors.muted, fontSize: 13 },
  tastoAI: { minHeight: 32, paddingHorizontal: 12, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  tastoAITesto: { color: brand.colors.brand, fontSize: 13, fontWeight: "700" },
  rigaVoti: { flexDirection: "row", gap: 4 },
  voto: { flex: 1, height: 36, borderRadius: 10, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  votoAttivo: { backgroundColor: brand.colors.brand },
  votoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14, fontWeight: "600" },
  votoTestoAttivo: { color: "#000", fontWeight: "800" },
  bottonePrimarioFoglio: { backgroundColor: brand.colors.brand, minHeight: 48, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
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
