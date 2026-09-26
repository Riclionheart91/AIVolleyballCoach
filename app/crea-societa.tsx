import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import {
  elencaSocieta,
  creaSocieta,
  elencaPresidentiSocieta,
  invitaPresidenteSocieta,
  rimuoviPresidenteSocieta,
  type Societa,
  type Presidente,
} from "@/src/services/societa";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";

/**
 * Riservata all'amministratore della piattaforma (is_superuser): fonda
 * una nuova società indicando nome + email di chi ne sarà il primo
 * presidente. Se quella persona ha già un account diventa presidente
 * subito, altrimenti l'invito resta in sospeso e si applica da solo al
 * suo primo accesso — stesso meccanismo degli inviti squadra.
 */
export default function CreaSocieta() {
  const { isSuperuser } = useAuth();
  const [elenco, setElenco] = useState<Societa[]>([]);
  const [caricamento, setCaricamento] = useState(true);

  const [nome, setNome] = useState("");
  const [emailPresidente, setEmailPresidente] = useState("");
  const [creando, setCreando] = useState(false);

  const [societaEspansa, setSocietaEspansa] = useState<string | null>(null);
  const [presidenti, setPresidenti] = useState<Presidente[]>([]);
  const [caricandoPresidenti, setCaricandoPresidenti] = useState(false);
  const [emailNuovoPresidente, setEmailNuovoPresidente] = useState("");
  const [invitandoPresidente, setInvitandoPresidente] = useState(false);

  const carica = useCallback(async () => {
    if (!isSuperuser) return;
    setCaricamento(true);
    try { setElenco(await elencaSocieta()); }
    catch (e) { avvisa("Errore", (e as Error).message); }
    finally { setCaricamento(false); }
  }, [isSuperuser]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function onCrea() {
    if (!nome.trim() || !emailPresidente.trim()) return;
    setCreando(true);
    try {
      await creaSocieta(nome.trim(), emailPresidente.trim());
      avvisa(
        "Società creata",
        `"${nome.trim()}" è stata fondata. Se ${emailPresidente.trim()} ha già un account è già presidente; altrimenti lo diventerà automaticamente al primo accesso con quell'email.`,
      );
      setNome("");
      setEmailPresidente("");
      carica();
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCreando(false);
    }
  }

  async function apriPresidenti(s: Societa) {
    if (societaEspansa === s.id) { setSocietaEspansa(null); return; }
    setSocietaEspansa(s.id);
    setEmailNuovoPresidente("");
    setCaricandoPresidenti(true);
    try {
      setPresidenti(await elencaPresidentiSocieta(s.id));
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCaricandoPresidenti(false);
    }
  }

  async function onInvitaPresidente(societaId: string) {
    if (!emailNuovoPresidente.trim()) return;
    setInvitandoPresidente(true);
    try {
      await invitaPresidenteSocieta(societaId, emailNuovoPresidente.trim());
      setEmailNuovoPresidente("");
      setPresidenti(await elencaPresidentiSocieta(societaId));
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setInvitandoPresidente(false);
    }
  }

  function onRimuoviPresidente(societaId: string, p: Presidente) {
    confermaAzione(
      `Rimuovere ${p.nome} dalla presidenza?`,
      "Perderà tutti i permessi di presidente su questa società.",
      "Rimuovi",
      async () => {
        try {
          await rimuoviPresidenteSocieta(societaId, p.user_id);
          setPresidenti(await elencaPresidentiSocieta(societaId));
        } catch (e) {
          avvisa("Errore", (e as Error).message);
        }
      },
      true,
    );
  }

  if (!isSuperuser) {
    return (
      <View style={styles.container}>
        <Text style={styles.nota}>Questa sezione è riservata all'amministratore della piattaforma.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← Profilo</Text></Pressable>
        <Text style={styles.titolo}>Crea società</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }}>
        <View style={styles.card}>
          <Text style={styles.sezione}>Fonda una nuova società</Text>
          <TextInput
            style={styles.input}
            placeholder="Nome società (es. Gate Volley Milano)"
            placeholderTextColor={brand.colors.muted}
            value={nome}
            onChangeText={setNome}
          />
          <TextInput
            style={styles.input}
            placeholder="Email del presidente"
            placeholderTextColor={brand.colors.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={emailPresidente}
            onChangeText={setEmailPresidente}
          />
          <Pressable style={styles.bottone} onPress={onCrea} disabled={creando || !nome.trim() || !emailPresidente.trim()}>
            {creando ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Crea società</Text>}
          </Pressable>
          <Text style={styles.nota}>Chi non ha ancora un account diventerà presidente automaticamente al primo accesso con l'email indicata.</Text>
        </View>

        <Text style={styles.sezione}>Società esistenti ({elenco.length})</Text>
        {caricamento ? (
          <ActivityIndicator color={brand.colors.brand} />
        ) : elenco.length === 0 ? (
          <Text style={styles.nota}>Nessuna società ancora.</Text>
        ) : (
          elenco.map((s) => (
            <View key={s.id} style={styles.card}>
              <Pressable onPress={() => apriPresidenti(s)}>
                <Text style={styles.nomeSquadra}>{s.nome}</Text>
                <Text style={styles.dettaglioSquadra}>Creata il {s.creato_il?.slice(0, 10)} · tocca per gestire i presidenti</Text>
              </Pressable>

              {societaEspansa === s.id && (
                <View style={{ gap: 6, marginTop: 4 }}>
                  {caricandoPresidenti ? (
                    <ActivityIndicator color={brand.colors.brand} />
                  ) : (
                    presidenti.map((p) => (
                      <View key={p.user_id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <View>
                          <Text style={styles.dettaglioSquadra}>{p.nome}</Text>
                          {p.nome !== p.email && <Text style={styles.nota}>{p.email}</Text>}
                        </View>
                        <Pressable onPress={() => onRimuoviPresidente(s.id, p)}>
                          <Text style={styles.rimuoviTesto}>Rimuovi</Text>
                        </Pressable>
                      </View>
                    ))
                  )}
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
                    <Pressable style={styles.bottone} onPress={() => onInvitaPresidente(s.id)} disabled={invitandoPresidente || !emailNuovoPresidente.trim()}>
                      {invitandoPresidente ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Aggiungi</Text>}
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>
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
  bottone: { backgroundColor: brand.colors.brand, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  rimuoviTesto: { color: brand.colors.error, fontWeight: "700", fontSize: 12.5 },
});
