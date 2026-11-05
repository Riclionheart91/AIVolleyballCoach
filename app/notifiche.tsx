import { useCallback, useState, type ComponentProps } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { calcolaNotifiche, nascondiAvvisoCertificato, type Notifica } from "@/src/services/notifiche";
import { confermaResetAccesso, linkAccesso, rifiutaResetAccesso, type ResetConfermato } from "@/src/services/accessi";
import { avvisa } from "@/src/lib/confermaAzione";
import type { Athlete } from "@/src/types/database";
import { brand } from "@/src/config";
import { TitoloGrande } from "@/src/components/TitoloGrande";
import { RinvioPromemoria } from "@/src/components/RinvioPromemoria";
import { MessaggioWhatsApp, linkChatAtleta, nomeFirmatario } from "@/src/components/MessaggioWhatsApp";
import { apriWhatsApp } from "@/src/lib/apriWhatsApp";
import { promemoriaCertificato, resetAccesso } from "@/src/lib/messaggiWhatsApp";

export default function CentroNotifiche() {
  const { team, puoScrivere, session } = useAuth();
  const [notifiche, setNotifiche] = useState<Notifica[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [whatsapp, setWhatsapp] = useState<Notifica | null>(null);
  const [resetPronto, setResetPronto] = useState<ResetConfermato | null>(null);
  const [inCorsoId, setInCorsoId] = useState<string | null>(null);

  /**
   * "Avvisa su WhatsApp": apre subito la chat con l'atleta e il messaggio gia' scritto, senza finestre intermedie.
   * Se l'atleta non ha un numero valido si apre la finestra che spiega cosa manca.
   */
  function avvisaCertificato(item: Notifica) {
    if (!team || !item.atleta || !item.scadenza) return;
    const link = linkChatAtleta(item.atleta, promemoriaCertificato(team.nome, item.scadenza), nomeFirmatario(session));
    if (!link) { setWhatsapp(item); return; }
    apriWhatsApp(link);
    // Mandato l'avviso la notifica sparisce (e torna 7 giorni prima della scadenza).
    nascondiAvvisoCertificato(item.atleta.id, item.scadenza).then(carica, carica);
  }

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      setNotifiche(await calcolaNotifiche(team.id, puoScrivere));
    } finally {
      setCaricamento(false);
    }
  }, [team, puoScrivere]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  /** Conferma: il server crea il nuovo link e si apre WhatsApp col messaggio per chi lo ha chiesto. */
  async function confermaReset(n: Notifica) {
    if (!n.richiesta) return;
    setInCorsoId(n.id);
    try {
      setResetPronto(await confermaResetAccesso(n.richiesta.id));
      carica();
    } catch (e) {
      avvisa("Conferma non riuscita", (e as Error).message);
    } finally {
      setInCorsoId(null);
    }
  }

  async function rifiutaReset(n: Notifica) {
    if (!n.richiesta) return;
    setInCorsoId(n.id);
    try {
      await rifiutaResetAccesso(n.richiesta.id);
      carica();
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setInCorsoId(null);
    }
  }

  function apri(n: Notifica) {
    if (n.link) router.push(n.link as never);
  }

  function rigaNotifica(item: Notifica, ultima: boolean) {
    const colore = item.tipo === "reset_accesso" || item.urgente
      ? brand.colors.error
      : item.tipo === "certificato_medico" ? brand.colors.warning : brand.colors.brandSecondary;
    const icona: ComponentProps<typeof Ionicons>["name"] =
      item.tipo === "reset_accesso" ? "lock-closed-outline"
      : item.tipo === "certificato_medico" ? "warning-outline"
      : item.tipo === "invito" ? "mail-outline"
      : item.tipo === "proposta_valutazione" ? "clipboard-outline"
      : "calendar-outline";
    return (
      <View key={item.id}>
        <Pressable style={styles.riga} onPress={() => apri(item)} disabled={!item.link}>
          <View style={styles.rigaTesta}>
            <View style={[styles.iconaQuadrata, { backgroundColor: `${colore}2E` }]}>
              <Ionicons name={icona} size={20} color={colore} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.rigaTitolo, item.tipo === "reset_accesso" && { fontWeight: "700" }]}>{item.titolo}</Text>
              <Text style={styles.rigaDescrizione}>{item.descrizione}</Text>
            </View>
            {item.link ? <Ionicons name="chevron-forward" size={16} color={brand.colors.muted} style={{ alignSelf: "center" }} /> : null}
          </View>
          {team && (item.tipo === "ciclo_valutazione" || item.tipo === "piano_annuale") && (
            <RinvioPromemoria teamId={team.id} tipo={item.tipo === "ciclo_valutazione" ? "valutazioni" : "piano_annuale"} onCambiato={carica} />
          )}
          {item.tipo === "reset_accesso" && item.richiesta && (
            <View style={styles.azioniReset}>
              <Pressable style={styles.bottonePrimario} onPress={() => confermaReset(item)} disabled={inCorsoId === item.id} hitSlop={6}>
                <Text style={styles.bottonePrimarioTesto}>{inCorsoId === item.id ? "Attendi…" : "Conferma e manda su WhatsApp"}</Text>
              </Pressable>
              <Pressable style={styles.bottoneRifiuta} onPress={() => rifiutaReset(item)} disabled={inCorsoId === item.id} hitSlop={6}>
                <Text style={styles.bottoneRifiutaTesto}>Rifiuta</Text>
              </Pressable>
            </View>
          )}
          {item.tipo === "certificato_medico" && item.atleta && (
            <Pressable style={styles.bottoneWhatsapp} onPress={() => avvisaCertificato(item)} hitSlop={6}>
              <Text style={styles.bottoneWhatsappTesto}>Avvisa su WhatsApp</Text>
            </Pressable>
          )}
        </Pressable>
        {!ultima && <View style={styles.separatore} />}
      </View>
    );
  }

  function sezione(titolo: string, lista: Notifica[], colore: string = brand.colors.muted) {
    if (lista.length === 0) return null;
    return (
      <View style={styles.sezione}>
        <Text style={[styles.titoloSezione, { color: colore }]}>{titolo}</Text>
        <View style={styles.scheda}>
          {lista.map((n, i) => rigaNotifica(n, i === lista.length - 1))}
        </View>
      </View>
    );
  }

  const daGestire = notifiche.filter((n) => n.tipo === "reset_accesso");
  const certificati = notifiche.filter((n) => n.tipo === "certificato_medico");
  const altre = notifiche.filter((n) => n.tipo !== "reset_accesso" && n.tipo !== "certificato_medico");

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.indietroArea}><Text style={styles.indietro}>← Indietro</Text></Pressable>
      </View>

      {caricamento ? (
        <ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.contenuto}>
          <TitoloGrande titolo="Notifiche" />
          {notifiche.length === 0 && <Text style={styles.vuoto}>Nessuna notifica al momento.</Text>}
          {sezione("Da gestire", daGestire, brand.colors.error)}
          {sezione("Certificati medici", certificati)}
          {sezione("Altro", altre)}
        </ScrollView>
      )}

      {resetPronto && (
        <MessaggioWhatsApp
          visibile
          titolo={`Nuovo accesso — ${resetPronto.nome}`}
          // Il destinatario non e' per forza un'atleta (puo' essere staff): il componente usa solo nome e telefono.
          atleta={{ nome: resetPronto.nome.split(" ")[0], cognome: resetPronto.nome.split(" ").slice(1).join(" "), telefono: resetPronto.telefono } as unknown as Athlete}
          modelli={[{ etichetta: "Reset accesso", testo: resetAccesso({ squadra: resetPronto.squadra, metodo: resetPronto.metodo, email: resetPronto.email, link: resetPronto.token ? linkAccesso(resetPronto.token) : null }) }]}
          onChiudi={() => setResetPronto(null)}
        />
      )}

      {team && whatsapp?.atleta && whatsapp.scadenza && (
        <MessaggioWhatsApp
          visibile
          titolo={`Certificato — ${whatsapp.atleta.nome} ${whatsapp.atleta.cognome}`}
          atleta={whatsapp.atleta}
          modelli={[{ etichetta: "Certificato", testo: promemoriaCertificato(team.nome, whatsapp.scadenza) }]}
          // Mandato l'avviso la notifica sparisce (e torna 7 giorni prima della scadenza): l'elenco si aggiorna alla chiusura.
          onInviato={() => { if (whatsapp.atleta && whatsapp.scadenza) nascondiAvvisoCertificato(whatsapp.atleta.id, whatsapp.scadenza); }}
          onChiudi={() => { setWhatsapp(null); carica(); }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8 },
  indietroArea: { minHeight: 44, justifyContent: "center" },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  contenuto: { padding: 16, paddingBottom: 48, gap: 18, width: "100%", maxWidth: 900, alignSelf: "center" },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  sezione: { gap: 6 },
  titoloSezione: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, paddingLeft: 4 },
  scheda: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, overflow: "hidden" },
  riga: { padding: 14, gap: 12, minHeight: 44 },
  rigaTesta: { flexDirection: "row", gap: 12 },
  iconaQuadrata: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  separatore: { height: 1, backgroundColor: brand.colors.border, marginLeft: 64 },
  rigaTitolo: { color: brand.colors.onSurface, fontWeight: "600", fontSize: 16 },
  rigaDescrizione: { color: brand.colors.onSurfaceSecondary, fontSize: 14 },
  azioniReset: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  bottonePrimario: { flexGrow: 1, flexBasis: 160, minHeight: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: brand.colors.brand, alignItems: "center", justifyContent: "center" },
  bottonePrimarioTesto: { color: "#000", fontSize: 15, fontWeight: "700" },
  bottoneRifiuta: { flexGrow: 1, flexBasis: 100, minHeight: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  bottoneRifiutaTesto: { color: brand.colors.error, fontSize: 15, fontWeight: "600" },
  bottoneWhatsapp: { minHeight: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: `${brand.colors.success}29`, alignItems: "center", justifyContent: "center" },
  bottoneWhatsappTesto: { color: brand.colors.success, fontSize: 14, fontWeight: "700" },
});
