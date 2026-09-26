import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Modal } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import {
  elencaSquadreSocieta,
  creaSquadraInSocieta,
  assegnaCollaboratoreSquadra,
  rimuoviCollaboratoreSquadra,
  rinominaSquadra,
  eliminaSquadra,
  elencaPresidentiSocieta,
  invitaPresidenteSocieta,
  rimuoviPresidenteSocieta,
  type SquadraSocieta,
  type Presidente,
} from "@/src/services/societa";
import {
  apriPrimaStagioneSocieta,
  attivaSquadraInStagione,
  disattivaSquadraInStagione,
  spostaAtletaSquadra,
  storicoStagioniSquadra,
  type StoricoStagione,
} from "@/src/services/seasons";
import { elencaAtlete } from "@/src/services/athletes";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import type { Athlete } from "@/src/types/database";

/**
 * L'organico della società: qui il presidente vede tutte le squadre del
 * proprio club, ne crea di nuove, assegna chi le allena, le rinomina o
 * le elimina, sposta atleti tra squadre, e le attiva per la stagione
 * corrente. La gestione fine dell'organico (inviti, ruoli, scout) resta
 * in Gestione squadra — "Gestisci organico" ci porta direttamente,
 * cambiando prima la squadra corrente.
 */
export default function GestioneSocieta() {
  const { societaPresidenza, stagioneSocietaEsiste, cambiaSquadra, ricaricaContesto } = useAuth();
  const [squadre, setSquadre] = useState<SquadraSocieta[]>([]);
  const [caricamento, setCaricamento] = useState(true);

  const [presidenti, setPresidenti] = useState<Presidente[]>([]);
  const [emailNuovoPresidente, setEmailNuovoPresidente] = useState("");
  const [invitandoPresidente, setInvitandoPresidente] = useState(false);

  const [nomeNuova, setNomeNuova] = useState("");
  const [creando, setCreando] = useState(false);

  const [nomeStagione, setNomeStagione] = useState("");
  const [apertura, setApertura] = useState(false);

  const [squadraPerCollaboratore, setSquadraPerCollaboratore] = useState<SquadraSocieta | null>(null);
  const [ruoloCollaboratore, setRuoloCollaboratore] = useState<"allenatore" | "vice_allenatore">("allenatore");
  const [emailCollaboratore, setEmailCollaboratore] = useState("");

  const [inCorsoAttivazione, setInCorsoAttivazione] = useState<string | null>(null);

  const [squadraPerRinomina, setSquadraPerRinomina] = useState<SquadraSocieta | null>(null);
  const [nomeRinomina, setNomeRinomina] = useState("");
  const [rinominando, setRinominando] = useState(false);

  const [squadraPerEliminazione, setSquadraPerEliminazione] = useState<SquadraSocieta | null>(null);
  const [nomeConfermaEliminazione, setNomeConfermaEliminazione] = useState("");
  const [eliminando, setEliminando] = useState(false);

  const [spostamentoAperto, setSpostamentoAperto] = useState(false);
  const [squadraOrigine, setSquadraOrigine] = useState<SquadraSocieta | null>(null);
  const [atletiOrigine, setAtletiOrigine] = useState<Athlete[]>([]);
  const [atletaScelto, setAtletaScelto] = useState<Athlete | null>(null);
  const [squadraDestinazione, setSquadraDestinazione] = useState<SquadraSocieta | null>(null);
  const [spostando, setSpostando] = useState(false);

  const [squadraPerStorico, setSquadraPerStorico] = useState<SquadraSocieta | null>(null);
  const [storico, setStorico] = useState<StoricoStagione[]>([]);
  const [storicoCaricamento, setStoricoCaricamento] = useState(false);

  const carica = useCallback(async () => {
    if (!societaPresidenza) return;
    setCaricamento(true);
    try {
      const [s, p] = await Promise.all([
        elencaSquadreSocieta(societaPresidenza.societa_id),
        elencaPresidentiSocieta(societaPresidenza.societa_id),
      ]);
      setSquadre(s);
      setPresidenti(p);
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCaricamento(false);
    }
  }, [societaPresidenza]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function onCreaSquadra() {
    if (!societaPresidenza || !nomeNuova.trim()) return;
    setCreando(true);
    try {
      await creaSquadraInSocieta(nomeNuova.trim(), societaPresidenza.societa_id);
      setNomeNuova("");
      carica();
      avvisa("Squadra creata", "Nasce senza allenatore: assegnalo quando vuoi con \"Assegna allenatore\" qui sotto.");
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCreando(false);
    }
  }

  async function onInvitaPresidente() {
    if (!societaPresidenza || !emailNuovoPresidente.trim()) return;
    setInvitandoPresidente(true);
    try {
      await invitaPresidenteSocieta(societaPresidenza.societa_id, emailNuovoPresidente.trim());
      avvisa("Invito inviato", `${emailNuovoPresidente.trim()} diventerà presidente insieme a voi al primo accesso con quell'email. Nessuno degli attuali presidenti perde il ruolo.`);
      setEmailNuovoPresidente("");
      carica();
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setInvitandoPresidente(false);
    }
  }

  function onRimuoviPresidente(p: Presidente) {
    if (!societaPresidenza) return;
    confermaAzione(
      `Rimuovere ${p.nome} dalla presidenza?`,
      "Perderà tutti i permessi di presidente su questa società. Gli altri presidenti restano invariati.",
      "Rimuovi",
      async () => {
        try {
          await rimuoviPresidenteSocieta(societaPresidenza.societa_id, p.user_id);
          carica();
        } catch (e) {
          avvisa("Errore", (e as Error).message);
        }
      },
      true,
    );
  }

  /** La società non ha mai avuto una stagione: senza una stagione aperta nessuna squadra può essere attivata. */
  async function onApriPrimaStagione() {
    if (!societaPresidenza || !nomeStagione.trim()) return;
    setApertura(true);
    try {
      await apriPrimaStagioneSocieta(societaPresidenza.societa_id, nomeStagione.trim());
      setNomeStagione("");
      await ricaricaContesto();
      carica();
      avvisa("Stagione aperta", "Ora puoi attivare le squadre una per una qui sotto.");
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setApertura(false);
    }
  }

  function apriAssegnaCollaboratore(s: SquadraSocieta, ruolo: "allenatore" | "vice_allenatore") {
    setSquadraPerCollaboratore(s);
    setRuoloCollaboratore(ruolo);
    setEmailCollaboratore("");
  }

  async function onAssegnaCollaboratore() {
    if (!squadraPerCollaboratore || !emailCollaboratore.trim()) return;
    try {
      await assegnaCollaboratoreSquadra(squadraPerCollaboratore.team_id, emailCollaboratore.trim(), ruoloCollaboratore);
      const etichetta = ruoloCollaboratore === "allenatore" ? "allenatore" : "vice-allenatore";
      avvisa("Invito inviato", `${emailCollaboratore.trim()} diventerà ${etichetta} al primo accesso con quell'email.`);
      setSquadraPerCollaboratore(null);
      setEmailCollaboratore("");
      carica();
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    }
  }

  function onRimuoviCollaboratore(s: SquadraSocieta, ruolo: "allenatore" | "vice_allenatore") {
    const etichetta = ruolo === "allenatore" ? "allenatore" : "vice-allenatore";
    const nomeAttuale = ruolo === "allenatore" ? s.allenatore_nome : s.vice_allenatore_nome;
    confermaAzione(
      `Rimuovere l'${etichetta} di ${s.nome}?`,
      `${nomeAttuale} perderà l'accesso a questa squadra. Nessuno prenderà il suo posto finché non ne assegni uno nuovo.`,
      "Rimuovi",
      async () => {
        try {
          await rimuoviCollaboratoreSquadra(s.team_id, ruolo);
          carica();
        } catch (e) {
          avvisa("Errore", (e as Error).message);
        }
      },
      true,
    );
  }

  async function apriStorico(s: SquadraSocieta) {
    setSquadraPerStorico(s);
    setStorico([]);
    setStoricoCaricamento(true);
    try {
      setStorico(await storicoStagioniSquadra(s.team_id));
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setStoricoCaricamento(false);
    }
  }

  async function onAttiva(s: SquadraSocieta) {
    setInCorsoAttivazione(s.team_id);
    try {
      await attivaSquadraInStagione(s.team_id);
      carica();
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setInCorsoAttivazione(null);
    }
  }

  function onDisattiva(s: SquadraSocieta) {
    confermaAzione(
      "Disattivare questa squadra per la stagione corrente?",
      `${s.nome} tornerà sospesa: allenatore, vice e atleti non potranno più registrare allenamenti e valutazioni finché non la riattivi.`,
      "Disattiva",
      async () => {
        setInCorsoAttivazione(s.team_id);
        try {
          await disattivaSquadraInStagione(s.team_id);
          carica();
        } catch (e) {
          avvisa("Errore", (e as Error).message);
        } finally {
          setInCorsoAttivazione(null);
        }
      },
      true,
    );
  }

  /** La vera "home" della squadra: rosa atlete, allenamenti, partite, valutazioni — tutta l'area operativa. */
  async function onEntraSquadra(s: SquadraSocieta) {
    await cambiaSquadra(s.team_id);
    router.push("/(tabs)/allenamenti");
  }

  /** Solo la gestione di chi ha accesso alla squadra (inviti, ruoli) — non la rosa/allenamenti. */
  async function onGestisciOrganico(s: SquadraSocieta) {
    await cambiaSquadra(s.team_id);
    router.push("/gestione-squadra");
  }

  function apriRinomina(s: SquadraSocieta) {
    setSquadraPerRinomina(s);
    setNomeRinomina(s.nome);
  }

  async function onRinomina() {
    if (!squadraPerRinomina || !nomeRinomina.trim()) return;
    setRinominando(true);
    try {
      await rinominaSquadra(squadraPerRinomina.team_id, nomeRinomina.trim());
      setSquadraPerRinomina(null);
      carica();
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setRinominando(false);
    }
  }

  function apriEliminazione(s: SquadraSocieta) {
    setSquadraPerEliminazione(s);
    setNomeConfermaEliminazione("");
  }

  async function onElimina() {
    if (!squadraPerEliminazione) return;
    setEliminando(true);
    try {
      await eliminaSquadra(squadraPerEliminazione.team_id, nomeConfermaEliminazione.trim());
      setSquadraPerEliminazione(null);
      carica();
      avvisa("Squadra eliminata", `${squadraPerEliminazione.nome} e tutti i suoi dati (atleti, allenamenti, valutazioni, partite) sono stati eliminati definitivamente.`);
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setEliminando(false);
    }
  }

  async function apriSpostamento(squadra: SquadraSocieta) {
    setSquadraOrigine(squadra);
    setSquadraDestinazione(null);
    setAtletaScelto(null);
    setSpostamentoAperto(true);
    setAtletiOrigine(await elencaAtlete(squadra.team_id));
  }

  async function confermaSpostamento() {
    if (!atletaScelto || !squadraDestinazione) return;
    setSpostando(true);
    try {
      await spostaAtletaSquadra(atletaScelto.id, squadraDestinazione.team_id);
      avvisa("Atleta spostato", `${atletaScelto.nome} ${atletaScelto.cognome} ora è in ${squadraDestinazione.nome}, con tutto il suo storico.`);
      setSpostamentoAperto(false);
      carica();
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setSpostando(false);
    }
  }

  if (!societaPresidenza) {
    return (
      <View style={styles.container}>
        <Text style={styles.nota}>Questa sezione è riservata al presidente di una società.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.push("/profilo")} hitSlop={12}><Text style={styles.indietro}>← Profilo</Text></Pressable>
        <Text style={styles.titolo}>{societaPresidenza.nome}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }}>
        <View style={styles.card}>
          <Text style={styles.sezione}>Presidenti della società</Text>
          {presidenti.map((p) => (
            <View key={p.user_id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View>
                <Text style={styles.dettaglioSquadra}>{p.nome}</Text>
                {p.nome !== p.email && <Text style={styles.nota}>{p.email}</Text>}
              </View>
              <Pressable onPress={() => onRimuoviPresidente(p)}>
                <Text style={styles.bottoneSecondarioDistruttivoTesto}>Rimuovi</Text>
              </Pressable>
            </View>
          ))}
          <Text style={styles.nota}>Aggiungerne uno non toglie il ruolo a chi c'è già: possono coesistere più presidenti.</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Email del nuovo presidente"
              placeholderTextColor={brand.colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={emailNuovoPresidente}
              onChangeText={setEmailNuovoPresidente}
            />
            <Pressable style={styles.bottone} onPress={onInvitaPresidente} disabled={invitandoPresidente || !emailNuovoPresidente.trim()}>
              {invitandoPresidente ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Aggiungi</Text>}
            </Pressable>
          </View>
        </View>

        {!stagioneSocietaEsiste && (
          <View style={styles.card}>
            <Text style={styles.sezione}>Apri la prima stagione</Text>
            <Text style={styles.nota}>La società non ha ancora nessuna stagione: aprila per poter attivare le squadre e iniziare a registrare allenamenti e valutazioni.</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Nome stagione (es. 2026/2027)"
                placeholderTextColor={brand.colors.muted}
                value={nomeStagione}
                onChangeText={setNomeStagione}
              />
              <Pressable style={styles.bottone} onPress={onApriPrimaStagione} disabled={apertura || !nomeStagione.trim()}>
                {apertura ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Apri</Text>}
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sezione}>Crea una nuova squadra</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Nome squadra (es. Under 16)"
              placeholderTextColor={brand.colors.muted}
              value={nomeNuova}
              onChangeText={setNomeNuova}
            />
            <Pressable style={styles.bottone} onPress={onCreaSquadra} disabled={creando || !nomeNuova.trim()}>
              {creando ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Crea</Text>}
            </Pressable>
          </View>
          <Text style={styles.nota}>Nasce senza allenatore: lo assegni quando vuoi, anche più tardi.</Text>
        </View>

        <Text style={styles.sezione}>Le squadre della società ({squadre.length})</Text>
        {caricamento ? (
          <ActivityIndicator color={brand.colors.brand} />
        ) : squadre.length === 0 ? (
          <Text style={styles.nota}>Nessuna squadra ancora: creane una qui sopra.</Text>
        ) : (
          squadre.map((s) => (
            <View key={s.team_id} style={styles.card}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Pressable onPress={() => apriRinomina(s)} style={{ flex: 1 }}>
                  <Text style={styles.nomeSquadra}>{s.nome} <Text style={styles.matita}>✎</Text></Text>
                </Pressable>
                {s.stagione_attiva && (
                  <Text style={[styles.badge, s.squadra_attivata && styles.badgeAttiva]}>
                    {s.squadra_attivata ? "attivata" : "sospesa"}
                  </Text>
                )}
              </View>
              <Text style={styles.dettaglioSquadra}>
                {s.numero_membri} {s.numero_membri === 1 ? "persona" : "persone"}
                {s.stagione_attiva ? ` · stagione ${s.stagione_attiva}` : " · nessuna stagione aperta"}
              </Text>
              <Text style={styles.dettaglioSquadra}>Allenatore: {s.allenatore_nome ?? "nessuno assegnato"}</Text>
              <Text style={styles.dettaglioSquadra}>Vice: {s.vice_allenatore_nome ?? "nessuno assegnato"}</Text>

              {s.squadra_attivata && (
                <Pressable style={styles.bottonePrimarioPieno} onPress={() => onEntraSquadra(s)}>
                  <Text style={styles.bottoneTesto}>Entra nella squadra →</Text>
                </Pressable>
              )}

              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Pressable style={styles.bottoneSecondario} onPress={() => apriAssegnaCollaboratore(s, "allenatore")}>
                  <Text style={styles.bottoneSecondarioTesto}>{s.allenatore_email ? "Cambia allenatore" : "Assegna allenatore"}</Text>
                </Pressable>
                {s.allenatore_email && (
                  <Pressable style={styles.bottoneSecondarioDistruttivo} onPress={() => onRimuoviCollaboratore(s, "allenatore")}>
                    <Text style={styles.bottoneSecondarioDistruttivoTesto}>Rimuovi allenatore</Text>
                  </Pressable>
                )}
                <Pressable style={styles.bottoneSecondario} onPress={() => apriAssegnaCollaboratore(s, "vice_allenatore")}>
                  <Text style={styles.bottoneSecondarioTesto}>{s.vice_allenatore_email ? "Cambia vice" : "Assegna vice"}</Text>
                </Pressable>
                {s.vice_allenatore_email && (
                  <Pressable style={styles.bottoneSecondarioDistruttivo} onPress={() => onRimuoviCollaboratore(s, "vice_allenatore")}>
                    <Text style={styles.bottoneSecondarioDistruttivoTesto}>Rimuovi vice</Text>
                  </Pressable>
                )}
                <Pressable style={styles.bottoneSecondario} onPress={() => apriStorico(s)}>
                  <Text style={styles.bottoneSecondarioTesto}>Storico stagioni</Text>
                </Pressable>
                {s.numero_membri > 0 && (
                  <Pressable style={styles.bottoneSecondario} onPress={() => onGestisciOrganico(s)}>
                    <Text style={styles.bottoneSecondarioTesto}>Gestisci organico</Text>
                  </Pressable>
                )}
                {s.stagione_attiva && (
                  s.squadra_attivata ? (
                    <Pressable style={styles.bottoneSecondarioDistruttivo} onPress={() => onDisattiva(s)} disabled={inCorsoAttivazione === s.team_id}>
                      <Text style={styles.bottoneSecondarioDistruttivoTesto}>Disattiva</Text>
                    </Pressable>
                  ) : (
                    <Pressable style={styles.bottoneSecondario} onPress={() => onAttiva(s)} disabled={inCorsoAttivazione === s.team_id}>
                      <Text style={styles.bottoneSecondarioTesto}>{inCorsoAttivazione === s.team_id ? "Un attimo…" : "Attiva per questa stagione"}</Text>
                    </Pressable>
                  )
                )}
                {s.numero_membri > 0 && (
                  <Pressable style={styles.bottoneSecondario} onPress={() => apriSpostamento(s)}>
                    <Text style={styles.bottoneSecondarioTesto}>Sposta un atleta da qui</Text>
                  </Pressable>
                )}
                <Pressable style={styles.bottoneSecondarioDistruttivo} onPress={() => apriEliminazione(s)}>
                  <Text style={styles.bottoneSecondarioDistruttivoTesto}>Elimina squadra</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={!!squadraPerCollaboratore} animationType="fade" transparent onRequestClose={() => setSquadraPerCollaboratore(null)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>
              {ruoloCollaboratore === "allenatore" ? "Allenatore" : "Vice-allenatore"} di {squadraPerCollaboratore?.nome}
            </Text>
            <Text style={styles.nota}>Un invito parte subito: al primo accesso con questa email, la persona entra con questo profilo.</Text>
            <TextInput
              style={styles.input}
              placeholder="Email Google"
              placeholderTextColor={brand.colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={emailCollaboratore}
              onChangeText={setEmailCollaboratore}
              autoFocus
            />
            <Pressable style={styles.bottone} onPress={onAssegnaCollaboratore} disabled={!emailCollaboratore.trim()}>
              <Text style={styles.bottoneTesto}>Invia invito</Text>
            </Pressable>
            <Pressable onPress={() => setSquadraPerCollaboratore(null)}><Text style={styles.chiudi}>Annulla</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!squadraPerRinomina} animationType="fade" transparent onRequestClose={() => setSquadraPerRinomina(null)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>Rinomina squadra</Text>
            <TextInput
              style={styles.input}
              placeholder="Nuovo nome"
              placeholderTextColor={brand.colors.muted}
              value={nomeRinomina}
              onChangeText={setNomeRinomina}
              autoFocus
            />
            <Pressable style={styles.bottone} onPress={onRinomina} disabled={rinominando || !nomeRinomina.trim()}>
              <Text style={styles.bottoneTesto}>{rinominando ? "Salvataggio…" : "Salva"}</Text>
            </Pressable>
            <Pressable onPress={() => setSquadraPerRinomina(null)}><Text style={styles.chiudi}>Annulla</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!squadraPerEliminazione} animationType="fade" transparent onRequestClose={() => setSquadraPerEliminazione(null)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>Eliminare {squadraPerEliminazione?.nome}?</Text>
            <Text style={styles.nota}>
              Azione irreversibile: verranno eliminati per sempre anche tutti gli atleti, gli allenamenti, le valutazioni, le partite e i piani di questa squadra. Per confermare, scrivi esattamente il nome della squadra: "{squadraPerEliminazione?.nome}".
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Ridigita il nome della squadra"
              placeholderTextColor={brand.colors.muted}
              value={nomeConfermaEliminazione}
              onChangeText={setNomeConfermaEliminazione}
              autoCapitalize="none"
            />
            <Pressable
              style={styles.bottoneDistruttivoPieno}
              onPress={onElimina}
              disabled={eliminando || nomeConfermaEliminazione.trim() !== squadraPerEliminazione?.nome}
            >
              <Text style={styles.bottoneTesto}>{eliminando ? "Eliminazione…" : "Elimina definitivamente"}</Text>
            </Pressable>
            <Pressable onPress={() => setSquadraPerEliminazione(null)}><Text style={styles.chiudi}>Annulla</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={spostamentoAperto} animationType="fade" transparent onRequestClose={() => setSpostamentoAperto(false)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>Sposta un atleta da {squadraOrigine?.nome}</Text>
            <Text style={styles.nota}>Possibile solo finché la squadra di destinazione non è ancora stata attivata per la stagione in corso — la finestra di passaggio tra una stagione e la successiva. Tutto lo storico dell'atleta resta intatto.</Text>

            <ScrollView style={{ maxHeight: 320 }}>
              <Text style={styles.label}>Atleta</Text>
              {atletiOrigine.length === 0 ? (
                <Text style={styles.nota}>Nessun atleta in questa squadra.</Text>
              ) : (
                atletiOrigine.map((a) => (
                  <Pressable key={a.id} style={[styles.rigaScelta, atletaScelto?.id === a.id && styles.rigaSceltaAttiva]} onPress={() => setAtletaScelto(a)}>
                    <Text style={styles.rigaSceltaTesto}>{a.nome} {a.cognome}</Text>
                  </Pressable>
                ))
              )}

              <Text style={styles.label}>Squadra di destinazione</Text>
              {squadre.filter((s) => s.team_id !== squadraOrigine?.team_id).map((s) => (
                <Pressable key={s.team_id} style={[styles.rigaScelta, squadraDestinazione?.team_id === s.team_id && styles.rigaSceltaAttiva]} onPress={() => setSquadraDestinazione(s)}>
                  <Text style={styles.rigaSceltaTesto}>{s.nome}{s.squadra_attivata ? " (già attivata: non selezionabile)" : ""}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Pressable
              style={styles.bottone}
              onPress={confermaSpostamento}
              disabled={spostando || !atletaScelto || !squadraDestinazione || squadraDestinazione.squadra_attivata}
            >
              <Text style={styles.bottoneTesto}>{spostando ? "Spostamento…" : "Sposta atleta"}</Text>
            </Pressable>
            <Pressable onPress={() => setSpostamentoAperto(false)}><Text style={styles.chiudi}>Annulla</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!squadraPerStorico} animationType="fade" transparent onRequestClose={() => setSquadraPerStorico(null)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>Storico stagioni — {squadraPerStorico?.nome}</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {storicoCaricamento ? (
                <ActivityIndicator color={brand.colors.brand} />
              ) : storico.length === 0 ? (
                <Text style={styles.nota}>Nessuna stagione trovata per questa società.</Text>
              ) : (
                storico.map((st) => (
                  <View key={st.season_id} style={styles.rigaStorico}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={styles.rigaSceltaTesto}>{st.nome}</Text>
                      <Text style={[styles.badge, st.squadra_attivata && styles.badgeAttiva]}>
                        {st.squadra_attivata ? "attivata" : "non attivata"}
                      </Text>
                    </View>
                    <Text style={styles.dettaglioSquadra}>
                      {st.stato === "attiva" ? "Stagione in corso" : "Conclusa"}
                      {st.data_apertura ? ` · dal ${st.data_apertura}` : ""}
                      {st.data_chiusura ? ` al ${st.data_chiusura}` : ""}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
            <Pressable onPress={() => setSquadraPerStorico(null)}><Text style={styles.chiudi}>Chiudi</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 8 },
  sezione: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  nomeSquadra: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  matita: { color: brand.colors.muted, fontSize: 12, fontWeight: "400" },
  dettaglioSquadra: { color: brand.colors.muted, fontSize: 12.5 },
  nota: { color: brand.colors.muted, fontSize: 12, lineHeight: 17 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 12 },
  bottone: { backgroundColor: brand.colors.brand, paddingHorizontal: 18, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  bottoneSecondario: { borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, alignItems: "center", marginTop: 2 },
  bottoneSecondarioTesto: { color: brand.colors.brandSecondary, fontWeight: "700", fontSize: 12.5 },
  bottoneSecondarioDistruttivo: { borderWidth: 1, borderColor: brand.colors.error, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, alignItems: "center", marginTop: 2 },
  bottoneSecondarioDistruttivoTesto: { color: brand.colors.error, fontWeight: "700", fontSize: 12.5 },
  bottoneDistruttivoPieno: { backgroundColor: brand.colors.error, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  bottonePrimarioPieno: { backgroundColor: brand.colors.brand, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  badge: { color: brand.colors.muted, fontSize: 11, textTransform: "uppercase", fontWeight: "700" },
  badgeAttiva: { color: brand.colors.success },
  label: { color: brand.colors.muted, fontSize: 12, textTransform: "uppercase", marginTop: 6 },
  rigaScelta: { backgroundColor: brand.colors.surfaceTertiary, borderRadius: 8, padding: 10, marginTop: 4, borderWidth: 1, borderColor: "transparent" },
  rigaStorico: { backgroundColor: brand.colors.surfaceTertiary, borderRadius: 8, padding: 10, marginTop: 4, gap: 3 },
  rigaSceltaAttiva: { borderColor: brand.colors.brand },
  rigaSceltaTesto: { color: brand.colors.onSurface, fontSize: 13.5, fontWeight: "600" },
  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 20, gap: 10 },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  chiudi: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 6 },
});
