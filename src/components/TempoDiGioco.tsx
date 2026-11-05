import { useCallback, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  MIN_PARTITE_PER_SEGNALAZIONE,
  NOTA_METODO,
  calcolaTempoDiGioco,
  formattaPercentuale,
  leggiDatiTempoDiGioco,
  nomeCompleto,
  type DatiTempoDiGioco,
  type FiltroTipoGara,
  type TempoAtleta,
} from "@/src/services/tempoDiGioco";
import { brand } from "@/src/config";

/* -------------------------------------------------------------------------- */
/* Lettura condivisa                                                           */
/* -------------------------------------------------------------------------- */

function useDatiTempoDiGioco(teamId: string | undefined) {
  const [dati, setDati] = useState<DatiTempoDiGioco | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState(false);

  const carica = useCallback(async () => {
    if (!teamId) { setCaricamento(false); return; }
    setCaricamento(true);
    setErrore(false);
    try {
      setDati(await leggiDatiTempoDiGioco(teamId));
    } catch {
      // Dati non leggibili (permessi, rete, database non aggiornato): messaggio gentile, nessun crash.
      setDati(null);
      setErrore(true);
    } finally {
      setCaricamento(false);
    }
  }, [teamId]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));
  return { dati, caricamento, errore, ricarica: carica };
}

function dataBreve(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function testoSetPunti(a: TempoAtleta): string {
  const set = `${a.setGiocati}/${a.setDisponibili} set`;
  if (a.puntiSquadra === 0) return set;
  return `${set} · ${a.puntiInCampo}/${a.puntiSquadra} punti${a.conStime ? " (stima)" : ""}`;
}

/* -------------------------------------------------------------------------- */
/* Barra percentuale                                                           */
/* -------------------------------------------------------------------------- */

function Barra({ valore, media, colore }: { valore: number | null; media: number | null; colore: string }) {
  const larghezza = valore === null ? 0 : Math.max(0, Math.min(1, valore)) * 100;
  return (
    <View style={styles.pista} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(larghezza) }}>
      <View style={[styles.riempimento, { width: `${larghezza}%`, backgroundColor: colore }]} />
      {media !== null && <View style={[styles.segnoMedia, { left: `${Math.max(0, Math.min(1, media)) * 100}%` }]} />}
    </View>
  );
}

