import { useCallback, useState } from "react";
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
import { PannelloSporteasy } from "@/src/components/PannelloSporteasy";
import { PopupForm } from "@/src/components/PopupForm";
import { brand } from "@/src/config";
import type { Athlete, Attendance, Rpe, Training } from "@/src/types/database";

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

export default function Allenamenti() {
  const { team, puoScrivere } = useAuth();
  const [allenamenti, setAllenamenti] = useState<Training[]>([]);
  // Si mostra un mese alla volta: con centinaia di sedute importate da
  // SportEasy un elenco unico diventa illeggibile.
  const [meseVisualizzato, setMeseVisualizzato] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
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

  return (
    <View style={styles.container}>
      <FlatList
        data={allenamenti}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListHeaderComponent={
          <View style={{ marginBottom: 12, gap: 10 }}>
            {puoScrivere && team && <PannelloSporteasy teamId={team.id} onSincronizzato={carica} />}

            <View style={styles.barraMese}>
              <Pressable onPress={() => cambiaMese(-1)} hitSlop={10}><Text style={styles.frecciaMese}>‹</Text></Pressable>
              <Text style={styles.etichettaMese}>
                {meseVisualizzato.toLocaleDateString("it-IT", { month: "long", year: "numeric" })} · {allenamenti.length}
              </Text>
              <Pressable onPress={() => cambiaMese(1)} hitSlop={10}><Text style={styles.frecciaMese}>›</Text></Pressable>
            </View>

            {puoScrivere && (
              <View style={styles.rigaArchivio}>
                <Pressable onPress={() => setMostraArchivio(!mostraArchivio)}>
                  <Text style={styles.linkArchivio}>{mostraArchivio ? "▾" : "▸"} Archivio ({archiviati.length})</Text>
                </Pressable>
                <Pressable onPress={onArchiviaPassati}>
                  <Text style={styles.linkArchivio}>Archivia passati</Text>
                </Pressable>
              </View>
            )}

            {mostraArchivio && archiviati.map((a) => (
              <View key={a.id} style={styles.rigaArchiviato}>
                <Text style={styles.rigaArchiviatoTesto}>{a.titolo} — {new Date(a.data).toLocaleDateString("it-IT")}</Text>
                <Pressable onPress={() => onArchiviaSingolo(a, false)}><Text style={styles.linkArchivio}>Ripristina</Text></Pressable>
              </View>
            ))}
          </View>
        }
        ListEmptyComponent={<Text style={styles.vuoto}>Nessun allenamento in questo mese. Usa le frecce per cambiare mese, il pulsante + per aggiungerne uno, oppure sincronizza SportEasy qui sopra.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Pressable onPress={() => setAperto(aperto === item.id ? null : item.id)}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={styles.cardTitolo}>{item.titolo}</Text>
                {new Date(item.data) > new Date() && <Text style={styles.badgeFuturo}>programmato</Text>}
              </View>
              <Text style={styles.cardSotto}>{new Date(item.data).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" })}</Text>
            </Pressable>

            {puoScrivere && (
              <View style={styles.rigaAzioniCard}>
                <Pressable style={styles.bottoneAvvia} onPress={() => router.push(`/sessione/${item.id}`)}>
                  <Text style={styles.bottoneAvviaTesto}>▶ Avvia</Text>
                </Pressable>
                <Pressable style={styles.bottoneAzione} onPress={() => router.push(`/allenamento/${item.id}`)}>
                  <Text style={styles.bottoneAzioneTesto}>Piano{item.durata_totale_minuti ? ` · ${item.durata_totale_minuti}′` : ""}</Text>
                </Pressable>
                <Pressable style={styles.bottoneAzione} onPress={() => apriModifica(item)}>
                  <Text style={styles.bottoneAzioneTesto}>Modifica</Text>
                </Pressable>
                <Pressable style={styles.bottoneAzione} onPress={() => onArchiviaSingolo(item, true)}>
                  <Text style={styles.bottoneAzioneTesto}>Archivia</Text>
                </Pressable>
                <Pressable style={styles.bottoneAzione} onPress={() => chiediConversione(item)}>
                  <Text style={styles.bottoneAzioneTesto}>È una partita</Text>
                </Pressable>
                <Pressable onPress={() => chiediEliminazione(item)}><Text style={styles.azioneCardDistruttiva}>Elimina</Text></Pressable>
              </View>
            )}

            {/* Presenze e RPE rimossi: le prestazioni si valutano
                mensilmente e tramite scouting (globale, amichevole,
                partita), non con un punteggio per seduta. */}
          </View>
        )}
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
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 12 },
  nota: { color: brand.colors.muted, fontSize: 12 },
  bottone: { backgroundColor: brand.colors.brand, padding: 12, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTitolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  cardSotto: { color: brand.colors.muted, fontSize: 13 },
  badgeFuturo: { color: brand.colors.brandSecondary, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  // Pulsanti veri con area di tocco adeguata al posto dei link testuali:
  // su web e su telefono i link piccoli sono scomodi da centrare.
  rigaAzioniCard: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  bottoneAvvia: { backgroundColor: brand.colors.success, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, minHeight: 40, justifyContent: "center" },
  bottoneAvviaTesto: { color: "#000", fontWeight: "800", fontSize: 13 },
  bottoneAzione: { borderWidth: 1, borderColor: brand.colors.border, backgroundColor: brand.colors.surfaceTertiary, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, minHeight: 40, justifyContent: "center" },
  bottoneAzioneTesto: { color: brand.colors.onSurface, fontWeight: "600", fontSize: 13 },
  azioneCard: { color: brand.colors.brand, fontSize: 12, fontWeight: "600" },
  azioneCardAvvio: { color: brand.colors.success, fontSize: 12, fontWeight: "700" },
  azioneCardDistruttiva: { color: brand.colors.error, fontSize: 12, fontWeight: "600" },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  barraMese: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16 },
  frecciaMese: { color: brand.colors.brand, fontSize: 24, fontWeight: "700", lineHeight: 26 },
  etichettaMese: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 14, textTransform: "capitalize" },
  rigaArchivio: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  linkArchivio: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "600" },
  rigaArchiviato: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4, paddingLeft: 8 },
  rigaArchiviatoTesto: { color: brand.colors.muted, fontSize: 12, flex: 1 },
  presenzeContainer: { marginTop: 12, gap: 8, borderTopWidth: 1, borderTopColor: brand.colors.border, paddingTop: 12 },
  rigaAtleta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rigaAtletaNome: { color: brand.colors.onSurface, flex: 1 },
  rigaSolaLetturaValore: { color: brand.colors.muted, fontSize: 13 },
  presenzaBottoni: { flexDirection: "row", gap: 4 },
  presenzaBtn: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surfaceTertiary },
  presenzaBtnSi: { backgroundColor: brand.colors.success },
  presenzaBtnNo: { backgroundColor: brand.colors.error },
  presenzaBtnTesto: { color: "#fff", fontWeight: "700", fontSize: 12 },
  rpeBottoni: { flexDirection: "row", gap: 4 },
  rpeBtn: { width: 26, height: 26, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surfaceTertiary },
  rpeBtnAttivo: { backgroundColor: brand.colors.brand },
  rpeBtnTesto: { color: brand.colors.onSurface, fontSize: 11, fontWeight: "700" },
});
