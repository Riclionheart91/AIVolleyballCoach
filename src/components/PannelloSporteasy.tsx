import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { impostaLinkSporteasy, leggiIntegrazione, sincronizzaSporteasy } from "@/src/services/sporteasy";
import { brand } from "@/src/config";
import type { TeamIntegration } from "@/src/types/database";

/**
 * Pannello di sincronizzazione SportEasy, condiviso tra la tab
 * Allenamenti e la tab Partite: il calendario importa entrambe le
 * cose, quindi il pulsante deve essere raggiungibile da entrambe e
 * non solo da una (prima stava solo in Partite, dentro una sezione
 * chiusa di default — praticamente invisibile).
 */
export function PannelloSporteasy({ teamId, onSincronizzato }: { teamId: string; onSincronizzato?: () => void }) {
  const [integrazione, setIntegrazione] = useState<TeamIntegration | null>(null);
  const [link, setLink] = useState("");
  const [aperto, setAperto] = useState(false);
  const [sincronizzando, setSincronizzando] = useState(false);
  const [dettaglio, setDettaglio] = useState<{ titolo: string; tipo: string }[]>([]);

  const carica = useCallback(async () => {
    try {
      const i = await leggiIntegrazione(teamId);
      setIntegrazione(i);
      if (i?.sporteasy_ical_url) setLink(i.sporteasy_ical_url);
    } catch { /* integrazione non configurata: pannello comunque usabile per impostarla */ }
  }, [teamId]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function salvaLink() {
    if (!link.trim()) return;
    try {
      await impostaLinkSporteasy(teamId, link.trim());
      carica();
      Alert.alert("Salvato", "Link calendario salvato. Ora premi \"Sincronizza ora\".");
    } catch (e) { Alert.alert("Errore", (e as Error).message); }
  }

  async function sincronizza() {
    setSincronizzando(true);
    try {
      const r = await sincronizzaSporteasy(teamId);
      if (r.errore) { Alert.alert("Sincronizzazione fallita", r.messaggio ?? "Errore sconosciuto"); return; }
      setDettaglio(r.dettaglioClassificazione ?? []);
      const righeErrore = r.erroriScrittura ?? [];
      Alert.alert(
        righeErrore.length > 0 ? "Sincronizzazione con errori" : "Sincronizzazione completata",
        `Calendario scaricato: ${r.byteScaricati ?? 0} byte, ${r.blocchiVeventTrovati ?? 0} eventi grezzi trovati.\n` +
        `Eventi interpretati: ${r.totaleEventiNelCalendario}.\n` +
        `Allenamenti: ${r.allenamentiCreati} nuovi, ${r.allenamentiAggiornati} aggiornati.\n` +
        `Partite: ${r.partiteCreate} nuove, ${r.partiteAggiornate} aggiornate.` +
        (righeErrore.length > 0 ? `\n\nERRORI DI SCRITTURA (${righeErrore.length}):\n${righeErrore.slice(0, 5).join("\n")}` : ""),
      );
      carica();
      onSincronizzato?.();
    } catch (e) {
      Alert.alert("Errore", (e as Error).message);
    } finally {
      setSincronizzando(false);
    }
  }

  return (
    <View style={styles.contenitore}>
      <View style={styles.rigaPrincipale}>
        <Pressable onPress={() => setAperto(!aperto)} style={{ flex: 1 }}>
          <Text style={styles.titoloRiga}>
            {aperto ? "▾" : "▸"} SportEasy {integrazione?.ultima_sincronizzazione ? `· ultima: ${new Date(integrazione.ultima_sincronizzazione).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}` : "· mai sincronizzato"}
          </Text>
        </Pressable>
        <Pressable style={styles.bottoneSync} onPress={sincronizza} disabled={sincronizzando || !integrazione?.sporteasy_ical_url}>
          {sincronizzando ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneSyncTesto}>Sincronizza ora</Text>}
        </Pressable>
      </View>

      {!integrazione?.sporteasy_ical_url && (
        <Text style={styles.nota}>Nessun calendario collegato: apri la sezione qui sopra e incolla il link iCal della squadra.</Text>
      )}

      {aperto && (
        <View style={{ gap: 8, marginTop: 8 }}>
          <Text style={styles.nota}>Link iCal della squadra (SportEasy → Impostazioni squadra → Esporta calendario). Importa solo allenamenti e partite, mai l'anagrafica atlete.</Text>
          <TextInput style={styles.input} placeholder="webcal://calendar.sporteasy.net/..." placeholderTextColor={brand.colors.muted} autoCapitalize="none" value={link} onChangeText={setLink} />
          <Pressable style={styles.bottoneSecondario} onPress={salvaLink}><Text style={styles.bottoneSecondarioTesto}>Salva link</Text></Pressable>

          {integrazione?.ultimo_esito && integrazione.ultimo_esito !== "ok" && (
            <Text style={styles.errore}>Ultimo tentativo non riuscito: {integrazione.ultimo_esito}</Text>
          )}

          {dettaglio.length > 0 && (
            <View style={{ gap: 2 }}>
              <Text style={styles.nota}>Come sono stati classificati gli eventi trovati:</Text>
              {dettaglio.map((d, i) => (
                <Text key={i} style={styles.rigaClassificazione}>
                  <Text style={d.tipo === "partita" ? styles.tagPartita : styles.tagAllenamento}>{d.tipo === "partita" ? "PARTITA" : "ALLENAMENTO"}</Text> — {d.titolo}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  contenitore: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 12 },
  rigaPrincipale: { flexDirection: "row", alignItems: "center", gap: 10 },
  titoloRiga: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "600" },
  bottoneSync: { backgroundColor: brand.colors.brand, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, minWidth: 120, alignItems: "center" },
  bottoneSyncTesto: { color: "#000", fontWeight: "700", fontSize: 13 },
  nota: { color: brand.colors.muted, fontSize: 12 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  bottoneSecondario: { borderColor: brand.colors.brand, borderWidth: 1, padding: 10, borderRadius: 8, alignItems: "center" },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "600" },
  errore: { color: brand.colors.error, fontSize: 12 },
  rigaClassificazione: { color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  tagPartita: { color: brand.colors.brand, fontWeight: "700" },
  tagAllenamento: { color: brand.colors.brandSecondary, fontWeight: "700" },
});