function BloccoMetodo() {
  const [aperto, setAperto] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={() => setAperto(!aperto)} style={styles.bersaglio} accessibilityRole="button">
        <Text style={styles.link}>{aperto ? "Nascondi come si calcola" : "Come si calcola"}</Text>
      </Pressable>
      {aperto && <Text style={styles.nota}>{NOTA_METODO}</Text>}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Vista di squadra                                                            */
/* -------------------------------------------------------------------------- */

const FILTRI: { valore: FiltroTipoGara; etichetta: string }[] = [
  { valore: "tutte", etichetta: "Tutte" },
  { valore: "campionato", etichetta: "Campionato" },
  { valore: "amichevole", etichetta: "Amichevoli" },
];

type Ordine = "meno" | "piu";

/**
 * Elenco delle atlete della squadra con la quota di punti giocati in campo
 * nella stagione, i set giocati e un'evidenza per chi e' sotto la meta'
 * della media: serve a vedere a colpo d'occhio chi gioca poco.
 */
export function TempoDiGiocoSquadra({ teamId }: { teamId: string }) {
  const { dati, caricamento, errore, ricarica } = useDatiTempoDiGioco(teamId);
  const [filtro, setFiltro] = useState<FiltroTipoGara>("tutte");
  const [ordine, setOrdine] = useState<Ordine>("meno");

  const risultato = useMemo(() => (dati ? calcolaTempoDiGioco(dati, filtro) : null), [dati, filtro]);

  const elenco = useMemo(() => {
    if (!risultato) return [];
    const copia = [...risultato.atlete];
    copia.sort((a, b) => {
      // Chi non ha un dato calcolabile va sempre in fondo.
      if (a.percentuale === null && b.percentuale === null) return a.cognome.localeCompare(b.cognome);
      if (a.percentuale === null) return 1;
      if (b.percentuale === null) return -1;
      const d = ordine === "meno" ? a.percentuale - b.percentuale : b.percentuale - a.percentuale;
      return d !== 0 ? d : a.cognome.localeCompare(b.cognome);
    });
    return copia;
  }, [risultato, ordine]);

  if (caricamento && !dati) return <ActivityIndicator color={brand.colors.brand} style={{ marginTop: 24 }} />;

  if (errore) {
    return (
      <View style={styles.scheda}>
        <Text style={styles.titoloScheda}>Tempo di gioco non disponibile</Text>
        <Text style={styles.nota}>Non è stato possibile leggere le partite in questo momento. Riprova tra poco.</Text>
        <Pressable onPress={ricarica} style={styles.pill} accessibilityRole="button"><Text style={styles.pillTesto}>Riprova</Text></Pressable>
      </View>
    );
  }

  const nSegnalate = elenco.filter((a) => a.sottoSoglia).length;

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.rigaChip}>
        {FILTRI.map((f) => (
          <Pressable key={f.valore} onPress={() => setFiltro(f.valore)} style={[styles.chip, filtro === f.valore && styles.chipAttivo]} accessibilityRole="button" accessibilityState={{ selected: filtro === f.valore }}>
            <Text style={[styles.chipTesto, filtro === f.valore && styles.chipTestoAttivo]}>{f.etichetta}</Text>
          </Pressable>
        ))}
      </View>

      {!risultato || risultato.atlete.length === 0 ? (
        <View style={styles.scheda}>
          <Text style={styles.titoloScheda}>Ancora nessun dato</Text>
          <Text style={styles.nota}>
            Il tempo di gioco si calcola dalle partite scoutate con la formazione registrata. Appena ce ne sarà una, qui compariranno i punti e i set giocati di ogni atleta.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.scheda}>
            <Text style={styles.etichetta}>STAGIONE</Text>
            <Text style={styles.valoreGrande}>{risultato.partiteConsiderate} {risultato.partiteConsiderate === 1 ? "partita" : "partite"}</Text>
            <Text style={styles.nota}>
              {risultato.setConsiderati} set considerati
              {risultato.mediaPercentuale !== null ? ` · media ${formattaPercentuale(risultato.mediaPercentuale)} dei punti per atleta (Libero esclusa)` : ""}
            </Text>
            {risultato.soglia !== null && (
              <Text style={styles.nota}>
                Sono segnalate le atlete sotto {formattaPercentuale(risultato.soglia)} (meno della metà della media), con almeno {MIN_PARTITE_PER_SEGNALAZIONE} partite disponibili.
                {nSegnalate > 0 ? ` Ora: ${nSegnalate}.` : " Ora nessuna."}
              </Text>
            )}
            {risultato.setSenzaFormazione > 0 && (
              <Text style={styles.nota}>{risultato.setSenzaFormazione} set senza formazione registrata non sono contati.</Text>
            )}
            {!risultato.infoCambiDisponibili && (
              <Text style={[styles.nota, { color: brand.colors.warning }]}>Le informazioni sui cambi non sono ancora disponibili: i punti sono calcolati solo per chi ha giocato l&apos;intero set.</Text>
            )}
          </View>

          <View style={styles.rigaChip}>
            <Pressable onPress={() => setOrdine("meno")} style={[styles.chip, ordine === "meno" && styles.chipAttivo]} accessibilityRole="button" accessibilityState={{ selected: ordine === "meno" }}>
              <Text style={[styles.chipTesto, ordine === "meno" && styles.chipTestoAttivo]}>Meno impiegate prima</Text>
            </Pressable>
            <Pressable onPress={() => setOrdine("piu")} style={[styles.chip, ordine === "piu" && styles.chipAttivo]} accessibilityRole="button" accessibilityState={{ selected: ordine === "piu" }}>
              <Text style={[styles.chipTesto, ordine === "piu" && styles.chipTestoAttivo]}>Più impiegate prima</Text>
            </Pressable>
          </View>

          <View style={styles.lista}>
            {elenco.map((a, i) => (
              <View key={a.athleteId}>
                <Pressable
                  onPress={() => router.push(`/atleta/${a.athleteId}`)}
                  style={styles.riga}
                  accessibilityRole="button"
                  accessibilityLabel={`${nomeCompleto(a)}, ${formattaPercentuale(a.percentuale)} dei punti, ${a.setGiocati} set su ${a.setDisponibili}`}
                >
                  <View style={styles.rigaTesta}>
                    <Text style={styles.nome} numberOfLines={1}>
                      {a.numeroMaglia != null ? `${a.numeroMaglia}  ` : ""}{nomeCompleto(a)}
                    </Text>
                    <Text style={[styles.percentuale, a.sottoSoglia && { color: brand.colors.warning }]}>{formattaPercentuale(a.percentuale)}</Text>
                  </View>
                  <Barra valore={a.percentuale} media={risultato.mediaPercentuale} colore={a.sottoSoglia ? brand.colors.warning : brand.colors.brand} />
                  <View style={styles.rigaTesta}>
                    <Text style={styles.dettaglio} numberOfLines={2}>
                      {testoSetPunti(a)}{a.setSenzaPunti > 0 ? ` · ${a.setSenzaPunti} set senza dati sui punti` : ""}
                    </Text>
                    {a.sottoSoglia && <Text style={styles.badgeSoglia}>Sotto soglia</Text>}
                    {a.libero && <Text style={styles.badgeNeutro}>Libero</Text>}
                  </View>
                </Pressable>
                {i < elenco.length - 1 && <View style={styles.separatore} />}
              </View>
            ))}
          </View>

          <Text style={styles.nota}>Il segno chiaro sulla barra indica la media della squadra.</Text>
          <BloccoMetodo />
        </>
      )}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Vista per singola atleta                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Scheda "Tempo di gioco" di una singola atleta. `mostraConfronto` va a true
 * solo per chi vede tutta la squadra (staff): un'atleta vede i propri dati ma
 * non quelli delle compagne, quindi niente media di squadra.
 */
