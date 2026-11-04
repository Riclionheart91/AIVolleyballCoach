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
        <Text style={s.titoloElenco}>Azioni · dalla più recente</Text>
        <Text style={s.nota}>{p.righe.length}</Text>
      </View>
      {p.nota ? <Text style={s.nota}>{p.nota}</Text> : null}
      <FlatList
        style={{ flex: 1, minHeight: 0 }}
        data={voci}
        keyExtractor={(v) => v.chiave}
        contentContainerStyle={{ gap: 4, paddingBottom: 8 }}
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
          return (
            <View style={[s.rigaPunto, nostro && s.rigaNostra, loro && s.rigaLoro]}>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={s.rigaEtichetta}>
                  <Text style={[s.etichettaPunto, { color: nostro ? brand.colors.success : brand.colors.error }]}>{nostro ? "PUNTO NOSTRO" : "PUNTO AVVERSARIO"}</Text>
                  <Text style={s.ora}>{new Date(r.creatoIl).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</Text>
                  {r.serie >= 3 && <Text style={[s.serie, { color: nostro ? brand.colors.success : brand.colors.error }]}>serie di {r.serie}</Text>}
                </View>
                <Text style={s.fraseTitolo}>{r.frase}{r.zone}</Text>
              </View>
              <View style={[s.pillolaPunto, nostro ? s.pillolaNostra : s.pillolaLoro]}>
                <Text style={[s.pillolaPuntoTesto, loro && { color: "#fff" }]}>{r.noi}-{r.avv}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );

  const inTesta = p.setVintiNoi === p.setVintiLoro ? null : p.setVintiNoi > p.setVintiLoro ? "noi" : "loro";
  const setConclusi = p.setLista.filter((x) => !x.inCorso);

  const tabellone = (
    <View style={s.tabellone}>
      <View style={s.cardSquadre}>
        <Text style={s.etichettaSezione}>SET VINTI</Text>
        <View style={s.rigaSquadra}>
          <Text style={s.palla}>{p.serviamoNoi ? "🏐" : ""}</Text>
          <Text style={s.nomeSquadra} numberOfLines={1}>{p.nomeNoi}</Text>
          <View style={[s.setVintiBox, inTesta === "noi" && s.setVintiBoxTesta]}>
            <Text style={[s.setVinti, inTesta === "noi" && { color: "#000" }]}>{p.setVintiNoi}</Text>
          </View>
        </View>
        <View style={s.rigaSquadra}>
          <Text style={s.palla}>{p.serviamoNoi ? "" : "🏐"}</Text>
          <Text style={s.nomeSquadra} numberOfLines={1}>{p.nomeAvversario}</Text>
          <View style={[s.setVintiBox, inTesta === "loro" && s.setVintiBoxTesta]}>
            <Text style={[s.setVinti, inTesta === "loro" && { color: "#000" }]}>{p.setVintiLoro}</Text>
          </View>
        </View>
      </View>

      <View style={s.boxSetInCorso}>
        <Text style={s.etichettaSetCorso}>SET {p.numeroSetCorrente}{p.partitaInCorso ? " · IN CORSO" : ""}</Text>
        <Text style={s.punteggio}>{p.puntiNoi}-{p.puntiAvv}</Text>
        <View style={s.separatore} />
        <Text style={s.etichettaSezione}>TIME-OUT</Text>
        <Text style={s.rigaTO}>Noi <Text style={s.numeroTO}>{p.timeoutNoi}</Text></Text>
        <Text style={s.rigaTO}>Loro <Text style={s.numeroTO}>{p.timeoutLoro}</Text></Text>
      </View>
    </View>
  );

  const chipSet = setConclusi.length > 0 ? (
    <View style={s.rigaChip}>
      {setConclusi.map((x) => {
        const vinto = x.noi > x.avv;
        return (
          <View key={x.id} style={[s.chip, { borderColor: vinto ? brand.colors.success : brand.colors.error }]}>
            <Text style={s.chipEtichetta}>Set {x.numero} · <Text style={{ color: vinto ? brand.colors.success : brand.colors.error, fontWeight: "800" }}>{vinto ? "vinto" : "perso"}</Text></Text>
            <Text style={s.chipPunti}>{x.noi}-{x.avv}</Text>
          </View>
        );
      })}
    </View>
  ) : null;

  return (
    <View style={[s.contenitore, { paddingTop: "env(safe-area-inset-top)" } as object]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.barra}>
        <Pressable onPress={p.onEsci} style={s.tastoEsci} hitSlop={8} accessibilityLabel="Esci dalla partita">
          <Text style={s.tastoEsciTesto}>← Esci</Text>
        </Pressable>
        <Text style={s.titoloBarra} numberOfLines={1}>{p.nomeNoi} · {p.nomeAvversario}</Text>
        <View style={[s.stato, p.partitaInCorso ? s.statoLive : s.statoFinita]}>
          <Text style={[s.statoTesto, p.partitaInCorso && { color: "#fff" }]}>{p.partitaInCorso ? "● LIVE" : "Conclusa"}</Text>
        </View>
      </View>

      <View style={[s.corpo, { flexDirection: largo ? "row" : "column" }]}>
        {largo && (
          <View style={{ width: latoCampo, gap: 6 }}>
            <Text style={s.titoloElenco}>In campo</Text>
            <View style={{ width: latoCampo, height: latoCampo }}>{p.campo}</View>
          </View>
        )}
        <View style={{ flex: 1, minHeight: 0, gap: 8 }}>
          {tabellone}
          {p.attesaFormazione && <AttesaFormazione numeroSet={p.attesaFormazione.numeroSet} daQuando={p.attesaFormazione.daQuando} />}
          {chipSet}
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
  barra: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  tastoEsci: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: brand.colors.brand },
  tastoEsciTesto: { color: brand.colors.brand, fontWeight: "700", fontSize: 14 },
  titoloBarra: { flex: 1, color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  stato: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999 },
  statoLive: { backgroundColor: brand.colors.error },
  statoFinita: { backgroundColor: brand.colors.surfaceSecondary },
  statoTesto: { color: brand.colors.muted, fontSize: 12, fontWeight: "800" },
  corpo: { flex: 1, minHeight: 0, padding: 10, gap: 12 },
  tabellone: { flexDirection: "row", alignItems: "stretch", gap: 10 },
  cardSquadre: { flex: 1, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 12, gap: 10, justifyContent: "center" },
  etichettaSezione: { color: brand.colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  rigaSquadra: { flexDirection: "row", alignItems: "center", gap: 8 },
  palla: { width: 20, fontSize: 14 },
  nomeSquadra: { flex: 1, color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  setVintiBox: { minWidth: 44, height: 44, borderRadius: 10, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  setVintiBoxTesta: { backgroundColor: brand.colors.success },
  setVinti: { color: brand.colors.onSurface, fontSize: 26, fontWeight: "800" },
  boxSetInCorso: { minWidth: 130, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, borderWidth: 2, borderColor: brand.colors.brand, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center", gap: 2 },
  etichettaSetCorso: { color: brand.colors.brand, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  punteggio: { color: brand.colors.onSurface, fontSize: 44, fontWeight: "800", lineHeight: 52 },
  separatore: { alignSelf: "stretch", height: 1, backgroundColor: brand.colors.border, marginVertical: 6 },
  rigaTO: { color: brand.colors.onSurfaceSecondary, fontSize: 14 },
  numeroTO: { color: brand.colors.onSurface, fontWeight: "800" },
  rigaChip: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 14, alignItems: "center", borderWidth: 1.5 },
  chipEtichetta: { color: brand.colors.muted, fontSize: 11 },
  chipPunti: { color: brand.colors.onSurface, fontSize: 18, fontWeight: "800" },
  cardElenco: { flex: 1, minHeight: 0, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 10, gap: 6 },
  titoloElencoRiga: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titoloElenco: { color: brand.colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  nota: { color: brand.colors.muted, fontSize: 12 },
  vuoto: { color: brand.colors.muted, fontSize: 14, paddingVertical: 20, textAlign: "center" },
  testataSet: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 12, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  testataSetTesto: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "800" },
  testataSetPunti: { color: brand.colors.muted, fontSize: 13, fontWeight: "600" },
  rigaPunto: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, borderLeftWidth: 4 },
  rigaNostra: { backgroundColor: "rgba(52,199,89,0.12)", borderLeftColor: brand.colors.success },
  rigaLoro: { backgroundColor: "rgba(255,59,48,0.12)", borderLeftColor: brand.colors.error },
  rigaEtichetta: { flexDirection: "row", alignItems: "center", gap: 8 },
  etichettaPunto: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  serie: { fontSize: 11, fontWeight: "700" },
  fraseTitolo: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  rigaNeutra: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3, paddingHorizontal: 12 },
  ora: { color: brand.colors.muted, fontSize: 11 },
  testoNeutro: { flex: 1, color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  pillolaPunto: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12 },
  pillolaNostra: { backgroundColor: brand.colors.success },
  pillolaLoro: { backgroundColor: brand.colors.error },
  pillolaPuntoTesto: { color: "#000", fontSize: 15, fontWeight: "800" },
  attesa: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, borderWidth: 2, paddingVertical: 10, paddingHorizontal: 14 },
  attesaTitolo: { fontSize: 15, fontWeight: "800" },
  attesaTempo: { fontSize: 34, fontWeight: "800", fontVariant: ["tabular-nums"] },
  barraAttesa: { height: 6, borderRadius: 3, backgroundColor: brand.colors.surfaceTertiary, overflow: "hidden", marginTop: 6 },
  barraAttesaPiena: { height: 6, borderRadius: 3 },
  piede: { flexDirection: "row", gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: brand.colors.border },
  tastoPiede: { flex: 1, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  tastoPiedeTesto: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 14 },
});
