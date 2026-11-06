import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Switch, Platform } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { impostaLinkSporteasy, leggiIntegrazione } from "@/src/services/sporteasy";
import { chiamateAiResidueOggi, elencaProvider, LIMITE_CHIAMATE_AI_GIORNALIERO, riepilogoChiamateAI, salvaProvider, type AiProviderConfig, type RigaRiepilogoAI } from "@/src/services/aiProviders";
import { brand } from "@/src/config";
import { TitoloGrande } from "@/src/components/TitoloGrande";
import { etichetteDimensioneTesto, leggiScelta, salvaScelta, type ScelteDimensioneTesto } from "@/src/lib/dimensioneTesto";
import { avvisa } from "@/src/lib/confermaAzione";
import { leggiImpostazioniNotifiche, salvaImpostazioniNotifiche, IMPOSTAZIONI_NOTIFICHE_DEFAULT, type ImpostazioniNotificheEsercizio } from "@/src/lib/impostazioniEsercizio";
import { PannelloSporteasy } from "@/src/components/PannelloSporteasy";
import { ImpostazioniGesti } from "@/src/components/ImpostazioniGesti";
import {
  pushCertificatiSupportato,
  statoAbbonamentoPushCertificati,
  attivaNotifichePushCertificati,
  disattivaNotifichePushCertificati,
  inviaNotificaDiProva,
} from "@/src/lib/pushCertificati";
import {
  pushEventiSupportato,
  leggiPreferenzeNotificheEventi,
  impostaNotificaEvento,
  type PreferenzeNotificheEventi,
  type TipoNotificaEvento,
} from "@/src/lib/pushEventi";

const PROVIDER_CODICI = ["GEMINI", "GROQ", "OPENROUTER"] as const;

