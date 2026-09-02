import { useCallback, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, RefreshControl, Alert } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { creaAtleta, elencaAtlete, elencaAtleteArchiviate, ripristinaAtleta } from "@/src/services/athletes";
import { annullaInvito, elencaInvitiPendenti, invitaMembro, type TeamInvite } from "@/src/services/teamInvites";
import { FabAggiungi } from "@/src/components/Fab";
import { PopupForm } from "@/src/components/PopupForm";
import { brand, etichetteRuolo, ruoliCampo } from "@/src/config";
import type { Athlete, Ruolo, RuoloCampo } from "@/src/types/database";

export default function Atlete() {
  const { team, puoScrivere } = useAuth();
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [archiviate, setArchiviate] = useState<Athlete[]>([]);
  const [mostraArchiviate, setMostraArchiviate] = useState(false);
  const [caricamento, setCaricamento] = useState(true);
  const [popupAperto, setPopupAperto] = useState(false);
  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [ruoloCampo, setRuoloCampo] = useState<RuoloCampo | null>(null);
  const [inviti, setInviti] = useState<TeamInvite[]>([]);
  const [mostraInviti, setMostraInviti] = useState(false);
  const [emailInvito, setEmailInvito] = useState("");
  const [ruoloInvito, setRuoloInvito] = useState<Ruolo>("vice_allenatore");
  const [atletaInvito, setAtletaInvito] = useState<string | null>(null);

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      const [listaAtlete, listaInviti] = await Promise.all([elencaAtlete(team.id), puoScrivere ? elencaInvitiPendenti(team.id) : Promise.resolve([])]);
      setAtlete(listaAtlete);
      setInviti(listaInviti);
      if (mostraArchiviate) setArchiviate(await elencaAtleteArchiviate(team.id));
    } finally {
      setCaricamento(false);
    }
  }, [team, puoScrivere, mostraArchiviate]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function aggiungi() {
    if (!team || !nome.trim() || !cognome.trim()) return;
    await creaAtleta(team.id, { nome: nome.trim(), cognome: cognome.trim(), ruolo_campo: ruoloCampo, numero_maglia: null, data_nascita: null });
    setNome(""); setCognome(""); setRuoloCampo(null); setPopupAperto(false);
    carica();
  }

  async function ripristina(id: string) {
    try { await ripristinaAtleta(id); carica(); } catch (e) { Alert.alert("Errore", (e as Error).message); }
  }

  async function invita() {
    if (!team || !emailInvito.trim()) return;
    if (ruoloInvito === "atleta" && !atletaInvito) {
      Alert.alert("Manca la scheda", "Per invitare un'atleta seleziona prima a quale scheda anagrafica collegare l'invito.");
      return;
    }
    try {
      await invitaMembro(team.id, emailInvito.trim(), ruoloInvito, ruoloInvito === "atleta" ? atletaInvito : null);
      setEmailInvito(""); setAtletaInvito(null);
      carica();
      Alert.alert("Invito creato", "Quando questa persona farà login con Google per la prima volta, entrerà automaticamente nella squadra con il ruolo scelto.");
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
      <FlatList
        data={atlete}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 4 }}
        refreshControl={<RefreshControl refreshing={caricamento} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListHeaderComponent={
          <>
            {puoScrivere && (
              <Pressable style={styles.rigaEspandi} onPress={() => setMostraInviti(!mostraInviti)}>
                <Text style={styles.rigaEspandiTesto}>{mostraInviti ? "▾" : "▸"} Invita un collaboratore ({inviti.length} in attesa)</Text>
              </Pressable>
            )}

            {mostraInviti && (
              <View style={styles.form}>
                <TextInput style={styles.input} placeholder="Email Google del collaboratore" placeholderTextColor={brand.colors.muted} autoCapitalize="none" keyboardType="email-address" value={emailInvito} onChangeText={setEmailInvito} />
                <Text style={styles.etichettaCampo}>Ruolo</Text>
                <View style={styles.selettoreRiga}>
                  {(["vice_allenatore", "allenatore", "presidente", "atleta"] as Ruolo[]).map((r) => (
                    <Pressable key={r} onPress={() => { setRuoloInvito(r); setAtletaInvito(null); }} style={[styles.chip, ruoloInvito === r && styles.chipAttivo]}>
                      <Text style={[styles.chipTesto, ruoloInvito === r && styles.chipTestoAttivo]}>{etichetteRuolo[r]}</Text>
                    </Pressable>
                  ))}
                </View>
                {ruoloInvito === "atleta" && (
                  <>
                    <Text style={styles.etichettaCampo}>Collega alla scheda di:</Text>
                    <View style={styles.selettoreRiga}>
                      {atlete.map((a) => (
                        <Pressable key={a.id} onPress={() => setAtletaInvito(a.id)} style={[styles.chip, atletaInvito === a.id && styles.chipAttivo]}>
                          <Text style={[styles.chipTesto, atletaInvito === a.id && styles.chipTestoAttivo]}>{a.nome} {a.cognome}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                )}
                <Pressable style={styles.bottone} onPress={invita}>
                  <Text style={styles.bottoneTesto}>Invia invito</Text>
                </Pressable>
                {inviti.map((i) => (
                  <View key={i.id} style={styles.rigaInvito}>
                    <Text style={styles.rigaInvitoTesto}>{i.email} — {etichetteRuolo[i.ruolo]}</Text>
                    <Pressable onPress={() => annulla(i.id)}><Text style={styles.rigaInvitoAnnulla}>Annulla</Text></Pressable>
                  </View>
                ))}
              </View>
            )}

            {puoScrivere && (
              <Pressable style={styles.rigaEspandi} onPress={() => setMostraArchiviate(!mostraArchiviate)}>
                <Text style={styles.rigaEspandiTesto}>{mostraArchiviate ? "▾" : "▸"} Atlete archiviate ({archiviate.length})</Text>
              </Pressable>
            )}
            {mostraArchiviate && archiviate.map((a) => (
              <View key={a.id} style={styles.rigaArchiviata}>
                <Text style={styles.rigaNome}>{a.nome} {a.cognome}</Text>
                <Pressable onPress={() => ripristina(a.id)}><Text style={styles.rigaInvitoTesto}>Ripristina</Text></Pressable>
              </View>
            ))}
          </>
        }
        ListEmptyComponent={!caricamento ? <Text style={styles.vuoto}>Nessuna atleta ancora. Usa il pulsante + qui sotto.</Text> : null}
        renderItem={({ item }) => (
          <Pressable style={styles.riga} onPress={() => router.push(`/atleta/${item.id}`)}>
            <Text style={styles.rigaNome}>{item.nome} {item.cognome}</Text>
            {!!item.ruolo_campo && <Text style={styles.rigaSotto}>{item.ruolo_campo}{item.numero_maglia ? ` — n. ${item.numero_maglia}` : ""}</Text>}
          </Pressable>
        )}
      />

      {puoScrivere && (
        <>
          <FabAggiungi onPress={() => router.push("/importa-atlete")} posizione="secondaria" icona="📄" colore={brand.colors.brandSecondary} />
          <FabAggiungi onPress={() => setPopupAperto(true)} />
        </>
      )}

      <PopupForm visibile={popupAperto} titolo="Nuova atleta" haModifiche={!!(nome.trim() || cognome.trim())} onChiudi={() => { setPopupAperto(false); setNome(""); setCognome(""); setRuoloCampo(null); }}>
        <TextInput style={styles.input} placeholder="Nome" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} autoFocus />
        <TextInput style={styles.input} placeholder="Cognome" placeholderTextColor={brand.colors.muted} value={cognome} onChangeText={setCognome} />
        <Text style={styles.etichettaCampo}>Ruolo in campo</Text>
        <View style={styles.selettoreRiga}>
          {ruoliCampo.map((r) => (
            <Pressable key={r} onPress={() => setRuoloCampo(r)} style={[styles.chip, ruoloCampo === r && styles.chipAttivo]}>
              <Text style={[styles.chipTesto, ruoloCampo === r && styles.chipTestoAttivo]}>{r}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.bottone} onPress={aggiungi} disabled={!nome.trim() || !cognome.trim()}>
          <Text style={styles.bottoneTesto}>Aggiungi atleta</Text>
        </Pressable>
      </PopupForm>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  form: { gap: 8, backgroundColor: brand.colors.surfaceSecondary, padding: 12, borderRadius: 12, marginBottom: 12 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  etichettaCampo: { color: brand.colors.muted, fontSize: 12, marginTop: 2 },
  bottone: { backgroundColor: brand.colors.brand, padding: 10, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  riga: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaNome: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  rigaSotto: { color: brand.colors.muted, fontSize: 13 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  rigaEspandi: { paddingVertical: 4 },
  rigaEspandiTesto: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "600" },
  rigaArchiviata: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  selettoreRiga: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  rigaInvito: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  rigaInvitoTesto: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "600" },
  rigaInvitoAnnulla: { color: brand.colors.error, fontSize: 13, fontWeight: "600" },
});
