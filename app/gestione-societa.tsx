import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Modal } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaSquadreSocieta, creaSquadraInSocieta, assegnaAllenatoreSquadra, type SquadraSocieta } from "@/src/services/societa";
import { avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";

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
              <Text style={styles.nomeSquadra}>{s.nome}</Text>
              <Text style={styles.dettaglioSquadra}>
                {s.numero_membri} {s.numero_membri === 1 ? "persona" : "persone"}
                {s.stagione_attiva ? ` · stagione ${s.stagione_attiva}` : " · nessuna stagione aperta"}
              </Text>
              <Text style={styles.dettaglioSquadra}>
                Allenatore: {s.allenatore_email ?? "nessuno assegnato"}
              </Text>
              <Pressable
                style={styles.bottoneSecondario}
                onPress={() => { setSquadraPerAllenatore(s); setEmailAllenatore(""); }}
              >
                <Text style={styles.bottoneSecondarioTesto}>{s.allenatore_email ? "Cambia allenatore" : "Assegna allenatore"}</Text>
              </Pressable>
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
  bottoneSecondario: { borderWidth: 1, borderColor: brand.colors.brandSecondary, borderRadius: 8, paddingVertical: 8, alignItems: "center", marginTop: 2 },
  bottoneSecondarioTesto: { color: brand.colors.brandSecondary, fontWeight: "700", fontSize: 12.5 },
  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 20, gap: 10 },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  chiudi: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 6 },
});
