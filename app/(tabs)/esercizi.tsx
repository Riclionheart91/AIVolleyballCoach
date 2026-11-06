import { useCallback, useMemo, useState } from "react";
import { View, Text, SectionList, TextInput, Pressable, StyleSheet, RefreshControl, Modal } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaEsercizi } from "@/src/services/exercises";
import { elencaAtlete } from "@/src/services/athletes";
import type { Athlete } from "@/src/types/database";
import { FabAggiungi } from "@/src/components/Fab";
import { CreaEsercizio } from "@/src/components/CreaEsercizio";
import { avvisa } from "@/src/lib/confermaAzione";
import { brand, fasiAllenamento } from "@/src/config";
import { TitoloGrande } from "@/src/components/TitoloGrande";
import type { Exercise } from "@/src/types/database";
import { SPAZIO_BARRA } from "@/src/lib/spazioBarra";

const SENZA_CATEGORIA = "Senza categoria";

export default function Esercizi() {
  const { team, puoScrivere } = useAuth();
  const [esercizi, setEsercizi] = useState<Exercise[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [ricerca, setRicerca] = useState("");
  // Chiuse di default: con decine di esercizi l'elenco tutto aperto è
  // proprio il problema di leggibilità segnalato. Si aprono a richiesta.
  const [categorieChiuse, setCategorieChiuse] = useState<Set<string> | null>(null);
  // Sottogruppi per categoria dentro una fase (es. "Attacco" dentro
  // "Allenamento tecnico"): chiusi di default, si aprono a richiesta —
  // come le fasi, ma un livello più in basso, per una vera navigazione
  // ad albero invece di ritrovarsi tutto già espanso.
  const [sottogruppiAperti, setSottogruppiAperti] = useState<Set<string>>(new Set());
  const [descrizioneAperta, setDescrizioneAperta] = useState<string | null>(null);
  // Il catalogo si legge per FASE (quando serve in seduta) e dentro ciascuna per categoria (che cosa allena).
  const [raggruppaPerFase, setRaggruppaPerFase] = useState(true);

  // Un'unica maschera di creazione (manuale o assistita dall'AI,
  // scelta dentro di essa), condivisa con la creazione al volo dal
  // piano di una seduta.
  const [popupCreazioneAperto, setPopupCreazioneAperto] = useState(false);
  const [modoCreazione, setModoCreazione] = useState<"manuale" | "ai">("manuale");
  const [atlete, setAtlete] = useState<Athlete[]>([]);

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      setEsercizi(await elencaEsercizi(team.id));
      setAtlete(await elencaAtlete(team.id).catch(() => []));
    } finally {
      setCaricamento(false);
    }
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  /** Una riga della lista: o l'intestazione di un sottogruppo (solo in modalità "per fase"), o un esercizio vero. */
  type RigaLista =
    | { tipo: "sottogruppo"; id: string; testo: string; aperto: boolean; totale: number }
    | { tipo: "esercizio"; id: string; es: Exercise };

  /** Raggruppa per fase e, dentro ciascuna, per categoria: due livelli, non uno solo. */
  const sezioni = useMemo(() => {
    const filtro = ricerca.trim().toLowerCase();
    const visibili = filtro
      ? esercizi.filter((e) => e.nome.toLowerCase().includes(filtro) || (e.categoria ?? "").toLowerCase().includes(filtro))
      : esercizi;

    const gruppi = visibili.reduce<Record<string, Exercise[]>>((acc, e) => {
      const chiave = raggruppaPerFase
        ? (fasiAllenamento.find((f) => f.codice === (e.fase_consigliata ?? "tecnico"))?.etichetta ?? "Allenamento tecnico")
        : (e.categoria?.trim() || SENZA_CATEGORIA);
      (acc[chiave] ??= []).push(e);
      return acc;
    }, {});

    // Per fase l'ordine è quello di svolgimento della seduta, non
    // alfabetico: riscaldamento prima, defaticamento in fondo.
    const ordinaChiavi = (a: string, b: string) => {
      if (!raggruppaPerFase) return a.localeCompare(b);
      const ordine = fasiAllenamento.map((f) => f.etichetta);
      return ordine.indexOf(a) - ordine.indexOf(b);
    };

    return Object.keys(gruppi).sort(ordinaChiavi).map((titolo) => {
      // Durante una ricerca le sezioni restano sempre aperte: chiuderle
      // nasconderebbe proprio i risultati cercati.
      // categorieChiuse === null significa "mai toccate": tutte chiuse.
      const chiusa = !filtro && (categorieChiuse === null || categorieChiuse.has(titolo));
      let righe: RigaLista[] = [];

      if (!chiusa) {
        const eserciziGruppo = [...gruppi[titolo]].sort((a, b) => a.nome.localeCompare(b.nome));
        if (raggruppaPerFase) {
          // Sottogruppo per categoria (Battuta, Muro, Palleggio...)
          // dentro la fase: un secondo livello di piegatura, chiuso di
          // default come il primo — vera navigazione ad albero invece
          // di ritrovarsi ogni fase già tutta espansa. Durante una
          // ricerca restano comunque aperti, per lo stesso motivo delle
          // fasi: altrimenti nasconderebbero i risultati cercati.
          const perCategoria: Record<string, Exercise[]> = {};
          for (const e of eserciziGruppo) {
            const cat = e.categoria?.trim() || SENZA_CATEGORIA;
            (perCategoria[cat] ??= []).push(e);
          }
          for (const cat of Object.keys(perCategoria).sort()) {
            const idSottogruppo = `sg-${titolo}-${cat}`;
            const apertoSottogruppo = !!filtro || sottogruppiAperti.has(idSottogruppo);
            righe.push({ tipo: "sottogruppo", id: idSottogruppo, testo: cat, aperto: apertoSottogruppo, totale: perCategoria[cat].length });
            if (apertoSottogruppo) {
              for (const e of perCategoria[cat]) righe.push({ tipo: "esercizio", id: e.id, es: e });
            }
          }
        } else {
          righe = eserciziGruppo.map((e) => ({ tipo: "esercizio", id: e.id, es: e }));
        }
      }

      return { titolo, totale: gruppi[titolo].length, data: righe };
    });
  }, [esercizi, ricerca, categorieChiuse, sottogruppiAperti, raggruppaPerFase]);

  function commutaCategoria(titolo: string) {
    setCategorieChiuse((prev) => {
      // BUG CORRETTO: qui si costruiva sempre l'insieme dai valori di
      // CATEGORIA, anche in modalità "per fase" — ma i titoli delle
      // sezioni lì sono nomi di FASE, che non compaiono mai in
      // quell'insieme. Risultato: nessuna fase risultava mai "chiusa",
      // quindi toccandone una si aprivano tutte insieme. L'insieme dei
      // titoli ora segue la modalità attiva, la stessa usata sopra per
      // costruire le sezioni.
      if (prev === null) {
        const tuttiITitoli = raggruppaPerFase
          ? fasiAllenamento.map((f) => f.etichetta)
          : [...new Set(esercizi.map((e) => e.categoria?.trim() || SENZA_CATEGORIA))];
        const tutte = new Set(tuttiITitoli);
        tutte.delete(titolo);
        return tutte;
      }
      const nuovo = new Set(prev);
      if (nuovo.has(titolo)) nuovo.delete(titolo);
      else nuovo.add(titolo);
      return nuovo;
    });
  }

  function commutaSottogruppo(id: string) {
    setSottogruppiAperti((prev) => {
      const nuovo = new Set(prev);
      if (nuovo.has(id)) nuovo.delete(id);
      else nuovo.add(id);
      return nuovo;
    });
  }

  function apriCreazione(modo: "manuale" | "ai") {
    setModoCreazione(modo);
    setPopupCreazioneAperto(true);
  }

  function onEserciziCreati(nuovi: Exercise[]) {
    setPopupCreazioneAperto(false);
    carica();
    if (nuovi.length > 1) avvisa("Aggiunti", `${nuovi.length} esercizi inseriti nel catalogo.`);
  }

  return (
    <View style={styles.container}>
      <SectionList
        sections={sezioni}
        keyExtractor={(r) => r.id}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.contenuto}
        refreshControl={<RefreshControl refreshing={caricamento} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 8 }}>
            <TitoloGrande titolo="Esercizi" />
            <View style={styles.segmenti}>
              <Pressable onPress={() => setRaggruppaPerFase(true)} style={[styles.segmento, raggruppaPerFase && styles.segmentoAttivo]}>
                <Text style={[styles.segmentoTesto, raggruppaPerFase && styles.segmentoTestoAttivo]}>Per fase</Text>
              </Pressable>
              <Pressable onPress={() => setRaggruppaPerFase(false)} style={[styles.segmento, !raggruppaPerFase && styles.segmentoAttivo]}>
                <Text style={[styles.segmentoTesto, !raggruppaPerFase && styles.segmentoTestoAttivo]}>Per categoria</Text>
              </Pressable>
            </View>
            <View style={styles.barraRicerca}>
              <TextInput
                style={styles.inputRicerca}
                placeholder={`Cerca tra ${esercizi.length} esercizi…`}
                placeholderTextColor={brand.colors.muted}
                value={ricerca}
                onChangeText={setRicerca}
              />
              {!!ricerca && <Pressable onPress={() => setRicerca("")} hitSlop={10} style={styles.tastoPulisci}><Text style={styles.pulisci}>✕</Text></Pressable>}
            </View>
          </View>
        }
        ListEmptyComponent={!caricamento ? <Text style={styles.vuoto}>{ricerca ? "Nessun esercizio trovato." : "Nessun esercizio ancora. Usa il + qui sotto: puoi crearli a mano o farli proporre dall'AI."}</Text> : null}
        renderSectionHeader={({ section }) => (
          <Pressable style={styles.intestazioneCategoria} onPress={() => commutaCategoria(section.titolo)}>
            <Text style={styles.titoloCategoria}>
              {(!ricerca && (categorieChiuse === null || categorieChiuse.has(section.titolo))) ? "▸" : "▾"} {section.titolo}
            </Text>
            <Text style={styles.conteggioCategoria}>{section.totale}</Text>
          </Pressable>
        )}
        renderItem={({ item, index, section }) => {
          // Riga di sottogruppo (Battuta, Muro, Palleggio...): solo
          // un'intestazione, non ha una propria scheda da aprire.
          if (item.tipo === "sottogruppo") {
            return (
              <Pressable style={styles.rigaSottogruppo} onPress={() => commutaSottogruppo(item.id)}>
                <Text style={styles.titoloSottogruppoCatalogo}>{item.aperto ? "▾" : "▸"} {item.testo}</Text>
                <Text style={styles.conteggioSottogruppo}>{item.totale}</Text>
              </Pressable>
            );
          }
          const es = item.es;
          const aperta = descrizioneAperta === es.id;
          // Le righe consecutive formano un'unica scheda raggruppata.
          const precedente = index > 0 ? section.data[index - 1] : undefined;
          const successivo = index < section.data.length - 1 ? section.data[index + 1] : undefined;
          const primaDelGruppo = !precedente || precedente.tipo !== "esercizio";
          const ultimaDelGruppo = !successivo || successivo.tipo !== "esercizio";
          return (
            <View style={[styles.rigaContenitore, primaDelGruppo && styles.rigaPrima, ultimaDelGruppo && styles.rigaUltima]}>
              {!primaDelGruppo && <View style={styles.separatore} />}
              {/* Un tocco apre la descrizione sul posto (serve durante
                  l'allenamento), la freccia porta alla scheda completa
                  per modificarla. */}
              <Pressable style={styles.rigaTesta} onPress={() => setDescrizioneAperta(aperta ? null : es.id)}>
                <View style={styles.tileEsercizio}><Text style={styles.tileEsercizioTesto}>{es.nome.trim().charAt(0).toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rigaNome}>{es.nome}</Text>
                  <Text style={styles.rigaSotto}>
                    {raggruppaPerFase
                      ? (es.categoria?.trim() || "senza categoria")
                      : (fasiAllenamento.find((f) => f.codice === (es.fase_consigliata ?? "tecnico"))?.etichetta ?? "")}
                  </Text>
                  {!!es.descrizione && !aperta && <Text style={styles.rigaDescrizione} numberOfLines={1}>{es.descrizione}</Text>}
                  {!es.descrizione && <Text style={styles.rigaDescrizione}>nessuna descrizione</Text>}
                </View>
                <Pressable onPress={() => router.push(`/esercizio/${es.id}`)} hitSlop={12} style={styles.tastoScheda}>
                  <Text style={styles.tastoSchedaTesto}>›</Text>
                </Pressable>
              </Pressable>
              {aperta && !!es.descrizione && <Text style={styles.rigaDescrizioneEstesa}>{es.descrizione}</Text>}
            </View>
          );
        }}
      />

      {puoScrivere && (
        <FabAggiungi onPress={() => apriCreazione("manuale")} />
      )}

      <Modal visible={popupCreazioneAperto} animationType="slide" transparent onRequestClose={() => setPopupCreazioneAperto(false)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <View style={styles.intestazionePopup}>
              <Text style={styles.titoloPopup}>Nuovo esercizio</Text>
              <Pressable onPress={() => setPopupCreazioneAperto(false)} style={styles.tastoChiudiPopup}><Text style={styles.chiudiPopup}>✕</Text></Pressable>
            </View>
            {team && (
              <CreaEsercizio
                teamId={team.id}
                eserciziEsistenti={esercizi}
                atlete={atlete}
                modoIniziale={modoCreazione}
                onCreati={onEserciziCreati}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  contenuto: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: SPAZIO_BARRA, width: "100%", maxWidth: 900, alignSelf: "center" },
  segmenti: { flexDirection: "row", backgroundColor: brand.colors.surfaceTertiary, borderRadius: 12, padding: 2 },
  segmento: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segmentoAttivo: { backgroundColor: brand.colors.brand },
  segmentoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14, fontWeight: "600" },
  segmentoTestoAttivo: { color: "#000", fontWeight: "700" },
  barraRicerca: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: brand.colors.surfaceTertiary, borderRadius: 12, paddingHorizontal: 12, minHeight: 44 },
  inputRicerca: { flex: 1, color: brand.colors.onSurface, paddingVertical: 10, fontSize: 16 },
  tastoPulisci: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -12 },
  pulisci: { color: brand.colors.muted, fontSize: 16 },
  intestazioneCategoria: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: brand.colors.surface, paddingTop: 12, paddingBottom: 8, minHeight: 48 },
  titoloCategoria: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  conteggioCategoria: { color: brand.colors.muted, fontSize: 14, fontWeight: "700" },
  rigaSottogruppo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 8, paddingBottom: 6, minHeight: 44 },
  titoloSottogruppoCatalogo: { color: brand.colors.muted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  conteggioSottogruppo: { color: brand.colors.muted, fontSize: 13, fontWeight: "700" },
  rigaContenitore: { backgroundColor: brand.colors.surfaceSecondary },
  rigaPrima: { borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: "hidden" },
  rigaUltima: { borderBottomLeftRadius: 18, borderBottomRightRadius: 18, overflow: "hidden", marginBottom: 6 },
  separatore: { height: 1, backgroundColor: brand.colors.border, marginLeft: 72 },
  rigaTesta: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 14, minHeight: 64 },
  tileEsercizio: { width: 46, height: 46, borderRadius: 11, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  tileEsercizioTesto: { color: brand.colors.brand, fontSize: 20, fontWeight: "700" },
  rigaDescrizioneEstesa: { color: brand.colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21, paddingBottom: 12, paddingHorizontal: 14 },
  tastoScheda: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -8 },
  tastoSchedaTesto: { color: brand.colors.brand, fontSize: 24, fontWeight: "700" },
  rigaNome: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  rigaSotto: { color: brand.colors.brandSecondary, fontSize: 13, marginTop: 1 },
  rigaDescrizione: { color: brand.colors.muted, fontSize: 13, marginTop: 2 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12, maxHeight: "88%", width: "100%", maxWidth: 640, alignSelf: "center" },
  intestazionePopup: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700" },
  chiudiPopup: { color: brand.colors.muted, fontSize: 18 },
  tastoChiudiPopup: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -12 },
});
