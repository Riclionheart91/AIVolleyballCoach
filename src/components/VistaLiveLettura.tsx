import { type ReactNode, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, FlatList, useWindowDimensions } from "react-native";
import { Stack } from "expo-router";
import { brand } from "@/src/config";
import type { RigaCronaca } from "@/src/lib/cronacaLive";

export interface SetLive {
  id: string;
  numero: number;
  noi: number;
  avv: number;
  concluso: boolean;
  inCorso: boolean;
}

interface Props {
  nomeNoi: string;
  nomeAvversario: string;
  partitaInCorso: boolean;
  setLista: SetLive[];
  setVintiNoi: number;
  setVintiLoro: number;
  numeroSetCorrente: number;
  puntiNoi: number;
  puntiAvv: number;
  timeoutNoi: number;
  timeoutLoro: number;
  serviamoNoi: boolean;
  /** Il campo con le giocatrici in campo (mostrato solo a schermo largo). */
  campo: ReactNode;
  righe: RigaCronaca[];
  nota?: string;
  /** Tra un set e l'altro: il set di cui si aspetta la formazione e da quando decorrono i 3 minuti (null = non si sa). */
  attesaFormazione: { numeroSet: number; daQuando: string | null } | null;
  mostraAnalisi: boolean;
  onAnalisi: () => void;
  onRicarica: () => void;
  onEsci: () => void;
}

type Voce =
  | { tipo: "set"; chiave: string; numero: number; testo: string }
  | { tipo: "riga"; chiave: string; riga: RigaCronaca };

const SECONDI_ATTESA_FORMAZIONE = 180;

