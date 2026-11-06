import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, TextInput, Pressable, StyleSheet, PanResponder, Platform } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { archiviaAtleta, creaAtleta, elencaAtlete, elencaAtleteArchiviate, ripristinaAtleta } from "@/src/services/athletes";
import { FabMenu } from "@/src/components/Fab";
import { PopupForm } from "@/src/components/PopupForm";
import { brand, ruoliCampo } from "@/src/config";
import type { Athlete, RuoloCampo } from "@/src/types/database";
import { avvisa, confermaAzione } from "@/src/lib/confermaAzione";
import { MessaggioWhatsApp, numeroWhatsApp } from "@/src/components/MessaggioWhatsApp";
import { promemoriaSporteasy } from "@/src/lib/messaggiWhatsApp";
import { TitoloGrande } from "@/src/components/TitoloGrande";
import { SPAZIO_BARRA } from "@/src/lib/spazioBarra";
import { BarraRicerca } from "@/src/components/BarraRicerca";
import { ALTEZZA_TITOLO_COMPATTO, TitoloCompatto, stileFisso, useScorrimentoIOS } from "@/src/lib/scorrimentoIOS";
import { apriWhatsApp } from "@/src/lib/apriWhatsApp";
import { RigaScorrevole, type AzioneRiga } from "@/src/components/RigaScorrevole";
import { useGestoRiga } from "@/src/lib/preferenzeGesti";

/** Testo dentro l'avatar: il numero di maglia, o le iniziali se manca. */
function testoAvatar(a: Athlete): string {
  if (a.numero_maglia) return String(a.numero_maglia);
  return `${(a.nome ?? "").trim().charAt(0)}${(a.cognome ?? "").trim().charAt(0)}`.toUpperCase();
}

type StatoCertificato = "valido" | "in_scadenza" | "scaduto" | "mancante";
type FiltroCertificato = StatoCertificato | null;
type FiltroRuolo = RuoloCampo | null;
type SezioneRosa = { lettera: string; data: Athlete[] };

type VistaRosa = "az" | "ruolo";
const CHIAVE_VISTA_ROSA = "rosa-vista";
const ETICHETTA_SENZA_RUOLO = "Senza ruolo";

function leggiVista(): VistaRosa {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(CHIAVE_VISTA_ROSA) : null;
    return v === "ruolo" ? "ruolo" : "az";
  } catch { return "az"; }
}

function salvaVista(v: VistaRosa) {
  try { localStorage.setItem(CHIAVE_VISTA_ROSA, v); } catch { /* ignora */ }
}

const GIORNI_PREAVVISO_CERTIFICATO = 30;
const SOGLIA_INDICE_AZ = 12;

const opzioniCertificato: { valore: StatoCertificato; etichetta: string }[] = [
  { valore: "valido", etichetta: "Valido" },
  { valore: "in_scadenza", etichetta: "In scadenza" },
  { valore: "scaduto", etichetta: "Scaduto" },
  { valore: "mancante", etichetta: "Mancante" },
];

function dueCifre(n: number): string { return n < 10 ? `0${n}` : String(n); }
function isoLocale(d: Date): string { return `${d.getFullYear()}-${dueCifre(d.getMonth() + 1)}-${dueCifre(d.getDate())}`; }

