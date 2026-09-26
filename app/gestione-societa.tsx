import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Modal } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaSquadreSocieta, creaSquadraInSocieta, assegnaAllenatoreSquadra, type SquadraSocieta } from "@/src/services/societa";
import { attivaSquadraInStagione, disattivaSquadraInStagione, spostaAtletaSquadra } from "@/src/services/seasons";
import { elencaAtlete } from "@/src/services/athletes";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import type { Athlete } from "@/src/types/database";

/**
 * L'organico della società: qui il presidente vede tutte le squadre
 * del proprio club, ne crea di nuove, e assegna chi le allena — la
 * gestione che prima mancava del tutto.
 */
export default function GestioneSocieta() {
  const { societaPresidenza } = useAuth();
  const [squadre, setSquadre] = useState<SquadraSocieta[]>([]);
  const [caricamento, setCaricamento] = useState(true);

  const [nomeNuova, setNomeNuova] = useState("");
  const [creando, setCreando] = useState(false);

  const [squadraPerAllenatore, setSquadraPerAllenatore] = useState<SquadraSocieta | null>(null);
  const [emailAllenatore, setEmailAllenatore] = useState("");

  const [inCorsoAttivazione, setInCorsoAttivazione] = useState<string | null>(null);

  const [spostamentoAperto, setSpostamentoAperto] = useState(false);
  const [squadraOrigine, setSquadraOrigine] = useState<SquadraSocieta | null>(null);
  const [atletiOrigine, setAtletiOrigine] = useState<Athlete[]>([]);
  const [atletaScelto, setAtletaScelto] = useState<Athlete | null>(null);
  const [squadraDestinazione, setSquadraDestinazione] = useState<SquadraSocieta | null>(null);
  const [spostando, setSpostando] = useState(false);

  const carica = useCallback(async () => {
    if (!societaPresidenza) return;
    setCaricamento(true);
    try { setSquadre(await elencaSquadreSocieta(societaPresidenza.societa_id)); }
    catch (e) { avvisa("Errore", (e as Error).message); }
    finally { setCaricamento(false); }
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

  async function onAssegnaAllenatore() {
    if (!squadraPerAllenatore || !emailAllenatore.trim()) return;
    try {
      await assegnaAllenatoreSquadra(squadraPerAllenatore.team_id, emailAllenatore.trim());
      avvisa("Invito inviato", `${emailAllenatore.trim()} diventerà allenatore al primo accesso con quell'email.`);
      setSquadraPerAllenatore(null);
      setEmailAllenatore("");
      carica();
    } catch (e) {
      avvisa("Errore", (e as Error).message);
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
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← Profilo</Text></Pressable>
        <Text style={styles.titolo}>{societaPresidenza.nome}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }}>
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
                <Text style={styles.nomeSquadra}>{s.nome}</Text>
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
              <Text style={styles.dettaglioSquadra}>
                Allenatore: {s.allenatore_email ?? "nessuno assegnato"}
              </Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Pressable
                  style={styles.bottoneSecondario}
                  onPress={() => { setSquadraPerAllenatore(s); setEmailAllenatore(""); }}
                >
                  <Text style={styles.bottoneSecondarioTesto}>{s.allenatore_email ? "Cambia allenatore" : "Assegna allenatore"}</Text>
                </Pressable>
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
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={!!squadraPerAllenatore} animationType="fade" transparent onRequestClose={() => setSquadraPerAllenatore(null)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>Allenatore di {squadraPerAllenatore?.nome}</Text>
            <Text style={styles.nota}>Un invito parte subito: al primo accesso con questa email, la persona entra come allenatore.</Text>
            <TextInput
              style={styles.input}
              placeholder="Email Google"
              placeholderTextColor={brand.colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={emailAllenatore}
              onChangeText={setEmailAllenatore}
              autoFocus
            />
            <Pressable style={styles.bottone} onPress={onAssegnaAllenatore} disabled={!emailAllenatore.trim()}>
              <Text style={styles.bottoneTesto}>Invia invito</Text>
            </Pressable>
            <Pressable onPress={() => setSquadraPerAllenatore(null)}><Text style={styles.chiudi}>Annulla</Text></Pressable>
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
  dettaglioSquadra: { color: brand.colors.muted, fontSize: 12.5 },
  nota: { color: brand.colors.muted, fontSize: 12, lineHeight: 17 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 12 },
  bottone: { backgroundColor: brand.colors.brand, paddingHorizontal: 18, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  bottoneSecondario: { borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, alignItems: "center", marginTop: 2 },
  bottoneSecondarioTesto: { color: brand.colors.brandSecondary, fontWeight: "700", fontSize: 12.5 },
  bottoneSecondarioDistruttivo: { borderWidth: 1, borderColor: brand.colors.error, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, alignItems: "center", marginTop: 2 },
  bottoneSecondarioDistruttivoTesto: { color: brand.colors.error, fontWeight: "700", fontSize: 12.5 },
  badge: { color: brand.colors.muted, fontSize: 11, textTransform: "uppercase", fontWeight: "700" },
  badgeAttiva: { color: brand.colors.success },
  label: { color: brand.colors.muted, fontSize: 12, textTransform: "uppercase", marginTop: 6 },
  rigaScelta: { backgroundColor: brand.colors.surfaceTertiary, borderRadius: 8, padding: 10, marginTop: 4, borderWidth: 1, borderColor: "transparent" },
  rigaSceltaAttiva: { borderColor: brand.colors.brand },
  rigaSceltaTesto: { color: brand.colors.onSurface, fontSize: 13.5, fontWeight: "600" },
  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 20, gap: 10 },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  chiudi: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 6 },
});