function formattaTempo(secondi: number): string {
  const m = Math.floor(secondi / 60);
  const sec = secondi % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Avviso tra due set: si aspetta la formazione del nuovo set, con il conto alla rovescia dei 3 minuti concessi. */
function AttesaFormazione({ numeroSet, daQuando }: { numeroSet: number; daQuando: string | null }) {
  const [adesso, setAdesso] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAdesso(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const trascorsi = daQuando ? Math.max(0, Math.floor((adesso - new Date(daQuando).getTime()) / 1000)) : null;
  const restanti = trascorsi === null ? null : Math.max(0, SECONDI_ATTESA_FORMAZIONE - trascorsi);
  const scaduto = restanti === 0;
  const quasi = restanti !== null && restanti > 0 && restanti <= 30;
  const colore = scaduto || quasi ? brand.colors.error : brand.colors.warning;
  return (
    <View style={[s.attesa, { borderColor: colore }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.attesaTitolo, { color: colore }]}>⏳ In attesa della formazione del Set {numeroSet}</Text>
        <Text style={s.nota}>
          {scaduto ? "Il tempo massimo di 3 minuti è scaduto." : "Hanno al massimo 3 minuti per consegnarla."}
        </Text>
        {restanti !== null && (
          <View style={s.barraAttesa}>
            <View style={[s.barraAttesaPiena, { width: `${(restanti / SECONDI_ATTESA_FORMAZIONE) * 100}%`, backgroundColor: colore }]} />
          </View>
        )}
      </View>
      {restanti !== null && <Text style={[s.attesaTempo, { color: colore }]}>{formattaTempo(restanti)}</Text>}
    </View>
  );
}

/**
 * Cosa vedono atlete e presidente mentre la partita e' in corso: nessun comando, solo il punto della situazione —
 * punteggio e set, chi e' in campo e l'elenco delle azioni dalla piu' recente alla piu' vecchia, raggruppate per set.
 */
export function VistaLiveLettura(p: Props) {
  const { width, height } = useWindowDimensions();
  const stretto = width < 400;
  const largo = width >= 820 && width >= height * 0.9;
  const latoCampo = Math.max(220, Math.min(height - 150, width * 0.36));

  const voci: Voce[] = [];
  let setPrec: number | null = null;
  for (const r of p.righe) {
    if (r.numeroSet !== setPrec) {
      const s = p.setLista.find((x) => x.numero === r.numeroSet);
      voci.push({
        tipo: "set",
        chiave: `set-${r.numeroSet}-${r.id}`,
        numero: r.numeroSet,
        testo: s ? `${s.noi}-${s.avv}${s.inCorso ? " · in corso" : ""}` : "",
      });
      setPrec = r.numeroSet;
    }
    voci.push({ tipo: "riga", chiave: r.id, riga: r });
  }

  const elenco = (
    <View style={s.cardElenco}>
      <View style={s.titoloElencoRiga}>
        <Text style={s.titoloElenco}>Telecronaca</Text>
        <Text style={s.nota}>{p.righe.length} azioni · dalla più recente</Text>
      </View>
      {p.nota ? <Text style={s.nota}>{p.nota}</Text> : null}
      <FlatList
        style={{ flex: 1, minHeight: 0 }}
        data={voci}
        keyExtractor={(v) => v.chiave}
        contentContainerStyle={{ paddingBottom: 8 }}
        ListEmptyComponent={<Text style={s.vuoto}>Nessuna azione registrata finora.</Text>}
        renderItem={({ item }) => {
          if (item.tipo === "set") {
            return (
              <View style={s.testataSet}>
                <Text style={s.testataSetTesto}>Set {item.numero}</Text>
                {item.testo ? <Text style={s.testataSetPunti}>{item.testo}</Text> : null}
              </View>
            );
          }
          const r = item.riga;
          const nostro = r.segnato === "noi";
          const loro = r.segnato === "avversario";
          if (!r.segnato) {
            return (
              <View style={s.rigaNeutra}>
                <Text style={s.ora}>{new Date(r.creatoIl).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</Text>
                <Text style={s.testoNeutro}>{r.frase}{r.zone}</Text>
              </View>
            );
          }
          const coloreRiga = nostro ? brand.colors.success : brand.colors.error;
          return (
            <View style={s.rigaPunto}>
              <View style={[s.puntino, { backgroundColor: coloreRiga }]} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.fraseTitolo}>{r.frase}{r.zone}</Text>
                <View style={s.rigaEtichetta}>
                  <Text style={[s.etichettaPunto, { color: coloreRiga }]}>{nostro ? "PUNTO NOSTRO" : "PUNTO AVVERSARIO"}</Text>
                  <Text style={s.ora}>{new Date(r.creatoIl).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</Text>
                  {r.serie >= 3 && <Text style={[s.serie, { color: coloreRiga }]}>serie di {r.serie}</Text>}
                </View>
              </View>
              <Text style={[s.punteggioRiga, { color: coloreRiga }]}>{r.noi}–{r.avv}</Text>
            </View>
          );
        }}
      />
    </View>
  );

  const inTesta = p.setVintiNoi === p.setVintiLoro ? null : p.setVintiNoi > p.setVintiLoro ? "noi" : "loro";
  const setConclusi = p.setLista.filter((x) => !x.inCorso);
  const coloreSetVintiNoi = inTesta === "noi" ? brand.colors.success : inTesta === "loro" ? brand.colors.error : brand.colors.onSurface;

  const tabellone = (
    <View style={s.tabellone}>
      <View style={s.rigaSetVinti}>
        <View style={{ gap: 1 }}>
          <Text style={s.etichettaSezione}>SET VINTI</Text>
          <Text style={s.setVintiGrande}>
            <Text style={{ color: coloreSetVintiNoi }}>{p.setVintiNoi}</Text>
            <Text style={{ color: brand.colors.muted }}> – {p.setVintiLoro}</Text>
          </Text>
        </View>
        <View style={s.colonnaNomi}>
          <Text style={s.nomeSquadra} numberOfLines={1}>{p.serviamoNoi ? "🏐 " : ""}{p.nomeNoi}</Text>
          <Text style={s.nomeSquadraAvv} numberOfLines={1}>{p.serviamoNoi ? "" : "🏐 "}{p.nomeAvversario}</Text>
        </View>
      </View>

      <View style={s.boxSetInCorso}>
        <View style={s.boxPunteggio}>
          <Text style={s.etichettaSetCorso}>SET {p.numeroSetCorrente}{p.partitaInCorso ? " · IN CORSO" : ""}</Text>
          <Text style={[s.punteggio, { fontSize: stretto ? 44 : 60, lineHeight: stretto ? 50 : 66 }]}>{p.puntiNoi}<Text style={{ color: brand.colors.muted }}> – </Text>{p.puntiAvv}</Text>
        </View>
        <View style={s.colonnaTO}>
          <Text style={s.etichettaSezione}>TIME-OUT</Text>
          <Text style={s.rigaTO}>Noi <Text style={s.numeroTO}>{p.timeoutNoi}</Text></Text>
          <Text style={s.rigaTO}>Loro <Text style={s.numeroTO}>{p.timeoutLoro}</Text></Text>
        </View>
      </View>

      {setConclusi.length > 0 && (
        <View style={s.rigaChip}>
          {setConclusi.map((x) => {
            const vinto = x.noi > x.avv;
            const colore = vinto ? brand.colors.success : brand.colors.error;
            return (
              <View key={x.id} style={[s.chip, { backgroundColor: vinto ? "rgba(52,199,89,0.16)" : "rgba(255,59,48,0.16)" }]}>
                <Text style={[s.chipEtichetta, { color: colore }]}>Set {x.numero} · {vinto ? "vinto" : "perso"} · {x.noi}–{x.avv}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );

  return (
    <View style={[s.contenitore, { paddingTop: "env(safe-area-inset-top)" } as object]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.barra}>
        <Pressable onPress={p.onEsci} style={s.tastoEsci} hitSlop={8} accessibilityLabel="Esci dalla partita">
          <Text style={s.tastoEsciTesto}>← Esci</Text>
        </Pressable>
        <Text style={s.titoloBarra} numberOfLines={1}>{p.nomeNoi} · {p.nomeAvversario}</Text>
        <View style={[s.stato, p.partitaInCorso ? s.statoLive : s.statoFinita]}>
          {p.partitaInCorso && <View style={s.puntoLive} />}
          <Text style={[s.statoTesto, p.partitaInCorso && { color: "#fff" }]}>{p.partitaInCorso ? "IN DIRETTA" : "Conclusa"}</Text>
        </View>
      </View>

      <View style={[s.corpo, { flexDirection: largo ? "row" : "column" }]}>
        {largo && (
          <View style={{ width: latoCampo, gap: 6 }}>
            <Text style={s.titoloElenco}>In campo</Text>
            <View style={{ width: latoCampo, height: latoCampo }}>{p.campo}</View>
          </View>
        )}
        <View style={{ flex: 1, minHeight: 0, gap: 12 }}>
          {tabellone}
          {p.attesaFormazione && <AttesaFormazione numeroSet={p.attesaFormazione.numeroSet} daQuando={p.attesaFormazione.daQuando} />}
          {elenco}
        </View>
      </View>

      <View style={s.piede}>
        {p.mostraAnalisi && (
          <Pressable onPress={p.onAnalisi} style={s.tastoPiede}>
            <Text style={s.tastoPiedeTesto}>📈 Analisi e andamento</Text>
          </Pressable>
        )}
        <Pressable onPress={p.onRicarica} style={s.tastoPiede}>
          <Text style={s.tastoPiedeTesto}>🔄 Ricarica</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  contenitore: { flex: 1, backgroundColor: brand.colors.surface },
  barra: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8, width: "100%", maxWidth: 1200, alignSelf: "center" },
  tastoEsci: { minHeight: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  tastoEsciTesto: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 14 },
  titoloBarra: { flex: 1, color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  stato: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999 },
  statoLive: { backgroundColor: brand.colors.error },
  statoFinita: { backgroundColor: brand.colors.surfaceSecondary },
  statoTesto: { color: brand.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  puntoLive: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  corpo: { flex: 1, minHeight: 0, padding: 16, gap: 16, width: "100%", maxWidth: 1200, alignSelf: "center" },
  tabellone: { backgroundColor: brand.colors.surfaceSecondary, borderWidth: 1, borderColor: brand.colors.border, borderRadius: 26, padding: 18, gap: 16 },
  rigaSetVinti: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  colonnaNomi: { flex: 1, alignItems: "flex-end", gap: 2 },
  etichettaSezione: { color: brand.colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  setVintiGrande: { fontSize: 40, fontWeight: "800", letterSpacing: -1, lineHeight: 46, color: brand.colors.onSurface },
  nomeSquadra: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  nomeSquadraAvv: { color: brand.colors.onSurfaceSecondary, fontSize: 17, fontWeight: "500" },
  boxSetInCorso: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 2, borderColor: brand.colors.brand, borderRadius: 20, padding: 14, backgroundColor: "rgba(255,122,0,0.06)" },
  boxPunteggio: { flex: 1, alignItems: "center", gap: 2 },
  etichettaSetCorso: { color: brand.colors.brand, fontSize: 12, fontWeight: "700", letterSpacing: 0.8 },
  punteggio: { color: brand.colors.onSurface, fontSize: 56, fontWeight: "800", letterSpacing: -2, lineHeight: 62 },
  colonnaTO: { gap: 4, alignItems: "flex-start" },
  rigaTO: { color: brand.colors.onSurfaceSecondary, fontSize: 14 },
  numeroTO: { color: brand.colors.onSurface, fontWeight: "800" },
  rigaChip: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, alignItems: "center" },
  chipEtichetta: { fontSize: 13, fontWeight: "700" },
  cardElenco: { flex: 1, minHeight: 0, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 14, gap: 8 },
  titoloElencoRiga: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  titoloElenco: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  nota: { color: brand.colors.muted, fontSize: 12 },
  vuoto: { color: brand.colors.muted, fontSize: 14, paddingVertical: 20, textAlign: "center" },
  testataSet: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 12, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  testataSetTesto: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "800" },
  testataSetPunti: { color: brand.colors.muted, fontSize: 13, fontWeight: "600" },
  rigaPunto: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, minHeight: 44, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  puntino: { width: 10, height: 10, borderRadius: 5 },
  rigaEtichetta: { flexDirection: "row", alignItems: "center", gap: 8 },
  etichettaPunto: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  serie: { fontSize: 11, fontWeight: "700" },
  fraseTitolo: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "600" },
  punteggioRiga: { fontSize: 15, fontWeight: "700" },
  rigaNeutra: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  ora: { color: brand.colors.muted, fontSize: 11 },
  testoNeutro: { flex: 1, color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  attesa: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, borderWidth: 2, paddingVertical: 12, paddingHorizontal: 16 },
  attesaTitolo: { fontSize: 15, fontWeight: "800" },
  attesaTempo: { fontSize: 34, fontWeight: "800", fontVariant: ["tabular-nums"] },
  barraAttesa: { height: 6, borderRadius: 3, backgroundColor: brand.colors.surfaceTertiary, overflow: "hidden", marginTop: 6 },
  barraAttesaPiena: { height: 6, borderRadius: 3 },
  piede: { flexDirection: "row", gap: 8, padding: 16, width: "100%", maxWidth: 1200, alignSelf: "center" },
  tastoPiede: { flex: 1, minHeight: 44, backgroundColor: brand.colors.surfaceTertiary, borderRadius: 999, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  tastoPiedeTesto: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 14 },
});