export function TempoDiGiocoAtleta({ teamId, athleteId, mostraConfronto = false }: { teamId: string; athleteId: string; mostraConfronto?: boolean }) {
  const { dati, caricamento, errore } = useDatiTempoDiGioco(teamId);
  const [partiteAperte, setPartiteAperte] = useState(false);

  const risultato = useMemo(() => (dati ? calcolaTempoDiGioco(dati, "tutte") : null), [dati]);
  const atleta = risultato?.atlete.find((a) => a.athleteId === athleteId) ?? null;

  if (caricamento && !dati) return <ActivityIndicator color={brand.colors.brand} style={{ marginTop: 12 }} />;
  // Errore di lettura: la sezione semplicemente non compare, la scheda resta utilizzabile.
  if (errore || !risultato) return null;

  const media = mostraConfronto ? risultato.mediaPercentuale : null;
  const soglia = mostraConfronto ? risultato.soglia : null;
  const sotto = !!atleta && mostraConfronto && atleta.sottoSoglia;

  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.titoloSezione}>Tempo di gioco</Text>

      {!atleta ? (
        <View style={styles.scheda}>
          <Text style={styles.nota}>Nessuna partita scoutata con questa atleta in distinta: il tempo di gioco comparirà dopo la prima partita.</Text>
        </View>
      ) : (
        <View style={styles.scheda}>
          <View style={styles.rigaTesta}>
            <View style={{ flex: 1 }}>
              <Text style={styles.etichetta}>PUNTI GIOCATI IN CAMPO</Text>
              <Text style={[styles.valoreGrande, sotto && { color: brand.colors.warning }]}>{formattaPercentuale(atleta.percentuale)}</Text>
            </View>
            {sotto && <Text style={styles.badgeSoglia}>Sotto soglia</Text>}
          </View>
          <Barra valore={atleta.percentuale} media={media} colore={sotto ? brand.colors.warning : brand.colors.brand} />
          <Text style={styles.nota}>
            {atleta.puntiSquadra > 0
              ? `${atleta.puntiInCampo} punti su ${atleta.puntiSquadra} della squadra${atleta.conStime ? " (in parte stimati)" : ""}`
              : "Punti non ricostruibili dai dati registrati"}
            {media !== null ? ` · media squadra ${formattaPercentuale(media)}` : ""}
          </Text>
          {sotto && soglia !== null && (
            <Text style={[styles.nota, { color: brand.colors.warning }]}>È sotto la metà della media di squadra ({formattaPercentuale(soglia)}).</Text>
          )}

          <View style={styles.griglia}>
            <Riquadro etichetta="SET GIOCATI" valore={`${atleta.setGiocati}/${atleta.setDisponibili}`} nota={atleta.setSenzaPunti > 0 ? `${atleta.setSenzaPunti} senza dati sui punti` : undefined} />
            <Riquadro etichetta="PARTITE" valore={`${atleta.partiteGiocate}/${atleta.partiteDisponibili}`} nota="giocate / disponibili" />
            <Riquadro
              etichetta="MINUTI"
              valore={atleta.minutiStimati !== null ? `≈ ${atleta.minutiStimati}` : "n.d."}
              nota={atleta.minutiStimati !== null ? `stima, ${atleta.setConMinuti} set con orari` : "orari non attendibili"}
            />
          </View>

          {atleta.partite.length > 0 && (
            <>
              <Pressable onPress={() => setPartiteAperte(!partiteAperte)} style={styles.bersaglio} accessibilityRole="button">
                <Text style={styles.link}>{partiteAperte ? "Nascondi le partite" : `Mostra le partite (${atleta.partite.length})`}</Text>
              </Pressable>
              {partiteAperte && (
                <View style={{ gap: 0 }}>
                  {atleta.partite.slice(0, 15).map((p, i, tutte) => (
                    <View key={p.matchId}>
                      <View style={styles.rigaPartita}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.nomePartita} numberOfLines={1}>{dataBreve(p.data)} · {p.avversario}</Text>
                          <Text style={styles.dettaglio}>
                            {p.convocataSenzaGiocare ? "Convocata, non è scesa in campo" : `${p.setGiocati}/${p.setTotali} set`}
                            {!p.convocataSenzaGiocare && p.puntiInCampo !== null && p.puntiTotali > 0 ? ` · ${p.puntiInCampo}/${p.puntiTotali} punti` : ""}
                          </Text>
                        </View>
                        <Text style={styles.percentualePiccola}>
                          {p.puntiTotali > 0 && p.puntiInCampo !== null ? formattaPercentuale(p.puntiInCampo / p.puntiTotali) : "n.d."}
                        </Text>
                      </View>
                      {i < tutte.length - 1 && <View style={styles.separatore} />}
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
          <BloccoMetodo />
        </View>
      )}
    </View>
  );
}

function Riquadro({ etichetta, valore, nota }: { etichetta: string; valore: string; nota?: string }) {
  return (
    <View style={styles.riquadro}>
      <Text style={styles.etichetta}>{etichetta}</Text>
      <Text style={styles.valoreMedio}>{valore}</Text>
      {nota ? <Text style={styles.notaPiccola}>{nota}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scheda: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 16, gap: 8 },
  titoloScheda: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  titoloSezione: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700", letterSpacing: -0.3, marginTop: 12 },
  etichetta: { color: brand.colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  valoreGrande: { color: brand.colors.onSurface, fontSize: 34, fontWeight: "800", letterSpacing: -0.5 },
  valoreMedio: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  nota: { color: brand.colors.muted, fontSize: 13, lineHeight: 18 },
  notaPiccola: { color: brand.colors.muted, fontSize: 11, lineHeight: 15 },
  link: { color: brand.colors.brand, fontSize: 15, fontWeight: "600" },
  bersaglio: { minHeight: 44, justifyContent: "center" },
  pill: { minHeight: 36, borderRadius: 999, backgroundColor: brand.colors.brand, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, alignSelf: "flex-start" },
  pillTesto: { color: "#000", fontSize: 16, fontWeight: "700" },
  rigaChip: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 16, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  lista: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, overflow: "hidden" },
  riga: { paddingVertical: 12, paddingHorizontal: 16, gap: 8, minHeight: 44 },
  rigaTesta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  nome: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600", flex: 1 },
  percentuale: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "800" },
  percentualePiccola: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  dettaglio: { color: brand.colors.muted, fontSize: 12, flex: 1 },
  badgeSoglia: { color: "#000", backgroundColor: brand.colors.warning, fontSize: 11, fontWeight: "700", paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, overflow: "hidden" },
  badgeNeutro: { color: brand.colors.onSurfaceSecondary, backgroundColor: brand.colors.surfaceTertiary, fontSize: 11, fontWeight: "700", paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, overflow: "hidden" },
  separatore: { height: 1, backgroundColor: brand.colors.border, marginLeft: 16 },
  pista: { height: 10, borderRadius: 5, backgroundColor: brand.colors.surfaceTertiary, overflow: "hidden", position: "relative" },
  riempimento: { height: 10, borderRadius: 5 },
  segnoMedia: { position: "absolute", top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: brand.colors.onSurface, opacity: 0.7 },
  griglia: { flexDirection: "row", gap: 10, marginTop: 4 },
  riquadro: { flex: 1, backgroundColor: brand.colors.surfaceTertiary, borderRadius: 14, padding: 12, gap: 2 },
  rigaPartita: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, minHeight: 44 },
  nomePartita: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "600" },
});
