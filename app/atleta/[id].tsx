import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { aggiornaAtleta, archiviaAtleta, eliminaAtletaDefinitivamente, leggiAtleta, ripristinaAtleta } from "@/src/services/athletes";
import { confermaAzione } from "@/src/lib/confermaAzione";
import { brand, ruoliCampo } from "@/src/config";
import type { Athlete, RuoloCampo } from "@/src/types/database";

export default function SchedaAtleta() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { puoScrivere } = useAuth();
  const [atleta, setAtleta] = useState<Athlete | null>(null);
  const [inModifica, setInModifica] = useState(false);
  const [salvataggio, setSalvataggio] = useState(false);

  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [ruoloCampo, setRuoloCampo] = useState<RuoloCampo | null>(null);
  const [numeroMaglia, setNumeroMaglia] = useState("");
  const [dataNascita, setDataNascita] = useState("");
  const [codiceFiscale, setCodiceFiscale] = useState("");
  const [telefono, setTelefono] = useState("");
  const [emailContatto, setEmailContatto] = useState("");
  const [notePersonali, setNotePersonali] = useState("");

  useEffect(() => {
    if (!id) return;
    leggiAtleta(id).then((a) => {
      setAtleta(a);
      caricaCampi(a);
    }).catch((err) => Alert.alert("Errore", err.message));
  }, [id]);

  function caricaCampi(a: Athlete) {
    setNome(a.nome); setCognome(a.cognome); setRuoloCampo(a.ruolo_campo);
    setNumeroMaglia(a.numero_maglia != null ? String(a.numero_maglia) : "");
    setDataNascita(a.data_nascita ?? ""); setCodiceFiscale(a.codice_fiscale ?? "");
    setTelefono(a.telefono ?? ""); setEmailContatto(a.email_contatto ?? ""); setNotePersonali(a.note_personali ?? "");
  }

  const haModifiche = !!atleta && (
    nome !== atleta.nome || cognome !== atleta.cognome || ruoloCampo !== atleta.ruolo_campo ||
    numeroMaglia !== (atleta.numero_maglia != null ? String(atleta.numero_maglia) : "") ||
    dataNascita !== (atleta.data_nascita ?? "") || codiceFiscale !== (atleta.codice_fiscale ?? "") ||
    telefono !== (atleta.telefono ?? "") || emailContatto !== (atleta.email_contatto ?? "") || notePersonali !== (atleta.note_personali ?? "")
  );

  function tornaIndietro() {
    if (inModifica && haModifiche) {
      confermaAzione("Modifiche non salvate", "Vuoi salvarle prima di uscire?", "Esci senza salvare", () => router.back(), true);
    } else {
      router.back();
    }
  }

  async function salva() {
    if (!atleta || !nome.trim() || !cognome.trim()) return;
    setSalvataggio(true);
    try {
      const aggiornato = await aggiornaAtleta(atleta.id, {
        nome: nome.trim(), cognome: cognome.trim(), ruolo_campo: ruoloCampo,
        numero_maglia: numeroMaglia ? Number(numeroMaglia) || null : null,
        data_nascita: dataNascita || null, codice_fiscale: codiceFiscale.trim() || null,
        telefono: telefono.trim() || null, email_contatto: emailContatto.trim() || null, note_personali: notePersonali.trim() || null,
      });
      setAtleta(aggiornato);
      setInModifica(false);
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    } finally {
      setSalvataggio(false);
    }
  }

  function chiediArchiviazione() {
    if (!atleta) return;
    confermaAzione("Archiviare l'atleta?", `"${atleta.nome} ${atleta.cognome}" non comparirà più negli elenchi attivi. Puoi ripristinarla in qualunque momento dalla sezione "Atlete archiviate".`, "Archivia", async () => {
      try { await archiviaAtleta(atleta.id); router.back(); } catch (e) { Alert.alert("Errore", (e as Error).message); }
    }, true);
  }

  function chiediRipristino() {
    if (!atleta) return;
    ripristinaAtleta(atleta.id).then(() => setAtleta({ ...atleta, status: "attiva" })).catch((e) => Alert.alert("Errore", e.message));
  }

  function chiediEliminazione() {
    if (!atleta) return;
    confermaAzione(
      "Eliminare definitivamente?",
      `"${atleta.nome} ${atleta.cognome}" e TUTTO il suo storico (valutazioni, presenze, RPE, scout) verranno cancellati per sempre. Nella maggior parte dei casi è meglio archiviare invece di eliminare. Procedere comunque?`,
      "Elimina definitivamente",
      async () => {
        try { await eliminaAtletaDefinitivamente(atleta.id); router.back(); } catch (e) { Alert.alert("Errore", (e as Error).message); }
      },
      true,
    );
  }

  if (!atleta) return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={tornaIndietro} hitSlop={12}>
          <Text style={styles.indietro}>← Atlete</Text>
        </Pressable>
        {inModifica && puoScrivere && (
          <View style={{ flexDirection: "row", gap: 16 }}>
            {atleta.status === "attiva" ? (
              <Pressable onPress={chiediArchiviazione}><Text style={styles.azioneHeader}>Archivia</Text></Pressable>
            ) : (
              <Pressable onPress={chiediRipristino}><Text style={styles.azioneHeader}>Ripristina</Text></Pressable>
            )}
            <Pressable onPress={chiediEliminazione}><Text style={styles.elimina}>Elimina</Text></Pressable>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {atleta.status === "archiviata" && <Text style={styles.badgeArchiviata}>ARCHIVIATA</Text>}

        {inModifica ? (
          <>
            <Campo etichetta="Nome"><TextInput style={styles.input} value={nome} onChangeText={setNome} placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Cognome"><TextInput style={styles.input} value={cognome} onChangeText={setCognome} placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Ruolo in campo">
              <View style={styles.selettoreRiga}>
                {ruoliCampo.map((r) => (
                  <Pressable key={r} onPress={() => setRuoloCampo(r)} style={[styles.chip, ruoloCampo === r && styles.chipAttivo]}>
                    <Text style={[styles.chipTesto, ruoloCampo === r && styles.chipTestoAttivo]}>{r}</Text>
                  </Pressable>
                ))}
              </View>
            </Campo>
            <Campo etichetta="Numero maglia"><TextInput style={styles.input} keyboardType="numeric" value={numeroMaglia} onChangeText={setNumeroMaglia} placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Data di nascita (AAAA-MM-GG)"><TextInput style={styles.input} value={dataNascita} onChangeText={setDataNascita} placeholder="2010-05-20" placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Codice fiscale"><TextInput style={styles.input} autoCapitalize="characters" value={codiceFiscale} onChangeText={setCodiceFiscale} placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Telefono"><TextInput style={styles.input} keyboardType="phone-pad" value={telefono} onChangeText={setTelefono} placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Email"><TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address" value={emailContatto} onChangeText={setEmailContatto} placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Note"><TextInput style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]} multiline value={notePersonali} onChangeText={setNotePersonali} placeholderTextColor={brand.colors.muted} /></Campo>

            <Pressable style={styles.bottone} onPress={salva} disabled={salvataggio || !nome.trim() || !cognome.trim()}>
              {salvataggio ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Salva</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.titolo}>{atleta.nome} {atleta.cognome}</Text>
            {!!atleta.ruolo_campo && <Text style={styles.sottotitolo}>{atleta.ruolo_campo}{atleta.numero_maglia ? ` — n. ${atleta.numero_maglia}` : ""}</Text>}
            <RigaSolaLettura etichetta="Data di nascita" valore={atleta.data_nascita} />
            <RigaSolaLettura etichetta="Codice fiscale" valore={atleta.codice_fiscale} />
            <RigaSolaLettura etichetta="Telefono" valore={atleta.telefono} />
            <RigaSolaLettura etichetta="Email" valore={atleta.email_contatto} />
            <RigaSolaLettura etichetta="Note" valore={atleta.note_personali} />
          </>
        )}
      </ScrollView>

      {puoScrivere && !inModifica && (
        <Pressable style={styles.fabModifica} onPress={() => setInModifica(true)}>
          <Text style={styles.fabModificaTesto}>✎</Text>
        </Pressable>
      )}
    </View>
  );
}