/** Stato del certificato medico (stesse soglie del centro notifiche: scaduto, in scadenza entro 30 giorni). */
function statoCertificato(a: Athlete, oggi: string, soglia: string): StatoCertificato {
  const raw = (a.scadenza_certificato_medico ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "mancante";
  if (raw < oggi) return "scaduto";
  if (raw <= soglia) return "in_scadenza";
  return "valido";
}

/** Minuscolo e senza accenti, per confronti di ricerca e ordinamento. */
function normalizza(t: string | null | undefined): string {
  return (t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Lettera iniziale del cognome (A-Z, senza accenti); "#" per tutto il resto. */
function letteraIniziale(a: Athlete): string {
  const l = normalizza(a.cognome).charAt(0).toUpperCase();
  return /^[A-Z]$/.test(l) ? l : "#";
}

function corrisponde(a: Athlete, token: string): boolean {
  if (/^\d+$/.test(token)) return a.numero_maglia != null && String(a.numero_maglia).startsWith(token);
  return `${normalizza(a.nome)} ${normalizza(a.cognome)} ${normalizza(a.cognome)} ${normalizza(a.nome)}`.includes(token);
}

export default function Atlete() {
  const { team, puoScrivere } = useAuth();
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [archiviate, setArchiviate] = useState<Athlete[]>([]);
  const [mostraArchiviate, setMostraArchiviate] = useState(false);
  const [caricamento, setCaricamento] = useState(true);
  const [popupAperto, setPopupAperto] = useState(false);
  const [reminderSporteasy, setReminderSporteasy] = useState(false);
  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [ruoloCampo, setRuoloCampo] = useState<RuoloCampo | null>(null);
  const [ricerca, setRicerca] = useState("");
  const [filtroRuolo, setFiltroRuolo] = useState<FiltroRuolo>(null);
  const [filtroCertificato, setFiltroCertificato] = useState<FiltroCertificato>(null);
  const [vista, setVista] = useState<VistaRosa>(leggiVista);
  const scrollRef = useRef<ScrollView>(null);
  const posizioneSezioni = useRef<Record<string, number>>({});
  // Altezza del blocco fisso (ricerca + ruoli): le lettere A–Z si fermano subito sotto.
  const [altezzaFissa, setAltezzaFissa] = useState(96);
  const lettereRef = useRef<View>(null);
  const finestraIndice = useRef({ top: 0, altezza: 0 });
  const nascondiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const letteraCorrente = useRef<string | null>(null);
  const sezioniRef = useRef<SezioneRosa[]>([]);
  const [altezzaContenitoreIndice, setAltezzaContenitoreIndice] = useState(0);
  const [posizioneLettere, setPosizioneLettere] = useState(0);
  const [letteraBolla, setLetteraBolla] = useState<string | null>(null);

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      setAtlete(await elencaAtlete(team.id));
      if (mostraArchiviate) setArchiviate(await elencaAtleteArchiviate(team.id));
    } finally {
      setCaricamento(false);
    }
  }, [team, puoScrivere, mostraArchiviate]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  const filtriAttivi = !!ricerca.trim() || filtroRuolo !== null || filtroCertificato !== null;

  // Stato del certificato per atleta (solo chi può scrivere vede e filtra i dati medici).
  const statiCertificato = useMemo(() => {
    const mappa: Record<string, StatoCertificato> = {};
    const adesso = new Date();
    const oggi = isoLocale(adesso);
    const soglia = isoLocale(new Date(adesso.getFullYear(), adesso.getMonth(), adesso.getDate() + GIORNI_PREAVVISO_CERTIFICATO));
    for (const a of atlete) mappa[a.id] = statoCertificato(a, oggi, soglia);
    return mappa;
  }, [atlete]);

  const sezioni = useMemo<SezioneRosa[]>(() => {
    const token = normalizza(ricerca).split(/\s+/).filter(Boolean);
    const filtrate = atlete.filter((a) => {
      if (filtroRuolo && a.ruolo_campo !== filtroRuolo) return false;
      if (puoScrivere && filtroCertificato && statiCertificato[a.id] !== filtroCertificato) return false;
      return token.every((t) => corrisponde(a, t));
    });
    filtrate.sort((x, y) =>
      normalizza(x.cognome).localeCompare(normalizza(y.cognome), "it") ||
      normalizza(x.nome).localeCompare(normalizza(y.nome), "it"));
    if (vista === "ruolo") {
      // Per ruolo: nell'ordine dei ruoli in campo, con chi non ha un ruolo in fondo (dentro ogni ruolo resta l'ordine A-Z).
      const ordine: string[] = [...ruoliCampo, ETICHETTA_SENZA_RUOLO];
      return ordine
        .map((r) => ({ lettera: r, data: filtrate.filter((a) => (a.ruolo_campo ?? ETICHETTA_SENZA_RUOLO) === r) }))
        .filter((g) => g.data.length > 0);
    }
    const gruppi = new Map<string, Athlete[]>();
    for (const a of filtrate) {
      const l = letteraIniziale(a);
      const g = gruppi.get(l);
      if (g) g.push(a); else gruppi.set(l, [a]);
    }
    return Array.from(gruppi.entries())
      .sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)))
      .map(([lettera, data]) => ({ lettera, data }));
  }, [atlete, ricerca, filtroRuolo, filtroCertificato, puoScrivere, statiCertificato, vista]);

  const visibili = useMemo(() => sezioni.reduce((n, s) => n + s.data.length, 0), [sezioni]);
  const mostraIndice = vista === "az" && visibili >= SOGLIA_INDICE_AZ;

  const { scrollY, propsLista, indicatore } = useScorrimentoIOS(carica);
  const gestoRosa = useGestoRiga("rosa");

  /** Azione dello scorrimento di lato su una riga (scelta in Impostazioni; spenta di default). */
  function azioneSwipe(a: Athlete): AzioneRiga | null {
    if (gestoRosa === "whatsapp") {
      return { etichetta: "WhatsApp", icona: "logo-whatsapp", colore: "#25D366", onPress: () => {
        const n = numeroWhatsApp(a.telefono);
        if (!n) { avvisa("Numero mancante", `${a.nome} non ha un numero di telefono valido nella scheda.`); return; }
        apriWhatsApp(`https://wa.me/${n}`);
      } };
    }
    if (gestoRosa === "archivia" && puoScrivere) {
      return { etichetta: "Archivia", icona: "archive-outline", colore: "#8E8E93", onPress: () => {
        confermaAzione("Archiviare l'atleta?", `"${a.nome} ${a.cognome}" non comparirà più negli elenchi attivi e perderà l'accesso all'app. Puoi ripristinarla dalla Rosa archiviata.`, "Archivia", async () => {
          try { await archiviaAtleta(a.id); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
        }, true);
      } };
    }
    return null;
  }

  function azzeraFiltri() {
    setRicerca(""); setFiltroRuolo(null); setFiltroCertificato(null);
  }

  sezioniRef.current = sezioni;

  // Altezza di ogni lettera dell'indice: 22 px, o meno se le lettere non entrano nello schermo.
  const altezzaLettera = Math.max(12, Math.min(22, Math.floor((altezzaContenitoreIndice - 12) / Math.max(1, sezioni.length))));

  function vaiALettera(lettera: string, animato: boolean) {
    const y = posizioneSezioni.current[lettera];
    if (y == null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - ALTEZZA_TITOLO_COMPATTO - altezzaFissa), animated: animato });
  }

  function mostraBolla(lettera: string) {
    if (nascondiTimer.current) { clearTimeout(nascondiTimer.current); nascondiTimer.current = null; }
    setLetteraBolla(lettera);
  }

  function nascondiBollaTra(ms: number) {
    if (nascondiTimer.current) clearTimeout(nascondiTimer.current);
    nascondiTimer.current = setTimeout(() => { setLetteraBolla(null); letteraCorrente.current = null; }, ms);
  }

  useEffect(() => () => { if (nascondiTimer.current) clearTimeout(nascondiTimer.current); }, []);

  // Dito (o mouse) sull'indice: la lettera sotto il dito è quella selezionata, anche trascinando.
  function selezionaDaPosizione(pageY: number) {
    const elenco = sezioniRef.current;
    const { top, altezza } = finestraIndice.current;
    if (elenco.length === 0 || altezza <= 0) return;
    const passo = altezza / elenco.length;
    const i = Math.max(0, Math.min(elenco.length - 1, Math.floor((pageY - top) / passo)));
    const lettera = elenco[i].lettera;
    mostraBolla(lettera);
    if (letteraCorrente.current !== lettera) {
      letteraCorrente.current = lettera;
      vaiALettera(lettera, false);
    }
  }

  const gestoIndice = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        const y = evt.nativeEvent.pageY;
        letteraCorrente.current = null;
        const nodo = lettereRef.current;
        if (!nodo) return;
        nodo.measureInWindow((_x, top, _w, altezza) => {
          finestraIndice.current = { top, altezza };
          selezionaDaPosizione(y);
        });
      },
      onPanResponderMove: (_evt, gesto) => selezionaDaPosizione(gesto.moveY),
      onPanResponderRelease: () => nascondiBollaTra(500),
      onPanResponderTerminate: () => nascondiBollaTra(500),
    }),
  ).current;

  function renderRiga(item: Athlete, index: number, totale: number) {
    const statoCert = puoScrivere ? statiCertificato[item.id] : undefined;
    return (
      <View
        key={item.id}
        style={[
          styles.rigaContenitore,
          index === 0 && styles.rigaPrima,
          index === totale - 1 && styles.rigaUltima,
        ]}
      >
        {index > 0 && <View style={styles.separatore} />}
        <RigaScorrevole azione={azioneSwipe(item)}>
        <Pressable style={styles.riga} onPress={() => router.push(`/atleta/${item.id}`)}>
          <View style={styles.avatar}><Text style={styles.avatarTesto}>{testoAvatar(item)}</Text></View>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={styles.rigaNome} numberOfLines={1}>{item.nome} {item.cognome}</Text>
            {!!item.ruolo_campo && <Text style={styles.rigaSotto}>{item.ruolo_campo}{item.numero_maglia ? ` — n. ${item.numero_maglia}` : ""}</Text>}
          </View>
          {(statoCert === "scaduto" || statoCert === "in_scadenza") && (
            <View
              accessible
              accessibilityLabel={statoCert === "scaduto" ? "Certificato medico scaduto" : "Certificato medico in scadenza"}
              style={[styles.puntoCertificato, { backgroundColor: statoCert === "scaduto" ? brand.colors.error : brand.colors.warning }]}
            />
          )}
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        </RigaScorrevole>
      </View>
    );
  }

  async function aggiungi() {
    if (!team || !nome.trim() || !cognome.trim()) return;
    await creaAtleta(team.id, { nome: nome.trim(), cognome: cognome.trim(), ruolo_campo: ruoloCampo, numero_maglia: null, data_nascita: null });
    setNome(""); setCognome(""); setRuoloCampo(null); setPopupAperto(false);
    carica();
  }

  async function ripristina(id: string) {
    try { await ripristinaAtleta(id); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  return (
    <View style={styles.container}>
      <TitoloCompatto titolo="Rosa" scrollY={scrollY} />
      {indicatore}
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.contenuto, mostraIndice && styles.contenutoConIndice]}
        {...propsLista}
      >
          <>
            <TitoloGrande
              titolo="Rosa"
              sottotitolo={team ? `${team.nome} · ${filtriAttivi ? `${visibili} di ${atlete.length}` : atlete.length} ${(filtriAttivi ? visibili : atlete.length) === 1 ? "atleta" : "atlete"}` : undefined}
            />
            <View style={styles.selettoreVista} accessibilityRole="tablist">
              {([["az", "A–Z"], ["ruolo", "Per ruolo"]] as const).map(([v, etichetta]) => (
                <Pressable
                  key={v}
                  testID={`rosa-vista-${v}`}
                  onPress={() => { setVista(v); salvaVista(v); scrollRef.current?.scrollTo({ y: 0, animated: false }); }}
                  style={[styles.vistaOpzione, vista === v && styles.vistaOpzioneAttiva]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: vista === v }}
                >
                  <Text style={[styles.vistaTesto, vista === v && styles.vistaTestoAttivo]}>{etichetta}</Text>
                </Pressable>
              ))}
            </View>
            <View
              style={[stileFisso, styles.bloccoFisso, mostraIndice && styles.bloccoFissoConIndice]}
              onLayout={(e) => setAltezzaFissa(e.nativeEvent.layout.height)}
            >
              <BarraRicerca
                testID="rosa-ricerca"
                value={ricerca}
                onChangeText={setRicerca}
                placeholder="Cerca per nome, cognome o numero"
                accessibilityLabel="Cerca atlete per nome, cognome o numero di maglia"
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.filtriScroll} contentContainerStyle={styles.filtriRiga}>
              <Pressable onPress={() => setFiltroRuolo(null)} hitSlop={{ top: 8, bottom: 8 }} style={[styles.chipFiltro, filtroRuolo === null && styles.chipAttivo]}>
                <Text style={[styles.chipTesto, styles.chipFiltroTesto, filtroRuolo === null && styles.chipTestoAttivo]}>Tutte</Text>
              </Pressable>
              {ruoliCampo.map((r) => (
                <Pressable key={r} onPress={() => setFiltroRuolo(filtroRuolo === r ? null : r)} hitSlop={{ top: 8, bottom: 8 }} style={[styles.chipFiltro, filtroRuolo === r && styles.chipAttivo]}>
                  <Text style={[styles.chipTesto, styles.chipFiltroTesto, filtroRuolo === r && styles.chipTestoAttivo]}>{r}</Text>
                </Pressable>
              ))}
              </ScrollView>
            </View>
            {puoScrivere && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.filtriScroll} contentContainerStyle={styles.filtriRiga}>
                <Text style={styles.etichettaFiltro}>Certificato</Text>
                {opzioniCertificato.map((o) => (
                  <Pressable key={o.valore} onPress={() => setFiltroCertificato(filtroCertificato === o.valore ? null : o.valore)} hitSlop={{ top: 8, bottom: 8 }} style={[styles.chipFiltro, filtroCertificato === o.valore && styles.chipAttivo]}>
                    <Text style={[styles.chipTesto, styles.chipFiltroTesto, filtroCertificato === o.valore && styles.chipTestoAttivo]}>{o.etichetta}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            {puoScrivere && (
              <Pressable style={styles.bottoneReminder} onPress={() => setReminderSporteasy(true)}>
                <View style={styles.iconaReminder}><Text style={styles.iconaReminderTesto}>💬</Text></View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={styles.bottoneReminderTitolo}>Promemoria SportEasy</Text>
                  <Text style={styles.bottoneReminderSotto}>Ricorda alle atlete di aggiornare la scheda su SportEasy</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            )}
            {puoScrivere && (
              <Pressable style={styles.rigaEspandi} onPress={() => setMostraArchiviate(!mostraArchiviate)}>
                <Text style={styles.rigaEspandiTesto}>{mostraArchiviate ? "▾" : "▸"} Rosa archiviate ({archiviate.length})</Text>
              </Pressable>
            )}
            {mostraArchiviate && archiviate.length > 0 && (
              <View style={[styles.scheda, { marginBottom: 16 }]}>
                {archiviate.map((a, i) => (
                  <View key={a.id}>
                    {i > 0 && <View style={styles.separatore} />}
                    <View style={styles.rigaArchiviata}>
                      <View style={[styles.avatar, styles.avatarSpento]}><Text style={[styles.avatarTesto, { color: brand.colors.muted }]}>{testoAvatar(a)}</Text></View>
                      <Text style={[styles.rigaNome, { flex: 1 }]} numberOfLines={1}>{a.nome} {a.cognome}</Text>
                      <Pressable onPress={() => ripristina(a.id)} style={styles.bottoneRipristina}>
                        <Text style={styles.bottoneRipristinaTesto}>Ripristina</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>

        {caricamento || sezioni.length > 0 ? null : atlete.length === 0 ? (
            <Text style={styles.vuoto}>Nessuna atleta ancora. Usa il pulsante + qui sotto.</Text>
          ) : (
            <View style={styles.vuotoBox}>
              <Text style={styles.vuotoTitolo}>Nessuna atleta trovata</Text>
              <Text style={styles.vuoto}>Prova a cambiare la ricerca o i filtri.</Text>
              <Pressable style={styles.bottoneAzzera} onPress={azzeraFiltri} accessibilityRole="button">
                <Text style={styles.bottoneAzzeraTesto}>Azzera i filtri</Text>
              </Pressable>
            </View>
          )}

        {sezioni.map((s) => (
          <View
            key={s.lettera}
            onLayout={(e) => { posizioneSezioni.current[s.lettera] = e.nativeEvent.layout.y; }}
          >
            <View style={[styles.intestazioneSezione, Platform.OS === "web" ? ({ position: "sticky", top: ALTEZZA_TITOLO_COMPATTO + altezzaFissa, zIndex: 5 } as object) : null]}>
              <Text style={styles.intestazioneSezioneTesto} accessibilityRole="header">{vista === "ruolo" ? `${s.lettera.toUpperCase()} · ${s.data.length}` : s.lettera}</Text>
            </View>
            {s.data.map((a, i) => renderRiga(a, i, s.data.length))}
          </View>
        ))}
      </ScrollView>

      {mostraIndice && (
        <View style={styles.indice} pointerEvents="box-none" onLayout={(e) => setAltezzaContenitoreIndice(e.nativeEvent.layout.height)}>
          <View
            ref={lettereRef}
            onLayout={(e) => setPosizioneLettere(e.nativeEvent.layout.y)}
            style={[styles.indiceLettere, Platform.OS === "web" ? ({ touchAction: "none", userSelect: "none", cursor: "pointer" } as object) : null]}
            {...gestoIndice.panHandlers}
            accessibilityLabel="Indice alfabetico: scorri con il dito per scegliere la lettera"
          >
            {sezioni.map((s) => (
              <View key={s.lettera} style={[styles.indiceLettera, { height: altezzaLettera }]} pointerEvents="none">
                <Text style={[styles.indiceTesto, letteraBolla === s.lettera && styles.indiceTestoAttivo]}>{s.lettera}</Text>
              </View>
            ))}
          </View>
          {letteraBolla !== null && (
            <View
              pointerEvents="none"
              style={[
                styles.bolla,
                { top: Math.max(0, posizioneLettere + Math.max(0, sezioni.findIndex((s) => s.lettera === letteraBolla)) * altezzaLettera + altezzaLettera / 2 - 32) },
              ]}
            >
              <Text style={styles.bollaTesto}>{letteraBolla}</Text>
            </View>
          )}
        </View>
      )}

      {puoScrivere && (
        <FabMenu
          titolo="Aggiungi alla rosa"
          voci={[
            { icona: "✍️", etichetta: "Una atleta a mano", descrizione: "Scrivi nome, cognome e ruolo", onPress: () => setPopupAperto(true) },
            { icona: "📄", etichetta: "Importa la rosa da un file", descrizione: "Carichi l'elenco e le atlete entrano tutte insieme", onPress: () => router.push("/importa-atlete") },
          ]}
        />
      )}

      {reminderSporteasy && team && (
        <MessaggioWhatsApp
          visibile
          titolo="Promemoria SportEasy"
          nota="Si apre WhatsApp col messaggio pronto: scegli il gruppo della squadra e premi invia. Puoi modificare il testo qui sopra."
          modelli={[{ etichetta: "SportEasy", testo: promemoriaSporteasy(team.nome) }]}
          onChiudi={() => setReminderSporteasy(false)}
        />
      )}

      <PopupForm visibile={popupAperto} titolo="Nuova atleta" haModifiche={!!(nome.trim() || cognome.trim())} onChiudi={() => { setPopupAperto(false); setNome(""); setCognome(""); setRuoloCampo(null); }}>
        <TextInput style={styles.input} placeholder="Nome" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} autoFocus />
        <TextInput style={styles.input} placeholder="Cognome" placeholderTextColor={brand.colors.muted} value={cognome} onChangeText={setCognome} />
        <Text style={styles.etichettaCampo}>Ruolo in campo</Text>
        <View style={styles.selettoreRiga}>
          {ruoliCampo.map((r) => (
            <Pressable key={r} onPress={() => setRuoloCampo(r)} style={[styles.chip, ruoloCampo === r && styles.chipAttivo]}>
              <Text style={[styles.chipTesto, ruoloCampo === r && styles.chipTestoAttivo]}>{r}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.bottone} onPress={aggiungi} disabled={!nome.trim() || !cognome.trim()}>
          <Text style={styles.bottoneTesto}>Aggiungi atleta</Text>
        </Pressable>
      </PopupForm>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  contenuto: { padding: 16, paddingBottom: SPAZIO_BARRA, width: "100%", maxWidth: 900, alignSelf: "center" },
  contenutoConIndice: { paddingRight: 34 },
  bloccoFisso: { marginHorizontal: -16, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6, gap: 8 },
  bloccoFissoConIndice: { marginRight: -34, paddingRight: 34 },
  ricerca: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: brand.colors.surfaceTertiary, borderRadius: 12, paddingLeft: 12, minHeight: 44, marginBottom: 10 },
  ricercaIcona: { fontSize: 15, opacity: 0.7 },
  ricercaInput: { flex: 1, color: brand.colors.onSurface, fontSize: 16, minHeight: 44, paddingVertical: 8 },
  ricercaPulisci: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  ricercaPulisciTesto: { color: brand.colors.muted, fontSize: 15, fontWeight: "700" },
  filtriScroll: { flexGrow: 0, marginBottom: 6 },
  filtriRiga: { flexDirection: "row", alignItems: "center", gap: 6, paddingRight: 8 },
  etichettaFiltro: { color: brand.colors.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginRight: 2 },
  chipFiltro: { paddingHorizontal: 11, minHeight: 28, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  selettoreVista: { flexDirection: "row", backgroundColor: brand.colors.surfaceTertiary, borderRadius: 12, padding: 3, marginBottom: 10 },
  vistaOpzione: { flex: 1, minHeight: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  vistaOpzioneAttiva: { backgroundColor: brand.colors.brand },
  vistaTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14, fontWeight: "600" },
  vistaTestoAttivo: { color: "#000", fontWeight: "700" },
  intestazioneSezione: { backgroundColor: brand.colors.surface, paddingTop: 10, paddingBottom: 6, paddingHorizontal: 4 },
  intestazioneAppiccicosa: { position: "sticky", top: 0, zIndex: 5 },
  intestazioneSezioneTesto: { color: brand.colors.muted, fontSize: 13, fontWeight: "700", letterSpacing: 0.4 },
  puntoCertificato: { width: 10, height: 10, borderRadius: 5, marginRight: 2 },
  vuotoBox: { alignItems: "center", gap: 8, marginTop: 24 },
  vuotoTitolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700", textAlign: "center" },
  bottoneAzzera: { backgroundColor: brand.colors.surfaceTertiary, borderRadius: 999, minHeight: 36, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", marginTop: 4 },
  bottoneAzzeraTesto: { color: brand.colors.brand, fontSize: 15, fontWeight: "700" },
  indice: { position: "absolute", right: 0, top: 0, bottom: SPAZIO_BARRA, width: 120, justifyContent: "center", alignItems: "flex-end" },
  indiceLettere: { width: 32, alignItems: "center", paddingVertical: 2 },
  indiceLettera: { width: 32, alignItems: "center", justifyContent: "center" },
  indiceTesto: { color: brand.colors.brand, fontSize: 11, fontWeight: "700" },
  indiceTestoAttivo: { color: brand.colors.onSurface, fontSize: 13 },
  bolla: { position: "absolute", right: 44, width: 64, height: 64, borderRadius: 18, backgroundColor: brand.colors.surfaceTertiary, borderWidth: 1, borderColor: brand.colors.border, alignItems: "center", justifyContent: "center" },
  bollaTesto: { color: brand.colors.brand, fontSize: 34, fontWeight: "700" },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 44, fontSize: 16 },
  etichettaCampo: { color: brand.colors.muted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 2 },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 6, paddingHorizontal: 16, minHeight: 42, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
  scheda: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, overflow: "hidden" },
  rigaContenitore: { backgroundColor: brand.colors.surfaceSecondary },
  rigaPrima: { borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: "hidden" },
  rigaUltima: { borderBottomLeftRadius: 18, borderBottomRightRadius: 18, overflow: "hidden" },
  separatore: { height: 1, backgroundColor: brand.colors.border, marginLeft: 72 },
  riga: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 14, minHeight: 60 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  avatarSpento: { opacity: 0.7 },
  avatarTesto: { color: brand.colors.brand, fontSize: 17, fontWeight: "700" },
  rigaNome: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  rigaSotto: { color: brand.colors.muted, fontSize: 13 },
  chevron: { color: brand.colors.muted, fontSize: 24, fontWeight: "600" },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  bottoneReminder: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: brand.colors.surfaceSecondary, borderWidth: 1, borderColor: brand.colors.border, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8, minHeight: 60 },
  iconaReminder: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(50,173,230,0.16)", alignItems: "center", justifyContent: "center" },
  iconaReminderTesto: { fontSize: 18 },
  bottoneReminderTitolo: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "600" },
  bottoneReminderSotto: { color: brand.colors.muted, fontSize: 12.5 },
  rigaEspandi: { minHeight: 44, justifyContent: "center", marginBottom: 4 },
  rigaEspandiTesto: { color: brand.colors.brandSecondary, fontSize: 14, fontWeight: "600" },
  rigaArchiviata: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 14, minHeight: 60 },
  bottoneRipristina: { backgroundColor: brand.colors.surfaceTertiary, borderRadius: 999, minHeight: 36, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  bottoneRipristinaTesto: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "600" },
  selettoreRiga: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, minHeight: 36, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipFiltroTesto: { fontSize: 12.5 },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14, fontWeight: "600" },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
});
