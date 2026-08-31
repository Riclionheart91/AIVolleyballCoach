import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaAtlete, aggiornaMioContatto } from "@/src/services/athletes";
import { brand, etichetteRuolo } from "@/src/config";
import type { Athlete } from "@/src/types/database";

export default function Profilo() {
  const { session, team, ruolo, atletaId, puoScrivere, isSuperuser, esci } = useAuth();
  const [mieDati, setMieDati] = useState<Athlete | null>(null);
  const [telefono, setTelefono] = useState("");
  const [emailContatto, setEmailContatto] = useState("");
  const [notePersonali, setNotePersonali] = useState("");
  const [salvataggio, setSalvataggio] = useState(false);

  useEffect(() => {
    if (!team || !atletaId) return;
    elencaAtlete(team.id).then((lista) => {
      const io = lista.find((a) => a.id === atletaId) ?? null;
      setMieDati(io);
      setTelefono(io?.telefono ?? "");
      setEmailContatto(io?.email_contatto ?? "");
      setNotePersonali(io?.note_personali ?? "");
    });
  }, [team, atletaId]);

  async function salvaContatti() {
    if (!team) return;
    setSalvataggio(true);
    try {
      await aggiornaMioContatto(team.id, telefono.trim(), emailContatto.trim(), notePersonali.trim());
      Alert.alert("Salvato", "I tuoi dati di contatto sono stati aggiornati.");
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    } finally {
      setSalvataggio(false);
    }
  }

  async function onEsci() {
    await esci();
    router.replace("/login");
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={styles.card}>
        <Text style={styles.label}>Account</Text>
        <Text style={styles.valore}>{session?.user.email}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Squadra</Text>
        <Text style={styles.valore}>{team?.nome ?? "—"}</Text>
        <Text style={styles.label}>Ruolo</Text>
        <Text style={styles.valore}>{ruolo ? etichetteRuolo[ruolo] : "—"}</Text>
      </View>

      {ruolo === "atleta" && (
        <View style={styles.card}>
          <Text style={styles.label}>La mia scheda</Text>
          <Text style={styles.valore}>
            {mieDati ? `${mieDati.nome} ${mieDati.cognome}` : "—"}
            {mieDati?.ruolo_campo ? ` — ${mieDati.ruolo_campo}` : ""}
          </Text>
          <Text style={styles.nota}>Nome, cognome, ruolo in campo e numero maglia sono gestiti dall'allenatore. Puoi aggiornare solo i tuoi contatti qui sotto.</Text>

          <TextInput style={styles.input} placeholder="Telefono" placeholderTextColor={brand.colors.muted} keyboardType="phone-pad" value={telefono} onChangeText={setTelefono} />
          <TextInput style={styles.input} placeholder="Email di contatto (se diversa da quella di accesso)" placeholderTextColor={brand.colors.muted} autoCapitalize="none" keyboardType="email-address" value={emailContatto} onChangeText={setEmailContatto} />
          <TextInput style={[styles.input, { minHeight: 70 }]} placeholder="Note personali (es. allergie, disponibilità)" placeholderTextColor={brand.colors.muted} multiline value={notePersonali} onChangeText={setNotePersonali} />
          <Pressable style={styles.bottone} onPress={salvaContatti} disabled={salvataggio}>
            <Text style={styles.bottoneTesto}>{salvataggio ? "Salvataggio…" : "Salva contatti"}</Text>
          </Pressable>
        </View>
      )}

      {ruolo === "presidente" && (
        <View style={styles.card}>
          <Text style={styles.nota}>Il tuo accesso è in sola lettura su tutti i dati della squadra. Trovi l'andamento aggregato nella tab Valutazioni.</Text>
        </View>
      )}

      {(puoScrivere || isSuperuser) && (
        <Pressable style={styles.bottoneSecondario} onPress={() => router.push("/impostazioni")}>
          <Text style={styles.bottoneSecondarioTesto}>Impostazioni</Text>
        </Pressable>
      )}

      <Pressable style={styles.bottoneEsci} onPress={onEsci}>
        <Text style={styles.bottoneEsciTesto}>Esci</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 6 },
  label: { color: brand.colors.muted, fontSize: 12, textTransform: "uppercase", marginTop: 6 },
  valore: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  nota: { color: brand.colors.muted, fontSize: 13 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10, marginTop: 8 },
  bottone: { backgroundColor: brand.colors.brand, padding: 10, borderRadius: 8, alignItems: "center", marginTop: 8 },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  bottoneSecondario: { borderColor: brand.colors.brand, borderWidth: 1, padding: 12, borderRadius: 10, alignItems: "center" },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "700" },
  bottoneEsci: { borderColor: brand.colors.error, borderWidth: 1, padding: 12, borderRadius: 10, alignItems: "center" },
  bottoneEsciTesto: { color: brand.colors.error, fontWeight: "700" },
});
