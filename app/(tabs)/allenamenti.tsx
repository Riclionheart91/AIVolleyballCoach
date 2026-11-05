import { useCallback, useRef, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, RefreshControl } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaAtlete } from "@/src/services/athletes";
import {
  aggiornaAllenamento, archiviaAllenamento, archiviaAllenamentiPassati, convertiAllenamentoInPartita, creaAllenamento, eliminaAllenamento, elencaAllenamenti,
  elencaPresenzeAllenamento, elencaRpeAllenamento, registraPresenza, registraRpe,
} from "@/src/services/trainings";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { FabAggiungi } from "@/src/components/Fab";
import { MenuAzioni } from "@/src/components/MenuAzioni";
import { PopupForm } from "@/src/components/PopupForm";
import { TitoloGrande } from "@/src/components/TitoloGrande";
import { brand } from "@/src/config";
import type { Athlete, Attendance, Rpe, Training } from "@/src/types/database";
import { TastoCestino } from "@/src/components/TastoCestino";

/** "2026-09-15 18:30" -> ISO. Formato semplice da digitare a mano, valido anche per date future. */
function testoADataIso(testo: string): string | null {
  const m = testo.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const [, anno, mese, giorno, ora = "09", min = "00"] = m;
  const d = new Date(Number(anno), Number(mese) - 1, Number(giorno), Number(ora), Number(min));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function dataIsoATesto(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "OGGI · 21:00" oppure "GIO 5 NOV · 21:00" per la scheda in evidenza. */
function etichettaQuando(iso: string): string {
  const d = new Date(iso);
  const ora = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const giorno = d.toDateString() === new Date().toDateString()
    ? "OGGI"
    : d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "").toUpperCase();
  return `${giorno} · ${ora}`;
}

/** Primo giorno del mese corrente, a mezzanotte locale. */
function meseCorrente(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function Allenamenti() {
  const { team, puoScrivere } = useAuth();
  const [allenamenti, setAllenamenti] = useState<Training[]>([]);
  // Si mostra un mese alla volta: con centinaia di sedute importate da
  // SportEasy un elenco unico diventa illeggibile.
  const [meseVisualizzato, setMeseVisualizzato] = useState(meseCorrente);
  // Se la app resta aperta per giorni (tipico di un sito web mai
  // ricaricato) il mese "corrente" catturato all'avvio invecchia: si
  // tiene traccia dell'ultimo mese reale visto e, se cambia, si
  // riparte da quello invece di restare bloccati su un mese passato.
  const ultimoMeseReale = useRef(meseVisualizzato.getTime());
  const [archiviati, setArchiviati] = useState<Training[]>([]);
  const [mostraArchivio, setMostraArchivio] = useState(false);
  const [aperto, setAperto] = useState<string | null>(null);
  const [popupAperto, setPopupAperto] = useState(false);
  const [allenamentoInModifica, setAllenamentoInModifica] = useState<Training | null>(null);
  const [titolo, setTitolo] = useState("Allenamento");
  const [dataTesto, setDataTesto] = useState(dataIsoATesto(new Date().toISOString()));

  const inizioMese = meseVisualizzato;
  const fineMese = new Date(meseVisualizzato.getFullYear(), meseVisualizzato.getMonth() + 1, 0, 23, 59, 59);

  const carica = useCallback(async () => {
    if (!team) return;
    setAllenamenti(await elencaAllenamenti(team.id, { daData: inizioMese.toISOString(), aData: fineMese.toISOString() }));
    if (mostraArchivio) setArchiviati(await elencaAllenamenti(team.id, { archiviato: true }));
  }, [team, meseVisualizzato, mostraArchivio]);

  function cambiaMese(delta: number) {
    setMeseVisualizzato((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  async function onArchiviaPassati() {
    if (!team) return;
    confermaAzione("Archiviare le sedute passate?", "Tutti gli allenamenti già svolti verranno spostati nell'archivio. Restano consultabili e ripristinabili.", "Archivia", async () => {
      try {
        const n = await archiviaAllenamentiPassati(team.id);
        carica();
        avvisa("Archiviati", `${n} allenamenti spostati nell'archivio.`);
      } catch (e) { avvisa("Errore", (e as Error).message); }
    });
  }

  async function onArchiviaSingolo(t: Training, archivia: boolean) {
    try { await archiviaAllenamento(t.id, archivia); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  // Ogni volta che si torna su questa schermata, si controlla se nel
  // frattempo è iniziato un mese nuovo (es. la tab è rimasta aperta da
  // ieri sera): in tal caso si passa al mese corrente vero, altrimenti
  // resta il mese che si stava sfogliando.
  useFocusEffect(useCallback(() => {
    const reale = meseCorrente();
    if (reale.getTime() !== ultimoMeseReale.current) {
      ultimoMeseReale.current = reale.getTime();
      setMeseVisualizzato(reale);
    }
  }, []));

  function apriNuovo() {
    setAllenamentoInModifica(null);
    setTitolo("Allenamento");
    setDataTesto(dataIsoATesto(new Date().toISOString()));
    setPopupAperto(true);
  }

  function apriModifica(t: Training) {
    setAllenamentoInModifica(t);
    setTitolo(t.titolo);
    setDataTesto(dataIsoATesto(t.data));
    setPopupAperto(true);
  }

  async function salva() {
    if (!team) return;
    const dataIso = testoADataIso(dataTesto);
    if (!dataIso) { avvisa("Data non valida", "Usa il formato AAAA-MM-GG oppure AAAA-MM-GG OO:MM (es. 2026-09-15 18:30). Puoi anche indicare una data futura."); return; }
    try {
      if (allenamentoInModifica) {
        await aggiornaAllenamento(allenamentoInModifica.id, { titolo: titolo.trim() || "Allenamento", data: dataIso });
      } else {
        await creaAllenamento(team.id, { data: dataIso, titolo: titolo.trim() || "Allenamento", note: "" });
      }
      setPopupAperto(false);
      carica();
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    }
  }

  function chiediConversione(t: Training) {
    confermaAzione(
      "Convertire in partita?",
      `"${t.titolo}" del ${new Date(t.data).toLocaleDateString("it-IT")} verrà spostato tra le partite. Usalo quando la lettura automatica del calendario SportEasy ha sbagliato categoria.`,
      "Sposta tra le partite",
      async () => {
        try {
          await convertiAllenamentoInPartita(t.id);
          carica();
          avvisa("Convertito", "Lo trovi ora nella tab Partite.");
        } catch (e) { avvisa("Impossibile convertire", (e as Error).message); }
      },
    );
  }

  function chiediEliminazione(t: Training) {
    confermaAzione("Eliminare l'allenamento?", `"${t.titolo}" e le presenze/RPE già registrate per questa sessione verranno eliminati.`, "Elimina", async () => {
      try { await eliminaAllenamento(t.id); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
    }, true);
  }

  const haModifiche = allenamentoInModifica
    ? titolo !== allenamentoInModifica.titolo || dataTesto !== dataIsoATesto(allenamentoInModifica.data)
    : titolo !== "Allenamento" || true;

  const oggiInizio = new Date();
  oggiInizio.setHours(0, 0, 0, 0);
  // Scheda in evidenza: la prima seduta (oggi o futura) del mese mostrato.
  const prossimo = allenamenti
    .filter((t) => new Date(t.data) >= oggiInizio)
    .sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime())[0] ?? null;
  const elenco = prossimo ? allenamenti.filter((t) => t.id !== prossimo.id) : allenamenti;

  /** Azioni della seduta (stesse funzioni di prima): pill Avvia/Piano/Modifica + link secondari. */
  function renderAzioni(item: Training) {
    if (!puoScrivere) return null;
    return (
      <View style={styles.azioniBlocco}>
        <View style={styles.rigaAzioniCard}>
          <Pressable style={styles.pillPrimaria} onPress={() => router.push(`/sessione/${item.id}`)}>
            <Text style={styles.pillPrimariaTesto}>▶ Avvia</Text>
          </Pressable>
          <Pressable style={styles.pillSecondaria} onPress={() => router.push(`/allenamento/${item.id}`)}>
            <Text style={styles.pillSecondariaTesto}>Piano{item.durata_totale_minuti ? ` · ${item.durata_totale_minuti}′` : ""}</Text>
          </Pressable>
          <Pressable style={styles.pillSecondaria} onPress={() => apriModifica(item)}>
            <Text style={styles.pillSecondariaTesto}>Modifica</Text>
          </Pressable>
          <MenuAzioni
            titolo={item.titolo}
            voci={[
              { etichetta: "È una partita", icona: "tennisball-outline", onPress: () => chiediConversione(item) },
              { etichetta: "Archivia", icona: "archive-outline", onPress: () => onArchiviaSingolo(item, true) },
              { etichetta: "Elimina", icona: "trash-outline", distruttiva: true, onPress: () => chiediEliminazione(item) },
            ]}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={elenco}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.contenuto}
        refreshControl={<RefreshControl refreshing={false} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListHeaderComponent={
          <View style={{ marginBottom: 12, gap: 14 }}>
            <TitoloGrande titolo="Allenamenti" />

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={[styles.barraMese, { flex: 1 }]}>
              <Pressable style={styles.frecciaArea} onPress={() => cambiaMese(-1)} hitSlop={10}><Text style={styles.frecciaMese}>‹</Text></Pressable>
              <Text style={styles.etichettaMese}>
                {meseVisualizzato.toLocaleDateString("it-IT", { month: "long", year: "numeric" })} · {allenamenti.length}
              </Text>
              <Pressable style={styles.frecciaArea} onPress={() => cambiaMese(1)} hitSlop={10}><Text style={styles.frecciaMese}>›</Text></Pressable>
            </View>
            {puoScrivere && (
              <MenuAzioni
                voci={[
                  { etichetta: mostraArchivio ? `Nascondi l'archivio (${archiviati.length})` : `Mostra l'archivio (${archiviati.length})`, icona: "file-tray-stacked-outline", onPress: () => setMostraArchivio(!mostraArchivio) },
                  { etichetta: "Archivia gli allenamenti passati", icona: "archive-outline", onPress: onArchiviaPassati },
                ]}
              />
            )}
            </View>

            {mostraArchivio && archiviati.length > 0 && (
              <View style={styles.gruppoArchiviati}>
                {archiviati.map((a, i) => (
                  <View key={a.id}>
                    {i > 0 && <View style={styles.separatore} />}
                    <View style={styles.rigaArchiviato}>
                      <Text style={styles.rigaArchiviatoTesto}>{a.titolo} — {new Date(a.data).toLocaleDateString("it-IT")}</Text>
                      <Pressable style={styles.linkArchivioArea} onPress={() => onArchiviaSingolo(a, false)}><Text style={styles.linkArchivio}>Ripristina</Text></Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {prossimo && (
              <View style={{ gap: 12 }}>
                <Text style={styles.titoloSezione}>Prossimo allenamento</Text>
                <View style={styles.schedaEvidenza}>
                  <View style={{ gap: 6 }}>
                    <Text style={styles.evidenzaQuando}>{etichettaQuando(prossimo.data)}</Text>
                    <Text style={styles.evidenzaTitolo}>{prossimo.titolo}</Text>
                    {!!prossimo.durata_totale_minuti && <Text style={styles.evidenzaSotto}>{prossimo.durata_totale_minuti} minuti</Text>}
                    {new Date(prossimo.data) > new Date() && <Text style={styles.badgeFuturo}>programmato</Text>}
                  </View>
                  {renderAzioni(prossimo)}
                </View>
              </View>
            )}

            {elenco.length > 0 && <Text style={styles.titoloSezione}>{prossimo ? "Altri del mese" : "Del mese"}</Text>}
          </View>
        }
        ListEmptyComponent={allenamenti.length === 0 ? <Text style={styles.vuoto}>Nessun allenamento in questo mese. Usa le frecce per cambiare mese, il pulsante + per aggiungerne uno, oppure sincronizza SportEasy dalle Impostazioni.</Text> : null}
        renderItem={({ item, index }) => {
          const d = new Date(item.data);
          return (
            <View style={[styles.rigaWrap, index === 0 && styles.rigaPrima, index === elenco.length - 1 && styles.rigaUltima]}>
              {index > 0 && <View style={styles.separatore} />}
              <View style={styles.riga}>
                <View style={styles.tessera}>
                  <Text style={styles.tesseraMese}>{d.toLocaleDateString("it-IT", { month: "short" }).replace(/\./g, "").toUpperCase()}</Text>
                  <Text style={styles.tesseraGiorno}>{d.getDate()}</Text>
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={styles.cardTitolo} numberOfLines={2}>{item.titolo}</Text>
                  <Text style={styles.cardSotto}>
                    {d.toLocaleDateString("it-IT", { weekday: "long" }).replace(/^./, (c) => c.toUpperCase())} · {d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                  {d > new Date() && <Text style={styles.badgeFuturo}>programmato</Text>}
                </View>
              </View>
              {puoScrivere && <View style={styles.azioniEspanse}>{renderAzioni(item)}</View>}

              {/* Presenze e RPE rimossi: le prestazioni si valutano
                  mensilmente e tramite scouting (globale, amichevole,
                  partita), non con un punteggio per seduta. */}
            </View>
          );
        }}
      />

      {puoScrivere && <FabAggiungi onPress={apriNuovo} />}

      <PopupForm visibile={popupAperto} titolo={allenamentoInModifica ? "Modifica allenamento" : "Nuovo allenamento"} haModifiche={haModifiche} onChiudi={() => setPopupAperto(false)}>
        <TextInput style={styles.input} placeholder="Titolo" placeholderTextColor={brand.colors.muted} value={titolo} onChangeText={setTitolo} autoFocus />
        <TextInput style={styles.input} placeholder="AAAA-MM-GG OO:MM" placeholderTextColor={brand.colors.muted} value={dataTesto} onChangeText={setDataTesto} />
        <Text style={styles.nota}>Puoi indicare anche una data futura, per programmare un allenamento in anticipo.</Text>
        <Pressable style={styles.bottone} onPress={salva}>
          <Text style={styles.bottoneTesto}>{allenamentoInModifica ? "Salva modifiche" : "Crea allenamento"}</Text>
        </Pressable>
      </PopupForm>
    </View>
  );
}

/** Allenatore/vice: un tap per atleta, niente form separati (stesso principio "poche interazioni per azione" dello scouting live). */
/**
 * Atleta/presidente: nessun controllo di scrittura. La RLS filtra già i
 * dati (un'atleta riceve solo la propria riga di presenza/RPE, mai
 * quelle delle compagne — il presidente le riceve tutte perché ha
 * visione piena) — qui ci limitiamo a mostrare quello che arriva.
 */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  contenuto: { padding: 16, paddingBottom: 90, width: "100%", maxWidth: 900, alignSelf: "center" },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 12, padding: 12, minHeight: 44 },
  nota: { color: brand.colors.muted, fontSize: 12 },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, alignItems: "center", minHeight: 42, justifyContent: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  titoloSezione: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  // Scheda in evidenza (prossimo allenamento)
  schedaEvidenza: { backgroundColor: brand.colors.surfaceSecondary, borderWidth: 1, borderColor: brand.colors.border, borderRadius: 22, padding: 18, gap: 14 },
  evidenzaQuando: { color: brand.colors.brand, fontSize: 12, fontWeight: "700", letterSpacing: 0.8 },
  evidenzaTitolo: { color: brand.colors.onSurface, fontSize: 24, fontWeight: "700", letterSpacing: -0.4 },
  evidenzaSotto: { color: brand.colors.onSurfaceSecondary, fontSize: 14 },
  // Elenco raggruppato: righe in un'unica scheda, separatore sottile rientrato
  rigaWrap: { backgroundColor: brand.colors.surfaceSecondary },
  rigaPrima: { borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  rigaUltima: { borderBottomLeftRadius: 18, borderBottomRightRadius: 18 },
  riga: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 14, minHeight: 64 },
  separatore: { height: 1, backgroundColor: brand.colors.border, marginLeft: 72 },
  tessera: { width: 46, height: 46, borderRadius: 11, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  tesseraMese: { color: brand.colors.brand, fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  tesseraGiorno: { color: brand.colors.onSurface, fontSize: 19, fontWeight: "700", lineHeight: 22 },
  cardTitolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  cardSotto: { color: brand.colors.muted, fontSize: 13 },
  badgeFuturo: { color: brand.colors.brandSecondary, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  // Azioni: pill con area di tocco adeguata
  azioniEspanse: { paddingHorizontal: 14, paddingBottom: 12 },
  azioniBlocco: { gap: 4 },
  rigaAzioniCard: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rigaLinkCard: { flexDirection: "row", flexWrap: "wrap", columnGap: 16 },
  pillPrimaria: { backgroundColor: brand.colors.brand, paddingHorizontal: 16, borderRadius: 999, minHeight: 42, justifyContent: "center", alignItems: "center" },
  pillPrimariaTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
  pillSecondaria: { backgroundColor: brand.colors.surfaceTertiary, paddingHorizontal: 16, borderRadius: 999, minHeight: 36, justifyContent: "center", alignItems: "center" },
  pillSecondariaTesto: { color: brand.colors.onSurface, fontWeight: "600", fontSize: 15 },
  linkAzione: { minHeight: 44, justifyContent: "center" },
  linkAzioneTesto: { color: brand.colors.muted, fontSize: 13, fontWeight: "600" },
  azioneCardDistruttiva: { color: brand.colors.error, fontSize: 13, fontWeight: "600" },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  barraMese: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, paddingHorizontal: 6, minHeight: 52 },
  frecciaArea: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  frecciaMese: { color: brand.colors.brand, fontSize: 26, fontWeight: "700", lineHeight: 28 },
  etichettaMese: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 15, textTransform: "capitalize" },
  rigaArchivio: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  linkArchivioArea: { minHeight: 44, justifyContent: "center" },
  linkArchivio: { color: brand.colors.brandSecondary, fontSize: 14, fontWeight: "600" },
  gruppoArchiviati: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, overflow: "hidden" },
  rigaArchiviato: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, paddingVertical: 4, paddingHorizontal: 14, minHeight: 48 },
  rigaArchiviatoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13, flex: 1 },
});
