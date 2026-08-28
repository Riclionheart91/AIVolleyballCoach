import { useCallback, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, RefreshControl, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { creaAtleta, elencaAtlete } from "@/src/services/athletes";
import { annullaInvito, elencaInvitiPendenti, invitaMembro, type TeamInvite } from "@/src/services/teamInvites";
import { brand } from "@/src/config";
import type { Athlete, Ruolo } from "@/src/types/database";

export default function Atlete() {
  const { team } = useAuth();
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [ruoloCampo, setRuoloCampo] = useState("");
  const [inviti, setInviti] = useState<TeamInvite[]>([]);
  const [mostraInviti, setMostraInviti] = useState(false);
  const [emailInvito, setEmailInvito] = useState("");
  const [ruoloInvito, setRuoloInvito] = useState<Ruolo>("vice_allenatore");

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      const [listaAtlete, listaInviti] = await Promise.all([elencaAtlete(team.id), elencaInvitiPendenti(team.id)]);
      setAtlete(listaAtlete);
      setInviti(listaInviti);
    } finally {
      setCaricamento(false);
    }
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function aggiungi() {
    if (!team || !nome.trim() || !cognome.trim()) return;
    await creaAtleta(team.id, { nome: nome.trim(), cognome: cognome.trim(), ruolo_campo: ruoloCampo.trim() || null, numero_maglia: null, data_nascita: null });
    setNome(""); setCognome(""); setRuoloCampo("");
    carica();
  }

  async function invita() {
    if (!team || !emailInvito.trim()) return;
    try {
      await invitaMembro(team.id, emailInvito.trim(), ruoloInvito);
      setEmailInvito("");
      carica();
      Alert.alert("Invito creato", "Quando questa persona farà login con Google per la prima volta, entrerà automaticamente nella squadra — nessun'altra azione richiesta da parte tua.");
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    }
  }

  async function annulla(inviteId: string) {
    await annullaInvito(inviteId);
    carica();
  }

  return (
    <View style={styles.container}>
      <View style={styles.form}>
        <TextInput style={styles.input} placeholder="Nome" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} />
        <TextInput style={styles.input} placeholder="Cognome" placeholderTextColor={brand.colors.muted} value={cognome} onChangeText={setCognome} />
        <TextInput style={styles.input} placeholder="Ruolo in campo (opzionale)" placeholderTextColor={brand.colors.muted} value={ruoloCampo} onChangeText={setRuoloCampo} />
        <Pressable style={styles.bottone} onPress={aggiungi}>
          <Text style={styles.bottoneTesto}>Aggiungi atleta</Text>
        </Pressable>
      </View>

      <Pressable style={styles.rigaEspandi} onPress={() => setMostraInviti(!mostraInviti)}>
        <Text style={styles.rigaEspandiTesto}>{mostraInviti ? "▾" : "▸"} Invita allenatore/vice-allenatore ({inviti.length} in attesa)</Text>
      </Pressable>

      {mostraInviti && (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder="Email Google del collaboratore" placeholderTextColor={brand.colors.muted} autoCapitalize="none" keyboardType="email-address" value={emailInvito} onChangeText={setEmailInvito} />
          <View style={styles.selettoreRuolo}>
            {(["vice_allenatore", "allenatore"] as Ruolo[]).map((r) => (
              <Pressable key={r} onPress={() => setRuoloInvito(r)} style={[styles.chip, ruoloInvito === r && styles.chipAttivo]}>
                <Text style={[styles.chipTesto, ruoloInvito === r && styles.chipTestoAttivo]}>{r === "allenatore" ? "Allenatore" : "Vice-allenatore"}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.bottone} onPress={invita}>
            <Text style={styles.bottoneTesto}>Invia invito</Text>
          </Pressable>

          {inviti.map((i) => (
            <View key={i.id} style={styles.rigaInvito}>
              <Text style={styles.rigaInvitoTesto}>{i.email} — {i.ruolo === "allenatore" ? "Allenatore" : "Vice-allenatore"}</Text>
              <Pressable onPress={() => annulla(i.id)}><Text style={styles.rigaInvitoAnnulla}>Annulla</Text></Pressable>
            </View>
          ))}
        </View>
      )}

      <FlatList
        data={atlete}
        keyExtractor={(a) => a.id}
        refreshControl={<RefreshControl refreshing={caricamento} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListEmptyComponent={!caricamento ? <Text style={styles.vuoto}>Nessuna atleta ancora. Aggiungine una qui sopra.</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.riga}>
            <Text style={styles.rigaNome}>{item.nome} {item.cognome}</Text>
            {!!item.ruolo_campo && <Text style={styles.rigaSotto}>{item.ruolo_campo}</Text>}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface, padding: 16, gap: 16 },
  form: { gap: 8, backgroundColor: brand.colors.surfaceSecondary, padding: 12, borderRadius: 12 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  bottone: { backgroundColor: brand.colors.brand, padding: 10, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  riga: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaNome: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  rigaSotto: { color: brand.colors.muted, fontSize: 13 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  rigaEspandi: { paddingVertical: 4 },
  rigaEspandiTesto: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "600" },
  selettoreRuolo: { flexDirection: "row", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  rigaInvito: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  rigaInvitoTesto: { color: brand.colors.onSurface, fontSize: 13 },
  rigaInvitoAnnulla: { color: brand.colors.error, fontSize: 13, fontWeight: "600" },
});
