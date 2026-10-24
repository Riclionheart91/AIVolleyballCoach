import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, TextInput, Modal, ScrollView } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  aggiornaEsercizioPiano, aggiungiEsercizioAlPiano, aggiungiEsercizioPiano, avanzamentoGruppo, bozzaDaEsercizioPiano, cambiaStatoPianoGruppo, copiaPianoSuPersone, creaPianoIndividuale, elencaEserciziPiano,
  elencaPianiIndividuali, eliminaEsercizioPiano, eliminaPianoGruppo, generaPianoIndividualeAI, impostaSvolgimentiSettimana, riallineaEsercizio, sostituisciEsercizioPiano, svolgimentiDellaSettimana, togliDalGruppo,
  type Ambito, type BozzaEsercizio, type EsercizioPiano, type MembroGruppo, type PianoIndividuale,
} from "@/src/services/pianiIndividuali";
import { elencaEsercizi } from "@/src/services/exercises";
import { elencaAtlete } from "@/src/services/athletes";
import { EditorEsercizio } from "@/src/components/piani/EditorEsercizio";
import { NuovoPianoForm } from "@/src/components/piani/NuovoPianoForm";
import { SelettorePersone } from "@/src/components/piani/SelettorePersone";
import { SceltaAmbito } from "@/src/components/piani/SceltaAmbito";
import type { Athlete } from "@/src/types/database";
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
  const [editor, setEditor] = useState<{ modo: "aggiungi" | "modifica" | "sostituisci"; piano: PianoIndividuale; esercizio?: EsercizioPiano } | null>(null);
  const [squadra, setSquadra] = useState<Athlete[]>([]);
  const [nuovoPiano, setNuovoPiano] = useState(false);
  const [assegna, setAssegna] = useState<PianoIndividuale | null>(null);
  const [selAssegna, setSelAssegna] = useState<Set<string>>(new Set());
  // Piano condiviso: prima di cambiarlo si chiede se vale per la persona o per tutto il gruppo.
  const [ambitoRichiesto, setAmbitoRichiesto] = useState<{ titolo: string; persone: number; testo?: string; distruttiva?: boolean; azione: (a: Ambito) => Promise<void> } | null>(null);
  const [gruppoAperto, setGruppoAperto] = useState<PianoIndividuale | null>(null);
  const [membri, setMembri] = useState<MembroGruppo[]>([]);
  const [personeNelGruppo, setPersoneNelGruppo] = useState<Set<string>>(new Set());

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

  async function ricaricaEsercizi(pianoId: string) {
    try {
      setEsercizi(await elencaEserciziPiano(pianoId));
      setSvolgimentiSettimana(await svolgimentiDellaSettimana(pianoId));
    } catch (e) { avvisa("Errore", (e as Error).message); }
    carica();
  }

  async function caricaSquadra() {
    if (squadra.length === 0) setSquadra(await elencaAtlete(teamId).catch(() => []));
  }

  const inGruppo = (p: PianoIndividuale) => !!p.gruppo_id && p.persone_gruppo > 1;

  /** Piano condiviso: chiede su chi vale la modifica; piano di una persona sola: la esegue subito. */
  function chiediAmbito(piano: PianoIndividuale, condiviso: boolean, titolo: string, azione: (a: Ambito) => Promise<void>, opzioni?: { testo?: string; distruttiva?: boolean }) {
    if (condiviso) setAmbitoRichiesto({ titolo, persone: piano.persone_gruppo, azione, ...opzioni });
    else azione("singolo").catch((e) => avvisa("Errore", (e as Error).message));
  }

  async function eseguiAmbito(a: Ambito) {
    const r = ambitoRichiesto;
    setAmbitoRichiesto(null);
    if (!r) return;
    try { await r.azione(a); }
    catch (e) { avvisa("Errore", (e as Error).message); }
  }

  function avvisaSaltati(saltati: number) {
    if (saltati > 0) {
      avvisa("Fatto", `${saltati} ${saltati === 1 ? "persona ha" : "persone hanno"} una versione personalizzata di questo esercizio: non è stata toccata.`);
    }
  }

  function salvaEditor(b: BozzaEsercizio) {
    if (!editor) return;
    const { modo, piano, esercizio } = editor;
    setEditor(null);
    const condiviso = inGruppo(piano) && (modo === "aggiungi" || !!esercizio?.voce_id);
    const titolo = modo === "aggiungi" ? "Aggiungere l'esercizio" : modo === "sostituisci" ? "Sostituire l'esercizio" : "Modificare l'esercizio";
    chiediAmbito(piano, condiviso, titolo, async (ambito) => {
      let saltati = 0;
      if (modo === "aggiungi") await aggiungiEsercizioAlPiano(piano, b, ambito);
      else if (modo === "modifica" && esercizio) saltati = await aggiornaEsercizioPiano(esercizio, b, ambito);
      else if (modo === "sostituisci" && esercizio) saltati = await sostituisciEsercizioPiano(esercizio, b, ambito);
      await ricaricaEsercizi(piano.id);
      avvisaSaltati(saltati);
    });
  }

  function togliEsercizio(piano: PianoIndividuale, pe: EsercizioPiano) {
    const nome = pe.nome_libero ?? "Esercizio";
    const esegui = async (ambito: Ambito) => {
      const saltati = await eliminaEsercizioPiano(pe, ambito);
      await ricaricaEsercizi(piano.id);
      avvisaSaltati(saltati);
    };
    if (inGruppo(piano) && pe.voce_id) {
      chiediAmbito(piano, true, `Togliere "${nome}"`, esegui, { testo: "Le sedute già spuntate di questo esercizio vanno perse.", distruttiva: true });
    } else {
      confermaAzione("Togliere l'esercizio?", `"${nome}" esce dal piano, insieme alle sedute già spuntate.`, "Togli", async () => {
        try { await esegui("singolo"); } catch (e) { avvisa("Errore", (e as Error).message); }
      }, true);
    }
  }

  async function riallinea(piano: PianoIndividuale, pe: EsercizioPiano) {
    try { await riallineaEsercizio(pe); await ricaricaEsercizi(piano.id); }
    catch (e) { avvisa("Errore", (e as Error).message); }
  }

  function cambiaStato(p: PianoIndividuale) {
    const nuovo = p.stato === "attivo" ? "concluso" : "attivo";
    chiediAmbito(p, inGruppo(p), nuovo === "concluso" ? "Concludere il piano" : "Riattivare il piano", async (ambito) => {
      await cambiaStatoPianoGruppo(p, nuovo, ambito);
      carica();
    });
  }

  function eliminaPiano(p: PianoIndividuale) {
    const esegui = async (ambito: Ambito) => {
      await eliminaPianoGruppo(p, ambito);
      setEspanso(null); carica();
    };
    if (inGruppo(p)) {
      chiediAmbito(p, true, "Eliminare il piano", esegui, { testo: "Verranno persi anche gli svolgimenti registrati.", distruttiva: true });
    } else {
      confermaAzione("Eliminare il piano?", "Verranno persi anche gli svolgimenti registrati.", "Elimina", async () => {
        try { await esegui("singolo"); } catch (e) { avvisa("Errore", (e as Error).message); }
      }, true);
    }
  }

  async function apriGruppo(p: PianoIndividuale) {
    setGruppoAperto(p);
    setMembri([]);
    try { setMembri(await avanzamentoGruppo(p.id)); }
    catch (e) { avvisa("Errore", (e as Error).message); }
  }

  function togliPersonaDalGruppo(m: MembroGruppo) {
    confermaAzione(
      "Togliere dal gruppo?",
      `${m.nome} tiene il suo piano così com'è, ma non cambia più insieme agli altri.`,
      "Togli dal gruppo",
      async () => {
        try {
          await togliDalGruppo(m.piano_id);
          if (gruppoAperto) setMembri(await avanzamentoGruppo(gruppoAperto.id).catch(() => []));
          carica();
        } catch (e) { avvisa("Errore", (e as Error).message); }
      },
    );
  }

  async function apriAssegna(p: PianoIndividuale) {
    await caricaSquadra();
    setSelAssegna(new Set());
    if (inGruppo(p)) {
      const m = await avanzamentoGruppo(p.id).catch(() => [] as MembroGruppo[]);
      setPersoneNelGruppo(new Set(m.map((x) => x.athlete_id)));
    } else {
      setPersoneNelGruppo(new Set());
    }
    setGruppoAperto(null);
    setAssegna(p);
  }

  async function confermaAssegna() {
    if (!assegna || selAssegna.size === 0) return;
    try {
      const n = await copiaPianoSuPersone(assegna, Array.from(selAssegna));
      setAssegna(null);
      carica();
      avvisa("Piano assegnato", `${n} ${n === 1 ? "persona entra" : "persone entrano"} nel gruppo: le modifiche di gruppo valgono anche per ${n === 1 ? "lei" : "loro"}. Ognuna spunta le sue sedute.`);
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

            {modificabile && inGruppo(p) && (
              <Pressable onPress={() => apriGruppo(p)} hitSlop={6}>
                <Text style={styles.gruppoLink}>👥 Piano condiviso da {p.persone_gruppo} persone · chi c'è e a che punto sono ▸</Text>
              </Pressable>
            )}

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
                      {modificabile && inGruppo(p) && (pe.personalizzato || !pe.voce_id) && (
                        <Text style={styles.personalizzato}>
                          {pe.personalizzato ? `✏️ Versione personalizzata per ${nomePersona.split(" ")[0]}: le modifiche di gruppo la saltano` : `✏️ Solo per ${nomePersona.split(" ")[0]}`}
                        </Text>
                      )}
                      {modificabile && (
                        <View style={styles.rigaModifica}>
                          <Pressable onPress={() => setEditor({ modo: "modifica", piano: p, esercizio: pe })} hitSlop={8}><Text style={styles.azione}>Modifica</Text></Pressable>
                          <Pressable onPress={() => setEditor({ modo: "sostituisci", piano: p, esercizio: pe })} hitSlop={8}><Text style={styles.azione}>Sostituisci</Text></Pressable>
                          {pe.personalizzato && <Pressable onPress={() => riallinea(p, pe)} hitSlop={8}><Text style={styles.azione}>Riallinea al gruppo</Text></Pressable>}
                          <Pressable onPress={() => togliEsercizio(p, pe)} hitSlop={8}><Text style={styles.azioneDistruttiva}>Togli</Text></Pressable>
                        </View>
                      )}
                    </View>
                  </View>
                ))}
                <Text style={styles.nota}>Tocca i quadratini numerati per segnare le sedute svolte questa settimana.</Text>
                {modificabile && (
                  <Pressable style={styles.bottoneAggiungi} onPress={() => setEditor({ modo: "aggiungi", piano: p })}>
                    <Text style={styles.bottoneAggiungiTesto}>+ Aggiungi esercizio</Text>
                  </Pressable>
                )}

                {modificabile && (
                  <View style={styles.rigaAzioni}>
                    <Pressable onPress={() => apriAssegna(p)}><Text style={styles.azione}>{inGruppo(p) ? "Aggiungi persone al gruppo" : "Assegna ad altre persone"}</Text></Pressable>
                    <Pressable onPress={() => cambiaStato(p)}>
                      <Text style={styles.azione}>{p.stato === "attivo" ? "Concludi" : "Riattiva"}</Text>
                    </Pressable>
                    <Pressable onPress={() => eliminaPiano(p)}>
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
                : <Text style={styles.bottoneAITesto}>✨ Crea con l'AI</Text>}
            </Pressable>
            <Pressable style={styles.bottoneAI} onPress={async () => { await caricaSquadra(); setNuovoPiano(true); }}>
              <Text style={styles.bottoneAITesto}>✍️ Piano a mano</Text>
            </Pressable>
          </View>
        </>
      )}

      {editor && (
        <EditorEsercizio
          visibile
          teamId={teamId}
          titolo={editor.modo === "aggiungi" ? "Aggiungi un esercizio" : editor.modo === "sostituisci" ? "Sostituisci con un altro esercizio" : "Modifica esercizio"}
          iniziale={editor.modo === "modifica" && editor.esercizio ? bozzaDaEsercizioPiano(editor.esercizio) : null}
          onChiudi={() => setEditor(null)}
          onSalva={salvaEditor}
        />
      )}

      <Modal visible={nuovoPiano} animationType="slide" transparent onRequestClose={() => setNuovoPiano(false)}>
        <View style={styles.sfondoModale}>
          <ScrollView style={{ maxHeight: "94%" }} contentContainerStyle={{ padding: 4 }} keyboardShouldPersistTaps="handled">
            <NuovoPianoForm
              teamId={teamId}
              atlete={squadra}
              preselezionate={[athleteId]}
              onAnnulla={() => setNuovoPiano(false)}
              onCreato={() => { setNuovoPiano(false); carica(); avvisa("Piano creato", "Lo trovi qui sotto."); }}
            />
          </ScrollView>
        </View>
      </Modal>

      <SceltaAmbito
        visibile={!!ambitoRichiesto}
        titolo={ambitoRichiesto?.titolo ?? ""}
        testo={ambitoRichiesto?.testo}
        nomePersona={nomePersona}
        persone={ambitoRichiesto?.persone ?? 2}
        distruttiva={ambitoRichiesto?.distruttiva}
        onScegli={eseguiAmbito}
        onAnnulla={() => setAmbitoRichiesto(null)}
      />

      <Modal visible={!!gruppoAperto} animationType="slide" transparent onRequestClose={() => setGruppoAperto(null)}>
        <View style={styles.sfondoModale}>
          <View style={styles.cartaModale}>
            <Text style={styles.titolo}>{gruppoAperto?.titolo}</Text>
            <Text style={styles.nota}>Chi ha questo piano e quante sedute ha fatto negli ultimi 7 giorni su quelle previste.</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {membri.length === 0 ? <ActivityIndicator color={brand.colors.brand} /> : membri.map((m) => {
                const perc = m.attesi > 0 ? Math.min(100, Math.round((m.svolti / m.attesi) * 100)) : 0;
                return (
                  <View key={m.piano_id} style={styles.rigaMembro}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nomeEsercizio}>{m.nome} {m.cognome}{m.stato !== "attivo" ? ` · ${m.stato}` : ""}</Text>
                      <View style={styles.barraSfondo}><View style={[styles.barraRiempimento, { width: `${perc}%` }]} /></View>
                      <Text style={styles.dettaglio}>{m.svolti}/{m.attesi} sedute · {perc}%</Text>
                    </View>
                    {membri.length > 1 && (
                      <Pressable onPress={() => togliPersonaDalGruppo(m)} hitSlop={8}><Text style={styles.azioneDistruttiva}>Togli</Text></Pressable>
                    )}
                  </View>
                );
              })}
            </ScrollView>
            {gruppoAperto && (
              <Pressable style={styles.bottoneAI} onPress={() => apriAssegna(gruppoAperto)}>
                <Text style={styles.bottoneAITesto}>+ Aggiungi persone</Text>
              </Pressable>
            )}
            <Pressable onPress={() => setGruppoAperto(null)}><Text style={styles.nota}>Chiudi</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!assegna} animationType="slide" transparent onRequestClose={() => setAssegna(null)}>
        <View style={styles.sfondoModale}>
          <View style={styles.cartaModale}>
            <Text style={styles.titolo}>Assegna "{assegna?.titolo}" ad altre persone</Text>
            <Text style={styles.nota}>Ognuna riceve una copia con gli stessi esercizi e spunta le sue sedute. Le copie restano collegate: potrai cambiarle tutte insieme.</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              <SelettorePersone atlete={squadra.filter((a) => a.id !== athleteId && !personeNelGruppo.has(a.id))} selezionate={selAssegna} onChange={setSelAssegna} />
            </ScrollView>
            <Pressable style={[styles.bottoneAI, selAssegna.size === 0 && { opacity: 0.4 }]} onPress={confermaAssegna} disabled={selAssegna.size === 0}>
              <Text style={styles.bottoneAITesto}>Assegna a {selAssegna.size} {selAssegna.size === 1 ? "persona" : "persone"}</Text>
            </Pressable>
            <Pressable onPress={() => setAssegna(null)}><Text style={styles.nota}>Annulla</Text></Pressable>
          </View>
        </View>
      </Modal>
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
  rigaModifica: { flexDirection: "row", gap: 16, marginTop: 6 },
  bottoneAggiungi: { borderWidth: 1, borderColor: brand.colors.brand, borderRadius: 8, padding: 10, alignItems: "center" },
  bottoneAggiungiTesto: { color: brand.colors.brand, fontWeight: "600" },
  sfondoModale: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 16 },
  cartaModale: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 18, gap: 10 },
  rigaAzioni: { flexDirection: "row", justifyContent: "flex-end", gap: 16, flexWrap: "wrap" },
  azione: { color: brand.colors.brand, fontSize: 13, fontWeight: "600" },
  azioneDistruttiva: { color: brand.colors.error, fontSize: 13, fontWeight: "600" },
  nota: { color: brand.colors.muted, fontSize: 12, lineHeight: 17 },
  gruppoLink: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "600" },
  personalizzato: { color: brand.colors.muted, fontSize: 11, marginTop: 2, fontStyle: "italic" },
  rigaMembro: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10, minHeight: 56, textAlignVertical: "top" },
  rigaGenerazione: { flexDirection: "row", gap: 8 },
  bottoneAI: { flex: 1, borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  bottoneAITesto: { color: brand.colors.brandSecondary, fontWeight: "700" },
  bottoneNota: { width: 44, borderWidth: 1, borderColor: brand.colors.muted, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  bottoneNotaTesto: { color: brand.colors.muted, fontSize: 20, fontWeight: "700" },
});
