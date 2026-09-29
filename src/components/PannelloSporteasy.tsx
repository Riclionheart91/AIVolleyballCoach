import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Modal, ScrollView } from "react-native";
import { useFocusEffect } from "expo-router";
import { impostaLinkSporteasy, leggiIntegrazione, sincronizzaSporteasy, risolviClassificazioneSporteasy, type EventoDaClassificare } from "@/src/services/sporteasy";
import { brand } from "@/src/config";
import type { TeamIntegration } from "@/src/types/database";
import { avvisa } from "@/src/lib/confermaAzione";

type Tipo = "allenamento" | "partita" | "evento";
const ETICHETTA_TIPO: Record<Tipo, string> = { allenamento: "Allenamento", partita: "Partita", evento: "Ignora" };

/** Scelta corrente di una riga del popup: "manuale" true solo se toccata dall'allenatore (riga singola o pulsante globale non la sovrascrive più). */
interface ScelteRiga { valore: Tipo; manuale: boolean }

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
  const [pendenti, setPendenti] = useState<EventoDaClassificare[]>([]);
  const [scelte, setScelte] = useState<Record<string, ScelteRiga>>({});
  const [risolvendo, setRisolvendo] = useState(false);

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
      avvisa("Salvato", "Link calendario salvato. Ora premi \"Sincronizza ora\".");
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  function mostraRiepilogo(titolo: string, r: { allenamentiCreati?: number; allenamentiAggiornati?: number; partiteCreate?: number; partiteAggiornate?: number; eventiIgnorati?: number; totaleEventiNelCalendario?: number; byteScaricati?: number; blocchiVeventTrovati?: number; daClassificare?: EventoDaClassificare[]; erroriScrittura?: string[] }) {
    const righeErrore = r.erroriScrittura ?? [];
    const daClassificare = r.daClassificare ?? [];
    avvisa(
      righeErrore.length > 0 ? "Sincronizzazione con errori" : "Sincronizzazione completata",
      `Calendario scaricato: ${r.byteScaricati ?? 0} byte, ${r.blocchiVeventTrovati ?? 0} eventi grezzi trovati.\n` +
      `Eventi interpretati: ${r.totaleEventiNelCalendario}.\n` +
      `Allenamenti: ${r.allenamentiCreati} nuovi, ${r.allenamentiAggiornati} aggiornati.\n` +
      `Partite: ${r.partiteCreate} nuove, ${r.partiteAggiornate} aggiornate.` +
      (r.eventiIgnorati ? `\nEventi ignorati: ${r.eventiIgnorati}.` : "") +
      (daClassificare.length > 0 ? `\nNuovi titoli da classificare: ${daClassificare.length} (vedi il popup).` : "") +
      (righeErrore.length > 0 ? `\n\nERRORI DI SCRITTURA (${righeErrore.length}):\n${righeErrore.slice(0, 5).join("\n")}` : ""),
    );
  }

  function apriPopupClassificazione(eventi: EventoDaClassificare[]) {
    setPendenti(eventi);
    setScelte(Object.fromEntries(eventi.map((e) => [e.chiaveTitolo, { valore: e.suggerito, manuale: false } as ScelteRiga])));
  }

  async function sincronizza() {
    setSincronizzando(true);
    try {
      const r = await sincronizzaSporteasy(teamId);
      if (r.errore) { avvisa("Sincronizzazione fallita", r.messaggio ?? "Errore sconosciuto"); return; }
      setDettaglio(r.dettaglioClassificazione ?? []);
      mostraRiepilogo("Sincronizzazione completata", r);
      if (r.daClassificare && r.daClassificare.length > 0) apriPopupClassificazione(r.daClassificare);
      carica();
      onSincronizzato?.();
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setSincronizzando(false);
    }
  }

  function sceltaRiga(chiaveTitolo: string, valore: Tipo) {
    setScelte((prev) => ({ ...prev, [chiaveTitolo]: { valore, manuale: true } }));
  }

  /** Applica un tipo a tutte le righe non ancora scelte a mano (una per una o con un click globale precedente non conta come "a mano"), senza toccare quelle già decise singolarmente. */
  function sceltaGlobale(valore: Tipo) {
    setScelte((prev) => {
      const next = { ...prev };
      for (const p of pendenti) {
        if (!next[p.chiaveTitolo]?.manuale) next[p.chiaveTitolo] = { valore, manuale: false };
      }
      return next;
    });
  }

  async function confermaClassificazione() {
    setRisolvendo(true);
    try {
      const scelteInvio = Object.fromEntries(pendenti.map((p) => [p.chiaveTitolo, scelte[p.chiaveTitolo]?.valore ?? p.suggerito])) as Record<string, Tipo>;
      const r = await risolviClassificazioneSporteasy(teamId, scelteInvio);
      if (r.errore) { avvisa("Errore", r.messaggio ?? "Errore sconosciuto"); return; }
      setDettaglio(r.dettaglioClassificazione ?? []);
      mostraRiepilogo("Classificazione salvata", r);
      if (r.daClassificare && r.daClassificare.length > 0) {
        // Il calendario è cambiato nel frattempo (nuovi titoli
        // comparsi tra il download di prima e ora): si ripropone il
        // popup solo con quelli ancora da decidere.
        apriPopupClassificazione(r.daClassificare);
      } else {
        setPendenti([]);
        setScelte({});
      }
      carica();
      onSincronizzato?.();
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setRisolvendo(false);
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
                  <Text style={d.tipo === "partita" ? styles.tagPartita : d.tipo === "evento" ? styles.tagEvento : styles.tagAllenamento}>
                    {d.tipo === "partita" ? "PARTITA" : d.tipo === "evento" ? "IGNORATO" : "ALLENAMENTO"}
                  </Text> — {d.titolo}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      <Modal visible={pendenti.length > 0} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>Nuovi eventi da classificare</Text>
            <Text style={styles.notaPopup}>
              Questi titoli non sono mai stati visti prima per questa squadra: scegli cosa sono. La scelta resta in memoria, le prossime sincronizzazioni con lo stesso titolo si applicheranno da sole.
            </Text>

            <View style={styles.rigaGlobale}>
              <Text style={styles.etichettaGlobale}>Applica a tutti quelli non ancora scelti:</Text>
              <View style={styles.gruppoBottoni}>
                {(["allenamento", "partita", "evento"] as Tipo[]).map((t) => (
                  <Pressable key={t} style={styles.bottoneGlobale} onPress={() => sceltaGlobale(t)}>
                    <Text style={styles.bottoneGlobaleTesto}>{ETICHETTA_TIPO[t]}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <ScrollView style={styles.listaPendenti}>
              {pendenti.map((p) => {
                const corrente = scelte[p.chiaveTitolo]?.valore ?? p.suggerito;
                return (
                  <View key={p.chiaveTitolo} style={styles.rigaPendente}>
                    <Text style={styles.titoloPendente} numberOfLines={2}>{p.summary}</Text>
                    <Text style={styles.dataPendente}>{new Date(p.dataInizio).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}</Text>
                    <View style={styles.gruppoBottoni}>
                      {(["allenamento", "partita", "evento"] as Tipo[]).map((t) => (
                        <Pressable
                          key={t}
                          style={[styles.bottoneScelta, corrente === t && styles.bottoneSceltaAttivo]}
                          onPress={() => sceltaRiga(p.chiaveTitolo, t)}
                        >
                          <Text style={[styles.bottoneSceltaTesto, corrente === t && styles.bottoneSceltaTestoAttivo]}>{ETICHETTA_TIPO[t]}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <Pressable style={styles.bottoneConferma} onPress={confermaClassificazione} disabled={risolvendo}>
              {risolvendo ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneConfermaTesto}>Conferma classificazione ({pendenti.length})</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
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
  tagEvento: { color: brand.colors.muted, fontWeight: "700" },

  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 16 },
  cartaPopup: { backgroundColor: brand.colors.surface, borderRadius: 14, padding: 16, maxHeight: "85%", gap: 10 },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  notaPopup: { color: brand.colors.muted, fontSize: 12 },
  rigaGlobale: { gap: 6, borderBottomWidth: 1, borderBottomColor: brand.colors.surfaceTertiary, paddingBottom: 10 },
  etichettaGlobale: { color: brand.colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  listaPendenti: { flexGrow: 0 },
  rigaPendente: { gap: 6, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: brand.colors.surfaceTertiary },
  titoloPendente: { color: brand.colors.onSurface, fontSize: 13, fontWeight: "600" },
  dataPendente: { color: brand.colors.muted, fontSize: 11 },
  gruppoBottoni: { flexDirection: "row", gap: 8 },
  bottoneGlobale: { borderColor: brand.colors.muted, borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  bottoneGlobaleTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  bottoneScelta: { borderColor: brand.colors.brand, borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  bottoneSceltaAttivo: { backgroundColor: brand.colors.brand },
  bottoneSceltaTesto: { color: brand.colors.brand, fontSize: 12, fontWeight: "600" },
  bottoneSceltaTestoAttivo: { color: "#000" },
  bottoneConferma: { backgroundColor: brand.colors.brand, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  bottoneConfermaTesto: { color: "#000", fontWeight: "700", fontSize: 14 },
});
