import { useCallback, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, RefreshControl, Alert } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { aggiornaAtleta, creaAtleta, elencaAtlete } from "@/src/services/athletes";
import { annullaInvito, elencaInvitiPendenti, invitaMembro, type TeamInvite } from "@/src/services/teamInvites";
import { brand, etichetteRuolo, ruoliCampo } from "@/src/config";
import type { Athlete, Ruolo, RuoloCampo } from "@/src/types/database";

export default function Atlete() {
  const { team, puoScrivere } = useAuth();
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [ruoloCampo, setRuoloCampo] = useState<RuoloCampo | null>(null);
  const [inviti, setInviti] = useState<TeamInvite[]>([]);
  const [mostraInviti, setMostraInviti] = useState(false);
  const [emailInvito, setEmailInvito] = useState("");
  const [ruoloInvito, setRuoloInvito] = useState<Ruolo>("vice_allenatore");
  const [atletaInvito, setAtletaInvito] = useState<string | null>(null);
  const [atletaInModifica, setAtletaInModifica] = useState<string | null>(null);
  const [modificaRuoloCampo, setModificaRuoloCampo] = useState<RuoloCampo | null>(null);
  const [modificaNumero, setModificaNumero] = useState("");

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      const [listaAtlete, listaInviti] = await Promise.all([elencaAtlete(team.id), puoScrivere ? elencaInvitiPendenti(team.id) : Promise.resolve([])]);
      setAtlete(listaAtlete);
      setInviti(listaInviti);
    } finally {
      setCaricamento(false);
    }
  }, [team, puoScrivere]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function aggiungi() {
    if (!team || !nome.trim() || !cognome.trim()) return;
    await creaAtleta(team.id, { nome: nome.trim(), cognome: cognome.trim(), ruolo_campo: ruoloCampo, numero_maglia: null, data_nascita: null });
    setNome(""); setCognome(""); setRuoloCampo(null);
    carica();
  }

  function apriModifica(a: Athlete) {
    setAtletaInModifica(a.id);
    setModificaRuoloCampo(a.ruolo_campo);
    setModificaNumero(a.numero_maglia != null ? String(a.numero_maglia) : "");
  }

  async function salvaModifica(atletaId: string) {
    try {
      await aggiornaAtleta(atletaId, { ruolo_campo: modificaRuoloCampo, numero_maglia: modificaNumero ? Number(modificaNumero) : null });
      setAtletaInModifica(null);
      carica();
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    }
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
      Alert.alert("Invito creato", "Quando questa persona farà login con Google per la prima volta, entrerà automaticamente nella squadra con il ruolo scelto — nessun'altra azione richiesta da parte tua.");
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
      {puoScrivere && (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder="Nome" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} />
          <TextInput style={styles.input} placeholder="Cognome" placeholderTextColor={brand.colors.muted} value={cognome} onChangeText={setCognome} />
          <Text style={styles.etichettaCampo}>Ruolo in campo</Text>
          <View style={styles.selettoreRiga}>
            {ruoliCampo.map((r) => (
              <Pressable key={r} onPress={() => setRuoloCampo(r)} style={[styles.chip, ruoloCampo === r && styles.chipAttivo]}>
                <Text style={[styles.chipTesto, ruoloCampo === r && styles.chipTestoAttivo]}>{r}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.bottone} onPress={aggiungi}>
            <Text style={styles.bottoneTesto}>Aggiungi atleta</Text>
          </Pressable>
        </View>
      )}

      {puoScrivere && (
        <Pressable style={styles.bottoneSecondarioLargo} onPress={() => router.push("/importa-atlete")}>
          <Text style={styles.bottoneSecondarioLargoTesto}>📄 Importa da Excel/CSV (wizard)</Text>
        </Pressable>
      )}

      {puoScrivere && (
        <>
          <Pressable style={styles.rigaEspandi} onPress={() => setMostraInviti(!mostraInviti)}>
            <Text style={styles.rigaEspandiTesto}>{mostraInviti ? "▾" : "▸"} Invita un collaboratore ({inviti.length} in attesa)</Text>
          </Pressable>

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
        </>
      )}

      <FlatList
        data={atlete}
        keyExtractor={(a) => a.id}
        refreshControl={<RefreshControl refreshing={caricamento} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListEmptyComponent={!caricamento ? <Text style={styles.vuoto}>Nessuna atleta ancora.</Text> : null}
        renderItem={({ item }) => (
          <Pressable style={styles.riga} onPress={() => puoScrivere && apriModifica(item)} disabled={!puoScrivere}>
            <Text style={styles.rigaNome}>{item.nome} {item.cognome}</Text>
            {!!item.ruolo_campo && <Text style={styles.rigaSotto}>{item.ruolo_campo}{item.numero_maglia ? ` — n. ${item.numero_maglia}` : ""}</Text>}

            {atletaInModifica === item.id && (
              <View style={styles.editBox}>
                <View style={styles.selettoreRiga}>
                  {ruoliCampo.map((r) => (
                    <Pressable key={r} onPress={() => setModificaRuoloCampo(r)} style={[styles.chip, modificaRuoloCampo === r && styles.chipAttivo]}>
                      <Text style={[styles.chipTesto, modificaRuoloCampo === r && styles.chipTestoAttivo]}>{r}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput style={styles.input} placeholder="Numero maglia" placeholderTextColor={brand.colors.muted} keyboardType="numeric" value={modificaNumero} onChangeText={setModificaNumero} />
                <Pressable style={styles.bottone} onPress={() => salvaModifica(item.id)}>
                  <Text style={styles.bottoneTesto}>Salva</Text>
                </Pressable>
              </View>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface, padding: 16, gap: 16 },
  form: { gap: 8, backgroundColor: brand.colors.surfaceSecondary, padding: 12, borderRadius: 12 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  etichettaCampo: { color: brand.colors.muted, fontSize: 12, marginTop: 2 },
  bottone: { backgroundColor: brand.colors.brand, padding: 10, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  bottoneSecondarioLargo: { borderColor: brand.colors.brandSecondary, borderWidth: 1, padding: 12, borderRadius: 10, alignItems: "center" },
  bottoneSecondarioLargoTesto: { color: brand.colors.brandSecondary, fontWeight: "700" },
  riga: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaNome: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  rigaSotto: { color: brand.colors.muted, fontSize: 13 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  rigaEspandi: { paddingVertical: 4 },
  rigaEspandiTesto: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "600" },
  selettoreRiga: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  rigaInvito: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  rigaInvitoTesto: { color: brand.colors.onSurface, fontSize: 13 },
  rigaInvitoAnnulla: { color: brand.colors.error, fontSize: 13, fontWeight: "600" },
  editBox: { marginTop: 10, gap: 8, backgroundColor: brand.colors.surfaceTertiary, padding: 10, borderRadius: 8 },
});