export default function Impostazioni() {
  const { team, ruolo, puoScrivere, isSuperuser } = useAuth();
  const [linkSporteasy, setLinkSporteasy] = useState("");
  const [providerSquadra, setProviderSquadra] = useState<AiProviderConfig[]>([]);
  const [providerGlobali, setProviderGlobali] = useState<AiProviderConfig[]>([]);
  const [riepilogoAI, setRiepilogoAI] = useState<RigaRiepilogoAI[]>([]);
  const [notificheEsercizio, setNotificheEsercizio] = useState<ImpostazioniNotificheEsercizio>(IMPOSTAZIONI_NOTIFICHE_DEFAULT);
  const [intervalloTesto, setIntervalloTesto] = useState(String(IMPOSTAZIONI_NOTIFICHE_DEFAULT.intervalloMinuti));
  const [pushCertificatiAttivo, setPushCertificatiAttivo] = useState(false);
  const [caricandoPush, setCaricandoPush] = useState(false);
  const [prefEventi, setPrefEventi] = useState<PreferenzeNotificheEventi>({ disponibile: false, partita_live: false, convocazioni: false });
  const [caricandoEventi, setCaricandoEventi] = useState(false);
  const [residueAI, setResidueAI] = useState<number | null>(null);

  const carica = useCallback(async () => {
    if (!team) return;
    const integ = await leggiIntegrazione(team.id).catch(() => null);
    if (integ?.sporteasy_ical_url) setLinkSporteasy(integ.sporteasy_ical_url);
    if (puoScrivere) {
      setProviderSquadra(await elencaProvider(team.id).catch(() => []));
      setRiepilogoAI(await riepilogoChiamateAI(team.id).catch(() => []));
    }
    if (isSuperuser) {
      setProviderGlobali(await elencaProvider(null).catch(() => []));
      setResidueAI(await chiamateAiResidueOggi(team.id).catch(() => null));
    }
    const imp = await leggiImpostazioniNotifiche();
    setNotificheEsercizio(imp);
    setIntervalloTesto(String(imp.intervalloMinuti));
    setPushCertificatiAttivo(await statoAbbonamentoPushCertificati().catch(() => false));
    setPrefEventi(await leggiPreferenzeNotificheEventi());
  }, [team, puoScrivere, isSuperuser]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function cambiaPushCertificati(attiva: boolean) {
    setCaricandoPush(true);
    try {
      if (attiva) await attivaNotifichePushCertificati();
      else await disattivaNotifichePushCertificati();
      setPushCertificatiAttivo(attiva);
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCaricandoPush(false);
    }
  }

  async function provaNotifica() {
    setCaricandoPush(true);
    try {
      await inviaNotificaDiProva();
      avvisa("Notifica di prova inviata", "Dovrebbe comparire tra pochi secondi nel centro notifiche del telefono.");
    } catch (e) {
      avvisa("Notifica di prova", (e as Error).message);
    } finally {
      setCaricandoPush(false);
    }
  }

  async function cambiaNotificaEvento(tipo: TipoNotificaEvento, attiva: boolean) {
    setCaricandoEventi(true);
    try {
      await impostaNotificaEvento(tipo, attiva);
      setPrefEventi((p) => ({ ...p, [tipo]: attiva }));
      setPushCertificatiAttivo(await statoAbbonamentoPushCertificati().catch(() => false));
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCaricandoEventi(false);
    }
  }

  async function aggiornaNotifiche(patch: Partial<ImpostazioniNotificheEsercizio>) {
    const nuove = { ...notificheEsercizio, ...patch };
    setNotificheEsercizio(nuove);
    await salvaImpostazioniNotifiche(nuove);
  }

  function onCambiaIntervallo(testo: string) {
    setIntervalloTesto(testo);
    const n = Number(testo);
    if (Number.isFinite(n) && n > 0) aggiornaNotifiche({ intervalloMinuti: n });
  }

  async function salvaSporteasy() {
    if (!team || !linkSporteasy.trim()) return;
    try {
      await impostaLinkSporteasy(team.id, linkSporteasy.trim());
      avvisa("Salvato", "Link calendario aggiornato.");
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  function rigaProvider(config: AiProviderConfig | undefined, codice: (typeof PROVIDER_CODICI)[number], teamId: string | null, lista: AiProviderConfig[], setLista: (l: AiProviderConfig[]) => void) {
    const attuale: AiProviderConfig = config ?? { id: "", team_id: teamId, provider_code: codice, enabled: true, priority: PROVIDER_CODICI.indexOf(codice) + 1, modello: null };

    async function aggiorna(patch: Partial<AiProviderConfig>) {
      const nuovo = { ...attuale, ...patch };
      try {
        await salvaProvider({ team_id: teamId, provider_code: codice, enabled: nuovo.enabled, priority: nuovo.priority, modello: nuovo.modello });
        setLista(lista.some((p) => p.provider_code === codice) ? lista.map((p) => (p.provider_code === codice ? { ...p, ...patch } : p)) : [...lista, nuovo]);
      } catch (e) { avvisa("Errore", (e as Error).message); }
    }

    return (
      <View key={codice} style={styles.rigaProvider}>
        <Text style={styles.rigaProviderNome}>{codice}</Text>
        <Switch value={attuale.enabled} onValueChange={(v) => aggiorna({ enabled: v })} trackColor={{ true: brand.colors.brand }} />
        <TextInput
          style={styles.inputPriorita}
          keyboardType="numeric"
          value={String(attuale.priority)}
          onChangeText={(t) => aggiorna({ priority: Number(t) || attuale.priority })}
        />
        <TextInput
          style={styles.inputModello}
          placeholder="modello (opzionale)"
          placeholderTextColor={brand.colors.muted}
          value={attuale.modello ?? ""}
          onChangeText={(t) => aggiorna({ modello: t || null })}
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contenuto}>
      <TitoloGrande titolo="Impostazioni" />
      {Platform.OS === "web" && (
        <View style={styles.card}>
          <Text style={styles.sezioneTitolo}>Dimensione del testo</Text>
          <Text style={styles.nota}>Di base segue la dimensione del testo impostata sul telefono. Puoi sceglierla a mano: vale per questo dispositivo e la pagina si ricarica.</Text>
          <View style={styles.selettoreFederazione}>
            {(Object.keys(etichetteDimensioneTesto) as ScelteDimensioneTesto[]).map((k) => (
              <Pressable key={k} style={[styles.chipDimensione, leggiScelta() === k && styles.chipFederazioneAttivo]} onPress={() => { salvaScelta(k); if (typeof window !== "undefined") window.location.reload(); }}>
                <Text style={[styles.chipFederazioneTesto, leggiScelta() === k && styles.chipFederazioneTestoAttivo]}>{k === "auto" ? "Automatica" : etichetteDimensioneTesto[k]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {ruolo !== "atleta" && <ImpostazioniGesti />}

      <View style={styles.card}>
        <Text style={styles.sezioneTitolo}>Avvisi durante l'esercizio</Text>
        <Text style={styles.nota}>Preferenza di questo dispositivo: quanto spesso ricevere un promemoria (vibrazione, suono e notifica) mentre un esercizio è in corso. L'avviso a 30 secondi dalla fine e quello di fine esercizio restano sempre attivi quando l'esercizio ha una durata prevista.</Text>
        <View style={styles.rigaNotifiche}>
          <Text style={styles.rigaProviderNome}>Promemoria periodico</Text>
          <Switch value={notificheEsercizio.notificaPeriodicaAttiva} onValueChange={(v) => aggiornaNotifiche({ notificaPeriodicaAttiva: v })} trackColor={{ true: brand.colors.brand }} />
        </View>
        {notificheEsercizio.notificaPeriodicaAttiva && (
          <View style={styles.rigaNotifiche}>
            <Text style={styles.rigaProviderNome}>Ogni quanti minuti</Text>
            <TextInput style={styles.inputPriorita} keyboardType="numeric" value={intervalloTesto} onChangeText={onCambiaIntervallo} />
          </View>
        )}
      </View>

      {(ruolo === "allenatore" || ruolo === "vice_allenatore" || ruolo === "atleta") && pushCertificatiSupportato() && (
        <View style={styles.card}>
          <Text style={styles.sezioneTitolo}>Notifiche push — certificati in scadenza</Text>
          <Text style={styles.nota}>
            {ruolo === "atleta"
              ? "Se il tuo certificato medico è in scadenza (entro 30 giorni) ricevi una notifica ogni venerdì mattina; se è già scaduto, ogni giorno. Compare nel centro notifiche del telefono, anche ad app chiusa."
              : "Ogni venerdì mattina ricevi l'elenco delle atlete con certificato medico scaduto o in scadenza entro 30 giorni; per i certificati già scaduti la notifica arriva ogni giorno. Compare nel centro notifiche del telefono, anche ad app chiusa."}
          </Text>
          <View style={styles.rigaNotifiche}>
            <Text style={styles.rigaProviderNome}>Attive su questo dispositivo</Text>
            <Switch value={pushCertificatiAttivo} onValueChange={cambiaPushCertificati} disabled={caricandoPush} trackColor={{ true: brand.colors.brand }} />
          </View>
          {pushCertificatiAttivo && (
            <Pressable style={styles.bottone} onPress={provaNotifica} disabled={caricandoPush} testID="notifica-di-prova">
              <Text style={styles.bottoneTesto}>Invia una notifica di prova</Text>
            </Pressable>
          )}
        </View>
      )}

      {ruolo != null && prefEventi.disponibile && pushEventiSupportato() && (
        <View style={styles.card} testID="impostazioni-notifiche-eventi">
          <Text style={styles.sezioneTitolo}>Notifiche push — partite e convocazioni</Text>
          <Text style={styles.nota}>Scegli quali avvisi ricevere su questo dispositivo, anche ad app chiusa. La prima volta il browser chiede il permesso per le notifiche.</Text>
          <View style={styles.rigaEvento}>
            <View style={styles.rigaEventoTesti}>
              <Text style={styles.rigaEventoTitolo}>Partita in diretta</Text>
              <Text style={styles.nota}>Quando inizia una partita della tua squadra.</Text>
            </View>
            <Switch value={prefEventi.partita_live} onValueChange={(v) => cambiaNotificaEvento("partita_live", v)} disabled={caricandoEventi} trackColor={{ true: brand.colors.brand }} />
          </View>
          {ruolo === "atleta" && (
            <View style={styles.rigaEvento}>
              <View style={styles.rigaEventoTesti}>
                <Text style={styles.rigaEventoTitolo}>Convocazioni</Text>
                <Text style={styles.nota}>Quando vieni convocata per una partita o la convocazione cambia.</Text>
              </View>
              <Switch value={prefEventi.convocazioni} onValueChange={(v) => cambiaNotificaEvento("convocazioni", v)} disabled={caricandoEventi} trackColor={{ true: brand.colors.brand }} />
            </View>
          )}
        </View>
      )}

      {/* Un solo punto per SportEasy: link del calendario e sincronizzazione di allenamenti e partite. */}
      {puoScrivere && team && <PannelloSporteasy teamId={team.id} />}

      {puoScrivere && (
        <View style={styles.card}>
          <Text style={styles.sezioneTitolo}>Provider AI — questa squadra</Text>
          <Text style={styles.nota}>Priorità più bassa = provato per primo. Lascia il modello vuoto per usare il default. Queste righe sovrascrivono, per la tua squadra, i default globali sotto (se presenti).</Text>
          {PROVIDER_CODICI.map((c) => rigaProvider(providerSquadra.find((p) => p.provider_code === c), c, team!.id, providerSquadra, setProviderSquadra))}
        </View>
      )}

      {puoScrivere && (
        <View style={styles.card}>
          <Text style={styles.sezioneTitolo}>Chiamate AI — ultimi 7 giorni</Text>
          <Text style={styles.nota}>Per ogni servizio e funzione: quante richieste, quante non sono andate a buon fine e quanto ci ha messo in media.</Text>
          {riepilogoAI.length === 0 ? (
            <Text style={styles.nota}>Nessuna chiamata registrata in questi giorni.</Text>
          ) : (
            riepilogoAI.map((r) => (
              <Text key={`${r.provider}-${r.funzione}`} style={styles.rigaRiepilogo}>
                {`${r.provider} · ${r.funzione}: ${r.chiamate} chiamate, ${r.errori} errori${r.durata_media_ms != null ? `, ${(r.durata_media_ms / 1000).toFixed(1)} s` : ""}`}
              </Text>
            ))
          )}
        </View>
      )}

      {isSuperuser && (
        <View style={styles.card}>
          <Text style={styles.sezioneTitolo}>Limite chiamate AI (superuser)</Text>
          <Text style={styles.nota}>
            Ogni squadra può fare al massimo {LIMITE_CHIAMATE_AI_GIORNALIERO} chiamate AI al giorno. Il tetto è per squadra e condiviso da tutte le funzioni (valutazioni, esercizi, piani, commenti e pareri sulle partite). Contano solo le chiamate riuscite e il conteggio riparte a mezzanotte UTC (l'1:00 in Italia con l'ora solare, le 2:00 con l'ora legale).
          </Text>
          <Text style={styles.rigaRiepilogo}>
            {residueAI === null
              ? "Oggi per questa squadra: dato non disponibile."
              : `Oggi per questa squadra: ${Math.max(0, LIMITE_CHIAMATE_AI_GIORNALIERO - residueAI)} usate, ${residueAI} ancora disponibili.`}
          </Text>
          <Text style={styles.nota}>Il valore è scritto nel database e nella funzione ai-router: per cambiarlo vanno modificati entrambi.</Text>
        </View>
      )}

      {isSuperuser && (
        <View style={styles.card}>
          <Text style={styles.sezioneTitolo}>Provider AI — default globali (superuser)</Text>
          <Text style={styles.nota}>Si applicano a tutte le squadre che non hanno impostato un proprio override sopra.</Text>
          {PROVIDER_CODICI.map((c) => rigaProvider(providerGlobali.find((p) => p.provider_code === c), c, null, providerGlobali, setProviderGlobali))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  contenuto: { padding: 16, paddingBottom: 48, gap: 18, width: "100%", maxWidth: 900, alignSelf: "center" },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 16, gap: 12 },
  sezioneTitolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  nota: { color: brand.colors.muted, fontSize: 13, lineHeight: 18 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, minHeight: 44 },
  bottone: { backgroundColor: brand.colors.brand, minHeight: 42, paddingHorizontal: 16, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 15 },
  rigaProvider: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  rigaNotifiche: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 44 },
  rigaEvento: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 56 },
  rigaEventoTesti: { flex: 1, minWidth: 0, gap: 2 },
  rigaEventoTitolo: { color: brand.colors.onSurface, fontWeight: "600", fontSize: 15 },
  rigaRiepilogo: { color: brand.colors.onSurface, fontSize: 14 },
  rigaProviderNome: { color: brand.colors.onSurface, fontWeight: "600", width: 90 },
  inputPriorita: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 10, padding: 6, width: 44, minHeight: 44, textAlign: "center" },
  inputModello: { flex: 1, minWidth: 0, minHeight: 44, backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13 },
  selettoreFederazione: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  chipDimensione: { minHeight: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  chipFederazione: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 14, backgroundColor: brand.colors.surfaceTertiary },
  chipFederazioneAttivo: { backgroundColor: brand.colors.brand },
  chipFederazioneTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  chipFederazioneTestoAttivo: { color: "#000", fontWeight: "700" },
});
