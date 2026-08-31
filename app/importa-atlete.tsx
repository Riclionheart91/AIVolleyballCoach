import { useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert, Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaAtlete } from "@/src/services/athletes";
import {
  CAMPI_IMPORTABILI,
  abbinaColonneAutomaticamente,
  analizzaRighe,
  eseguiImportWizard,
  leggiFileExcel,
  type CampoImportabile,
  type FileLetto,
  type RigaAnalizzata,
} from "@/src/services/importWizard";
import { brand } from "@/src/config";

type Passo = "scelta_file" | "abbinamento" | "revisione" | "completato";

export default function ImportaAtlete() {
  const { team } = useAuth();
  const [passo, setPasso] = useState<Passo>("scelta_file");
  const [caricamento, setCaricamento] = useState(false);
  const [fileLetto, setFileLetto] = useState<FileLetto | null>(null);
  const [mappatura, setMappatura] = useState<Record<CampoImportabile, string | null> | null>(null);
  const [righeAnalizzate, setRigheAnalizzate] = useState<RigaAnalizzata[]>([]);
  const [esito, setEsito] = useState<{ create: number; aggiornate: number; errori: number } | null>(null);

  async function scegliFile() {
    setCaricamento(true);
    try {
      const risultato = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ],
        copyToCacheDirectory: true,
      });
      if (risultato.canceled || !risultato.assets?.[0]) { setCaricamento(false); return; }
      const asset = risultato.assets[0];

      let letto: FileLetto;
      if (Platform.OS === "web" && "file" in asset && asset.file) {
        const buffer = await (asset.file as File).arrayBuffer();
        letto = leggiFileExcel(buffer, "array");
      } else {
        const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
        letto = leggiFileExcel(base64, "base64");
      }

      if (letto.intestazioni.length === 0) {
        Alert.alert("File vuoto", "Non ho trovato intestazioni di colonna nel file selezionato.");
        setCaricamento(false);
        return;
      }

      setFileLetto(letto);
      setMappatura(abbinaColonneAutomaticamente(letto.intestazioni));
      setPasso("abbinamento");
    } catch (e) {
      Alert.alert("Errore nella lettura del file", (e as Error).message);
    } finally {
      setCaricamento(false);
    }
  }

  async function confermaAbbinamento() {
    if (!team || !fileLetto || !mappatura) return;
    setCaricamento(true);
    try {
      const atlete = await elencaAtlete(team.id);
      setRigheAnalizzate(analizzaRighe(fileLetto.righe, mappatura, atlete));
      setPasso("revisione");
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    } finally {
      setCaricamento(false);
    }
  }

  function toggleRiga(indice: number) {
    setRigheAnalizzate((prev) => prev.map((r, i) => (i === indice ? { ...r, selezionata: !r.selezionata } : r)));
  }

  async function eseguiImport() {
    if (!team) return;
    setCaricamento(true);
    try {
      const risultato = await eseguiImportWizard(team.id, righeAnalizzate);
      setEsito({ create: risultato.create, aggiornate: risultato.aggiornate, errori: risultato.errori.length });
      if (risultato.errori.length > 0) {
        Alert.alert("Alcune righe non sono state importate", risultato.errori.map((e) => `${e.riga.datiFile.nome} ${e.riga.datiFile.cognome}: ${e.messaggio}`).join("\n"));
      }
      setPasso("completato");
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    } finally {
      setCaricamento(false);
    }
  }

  const nuove = righeAnalizzate.filter((r) => r.tipo === "nuova");
  const daAggiornare = righeAnalizzate.filter((r) => r.tipo === "aggiornamento");
  const invariate = righeAnalizzate.filter((r) => r.tipo === "invariata");
  const errori = righeAnalizzate.filter((r) => r.tipo === "errore");

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, gap: 16 }}>
      {passo === "scelta_file" && (
        <View style={styles.card}>
          <Text style={styles.titolo}>1. Scegli il file</Text>
          <Text style={styles.nota}>Excel (.xlsx) o CSV con un'atleta per riga e le intestazioni di colonna nella prima riga.</Text>
          <Pressable style={styles.bottone} onPress={scegliFile} disabled={caricamento}>
            {caricamento ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Scegli file</Text>}
          </Pressable>
        </View>
      )}

      {passo === "abbinamento" && fileLetto && mappatura && (
        <View style={styles.card}>
          <Text style={styles.titolo}>2. Abbina le colonne</Text>
          <Text style={styles.nota}>Ho provato ad abbinare da solo quello che riconoscevo. Controlla e correggi dove serve — "Nessuna corrispondenza" salta quel campo per tutte le righe.</Text>

          {CAMPI_IMPORTABILI.map(({ campo, etichetta, obbligatorio }) => (
            <View key={campo} style={styles.rigaMappatura}>
              <Text style={styles.rigaMappaturaLabel}>{etichetta}{obbligatorio ? " *" : ""}</Text>
              <View style={styles.selettoreRiga}>
                <Pressable
                  onPress={() => setMappatura({ ...mappatura, [campo]: null })}
                  style={[styles.chip, mappatura[campo] === null && styles.chipAttivo]}
                >
                  <Text style={[styles.chipTesto, mappatura[campo] === null && styles.chipTestoAttivo]}>Nessuna corrispondenza</Text>
                </Pressable>
                {fileLetto.intestazioni.map((h) => (
                  <Pressable key={h} onPress={() => setMappatura({ ...mappatura, [campo]: h })} style={[styles.chip, mappatura[campo] === h && styles.chipAttivo]}>
                    <Text style={[styles.chipTesto, mappatura[campo] === h && styles.chipTestoAttivo]}>{h}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}

          <Pressable style={styles.bottone} onPress={confermaAbbinamento} disabled={caricamento || !mappatura.nome || !mappatura.cognome}>
            {caricamento ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Continua ({fileLetto.righe.length} righe nel file)</Text>}
          </Pressable>
          {(!mappatura.nome || !mappatura.cognome) && <Text style={styles.erroreTesto}>Nome e Cognome sono obbligatori.</Text>}
        </View>
      )}

      {passo === "revisione" && (
        <View style={{ gap: 16 }}>
          <View style={styles.card}>
            <Text style={styles.titolo}>3. Rivedi e conferma</Text>
            <Text style={styles.nota}>
              {nuove.length} nuove · {daAggiornare.length} da aggiornare (deselezionabili) · {invariate.length} già identiche (nessuna azione) · {errori.length} scartate per errore
            </Text>
          </View>

          {daAggiornare.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sottotitolo}>Atlete con dati diversi da quelli già in anagrafica</Text>
              {daAggiornare.map((riga) => {
                const indice = righeAnalizzate.indexOf(riga);
                return (
                  <Pressable key={indice} style={styles.rigaAtleta} onPress={() => toggleRiga(indice)}>
                    <View style={[styles.checkbox, riga.selezionata && styles.checkboxSelezionato]}>
                      {riga.selezionata && <Text style={styles.checkboxSpunta}>✓</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rigaAtletaNome}>{riga.datiFile.nome} {riga.datiFile.cognome}</Text>
                      {riga.campiDiversi.map((c) => (
                        <Text key={c.campo} style={styles.rigaAtletaDiff}>
                          {c.campo}: <Text style={styles.diffVecchio}>{c.valoreAttuale || "(vuoto)"}</Text> → <Text style={styles.diffNuovo}>{c.valoreFile}</Text>
                        </Text>
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {nuove.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sottotitolo}>Nuove atlete da creare</Text>
              {nuove.map((riga) => (
                <Text key={riga.chiave} style={styles.rigaAtletaNome}>+ {riga.datiFile.nome} {riga.datiFile.cognome}</Text>
              ))}
            </View>
          )}

          {errori.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sottotitolo}>Righe scartate</Text>
              {errori.map((riga, i) => (
                <Text key={i} style={styles.erroreTesto}>{riga.errore} ({JSON.stringify(riga.datiFile)})</Text>
              ))}
            </View>
          )}

          <Pressable style={styles.bottone} onPress={eseguiImport} disabled={caricamento}>
            {caricamento ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Importa le righe selezionate</Text>}
          </Pressable>
        </View>
      )}

      {passo === "completato" && esito && (
        <View style={styles.card}>
          <Text style={styles.titolo}>Importazione completata</Text>
          <Text style={styles.nota}>{esito.create} atlete create, {esito.aggiornate} aggiornate{esito.errori > 0 ? `, ${esito.errori} con errori` : ""}.</Text>
          <Pressable style={styles.bottone} onPress={() => router.back()}>
            <Text style={styles.bottoneTesto}>Torna alle atlete</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 10 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  sottotitolo: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "700" },
  nota: { color: brand.colors.muted, fontSize: 13 },
  bottone: { backgroundColor: brand.colors.brand, padding: 12, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  erroreTesto: { color: brand.colors.error, fontSize: 12 },
  rigaMappatura: { gap: 6, borderTopWidth: 1, borderTopColor: brand.colors.border, paddingTop: 10 },
  rigaMappaturaLabel: { color: brand.colors.onSurface, fontWeight: "600", fontSize: 13 },
  selettoreRiga: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 14, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  rigaAtleta: { flexDirection: "row", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: brand.colors.border },
  rigaAtletaNome: { color: brand.colors.onSurface, fontWeight: "600" },
  rigaAtletaDiff: { color: brand.colors.muted, fontSize: 12 },
  diffVecchio: { color: brand.colors.error, textDecorationLine: "line-through" },
  diffNuovo: { color: brand.colors.success, fontWeight: "700" },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: brand.colors.brand, alignItems: "center", justifyContent: "center", marginTop: 2 },
  checkboxSelezionato: { backgroundColor: brand.colors.brand },
  checkboxSpunta: { color: "#000", fontWeight: "800", fontSize: 14 },
});
