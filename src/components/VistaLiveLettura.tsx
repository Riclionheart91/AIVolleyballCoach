import { type ReactNode } from "react";
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
  etichettaAtleta: (athleteId: string) => string;
  nota?: string;
  mostraAnalisi: boolean;
  onAnalisi: () => void;
  onRicarica: () => void;
  onEsci: () => void;
}

type Voce =
  | { tipo: "set"; chiave: string; numero: number; testo: string }
  | { tipo: "riga"; chiave: string; riga: RigaCronaca };

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
          const punto = r.segnato !== null;
          return (
            <View style={[s.riga, r.segnato === "noi" && s.rigaNostra, r.segnato === "avversario" && s.rigaLoro]}>
              <Text style={s.ora}>{new Date(r.creatoIl).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.testoAzione, punto && s.testoAzionePunto]}>{r.testo}{r.zone}</Text>
                {r.athleteId ? <Text style={s.giocatrice}>{p.etichettaAtleta(r.athleteId)}</Text> : null}
              </View>
              {punto && (
                <View style={[s.pillolaPunto, r.segnato === "avversario" && s.pillolaPuntoLoro]}>
                  <Text style={[s.pillolaPuntoTesto, r.segnato === "avversario" && { color: brand.colors.onSurface }]}>{r.noi}-{r.avv}</Text>
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );

  const tabellone = (
    <View style={s.tabellone}>
      <View style={{ flex: 1, gap: 6 }}>
        <View style={s.rigaSquadra}>
          <Text style={s.palla}>{p.serviamoNoi ? "🏐" : ""}</Text>
          <Text style={s.nomeSquadra} numberOfLines={1}>{p.nomeNoi}</Text>
          <Text style={s.setVinti}>{p.setVintiNoi}</Text>
        </View>
        <View style={s.rigaSquadra}>
          <Text style={s.palla}>{p.serviamoNoi ? "" : "🏐"}</Text>
          <Text style={s.nomeSquadra} numberOfLines={1}>{p.nomeAvversario}</Text>
          <Text style={s.setVinti}>{p.setVintiLoro}</Text>
        </View>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={s.etichettaSet}>Set {p.numeroSetCorrente} · TO {p.timeoutNoi}-{p.timeoutLoro}</Text>
        <Text style={s.punteggio}>{p.puntiNoi}-{p.puntiAvv}</Text>
      </View>
    </View>
  );

  const chipSet = (
    <View style={s.rigaChip}>
      {p.setLista.map((x) => (
        <View key={x.id} style={[s.chip, x.inCorso && s.chipAttivo]}>
          <Text style={s.chipEtichetta}>Set {x.numero}{x.inCorso ? " · in corso" : ""}</Text>
          <Text style={s.chipPunti}>{x.noi}-{x.avv}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={s.contenitore}>
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
  tabellone: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14 },
  rigaSquadra: { flexDirection: "row", alignItems: "center", gap: 6 },
  palla: { width: 20, fontSize: 14 },
  nomeSquadra: { flex: 1, color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  setVinti: { color: brand.colors.muted, fontSize: 16, fontWeight: "800", minWidth: 20, textAlign: "right" },
  etichettaSet: { color: brand.colors.muted, fontSize: 12 },
  punteggio: { color: brand.colors.brand, fontSize: 40, fontWeight: "800", lineHeight: 46 },
  rigaChip: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 14, alignItems: "center", borderWidth: 1, borderColor: "transparent" },
  chipAttivo: { borderColor: brand.colors.brand },
  chipEtichetta: { color: brand.colors.muted, fontSize: 11 },
  chipPunti: { color: brand.colors.onSurface, fontSize: 18, fontWeight: "800" },
  cardElenco: { flex: 1, minHeight: 0, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 10, gap: 6 },
  titoloElencoRiga: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titoloElenco: { color: brand.colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  nota: { color: brand.colors.muted, fontSize: 12 },
  vuoto: { color: brand.colors.muted, fontSize: 14, paddingVertical: 20, textAlign: "center" },
  testataSet: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 10, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  testataSetTesto: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "800" },
  testataSetPunti: { color: brand.colors.muted, fontSize: 13, fontWeight: "600" },
  riga: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, borderLeftWidth: 3, borderLeftColor: "transparent" },
  rigaNostra: { backgroundColor: "rgba(255,255,255,0.05)", borderLeftColor: brand.colors.brand },
  rigaLoro: { backgroundColor: "rgba(255,255,255,0.03)", borderLeftColor: brand.colors.error },
  ora: { color: brand.colors.muted, fontSize: 12, width: 40 },
  testoAzione: { color: brand.colors.onSurfaceSecondary, fontSize: 14 },
  testoAzionePunto: { color: brand.colors.onSurface, fontWeight: "700" },
  giocatrice: { color: brand.colors.muted, fontSize: 12, marginTop: 1 },
  pillolaPunto: { backgroundColor: brand.colors.brand, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  pillolaPuntoLoro: { backgroundColor: brand.colors.surfaceTertiary },
  pillolaPuntoTesto: { color: "#000", fontSize: 13, fontWeight: "800" },
  piede: { flexDirection: "row", gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: brand.colors.border },
  tastoPiede: { flex: 1, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  tastoPiedeTesto: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 14 },
});