function Campo({ etichetta, children }: { etichetta: string; children: React.ReactNode }) {
  return <View style={{ gap: 4 }}><Text style={styles.etichettaCampo}>{etichetta}</Text>{children}</View>;
}

function RigaSolaLettura({ etichetta, valore }: { etichetta: string; valore: string | null }) {
  return (
    <View style={styles.rigaSolaLettura}>
      <Text style={styles.etichettaCampo}>{etichetta}</Text>
      <Text style={styles.valoreSolaLettura}>{valore || "—"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  azioneHeader: { color: brand.colors.brandSecondary, fontWeight: "600" },
  elimina: { color: brand.colors.error, fontWeight: "600" },
  badgeArchiviata: { color: brand.colors.warning, fontWeight: "700", fontSize: 12 },
  titolo: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700" },
  sottotitolo: { color: brand.colors.brandSecondary, fontSize: 14, fontWeight: "600" },
  etichettaCampo: { color: brand.colors.muted, fontSize: 12, textTransform: "uppercase" },
  valoreSolaLettura: { color: brand.colors.onSurface, fontSize: 15 },
  rigaSolaLettura: { gap: 2, borderTopWidth: 1, borderTopColor: brand.colors.border, paddingTop: 8 },
  input: { backgroundColor: brand.colors.surfaceSecondary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  selettoreRiga: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brand.colors.surfaceSecondary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  bottone: { backgroundColor: brand.colors.brand, padding: 12, borderRadius: 8, alignItems: "center", marginTop: 8 },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  fabModifica: {
    position: "absolute", right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28,
    backgroundColor: brand.colors.brandSecondary, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 5,
  },
  fabModificaTesto: { color: "#000", fontSize: 22, fontWeight: "700" },
});
