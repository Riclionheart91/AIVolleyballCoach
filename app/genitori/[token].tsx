import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { brand } from "@/src/config";
import { leggiDirettaGenitori, type DirettaGenitori } from "@/src/services/liveGenitori";

const INTERVALLO_MS = 5000;
const INTERVALLO_ERRORE_MS = 3000;

/** Iniziali del nome di una squadra, per il cerchio al posto dello stemma. */
function iniziali(nome: string): string {
  const parti = nome.trim().split(/\s+/).filter(Boolean);
  if (parti.length === 0) return "?";
  return (parti.length === 1 ? parti[0].slice(0, 2) : parti[0][0] + parti[1][0]).toUpperCase();
}

function oraCorrente(): string {
  try { return new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { return ""; }
}

function Stemma({ nome, evidenza }: { nome: string; evidenza: boolean }) {
  return (
    <View style={[s.stemma, { backgroundColor: evidenza ? brand.colors.surfaceTertiary : brand.colors.border }]}>
      <Text style={[s.stemmaTesto, { color: evidenza ? brand.colors.brand : brand.colors.onSurfaceSecondary }]}>{iniziali(nome)}</Text>
    </View>
  );
}

/**
 * Diretta per i genitori: pagina PUBBLICA (nessun account), pensata per il telefono.
 * Mostra solo il punteggio: squadre, set vinti, set in corso e set conclusi. Si aggiorna da sola ogni pochi secondi.
 */
export default function DirettaGenitoriPagina() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [dati, setDati] = useState<DirettaGenitori | null>(null);
  const [rete, setRete] = useState(true);
  const [aggiornato, setAggiornato] = useState("");
  const ferma = useRef(false);
  const reteOk = useRef(true);

  const carica = useCallback(async (): Promise<boolean> => {
    if (!token) return false;
    try {
      const d = await leggiDirettaGenitori(String(token));
      if (ferma.current) return false;
      setDati(d);
      reteOk.current = true;
      setRete(true);
      setAggiornato(oraCorrente());
      // Link non valido o funzione assente: inutile insistere (e ogni tentativo con codice non valido viene contato).
      return d.stato === "in_corso" || d.stato === "non_iniziata" || d.stato === "riprova";
    } catch {
      reteOk.current = false;
      if (!ferma.current) setRete(false);
      return true;
    }
  }, [token]);

  useEffect(() => {
    ferma.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ciclo = async () => {
      const continua = await carica();
      if (ferma.current || !continua) return;
      // Dopo un errore di rete si riprova piu' in fretta.
      timer = setTimeout(ciclo, reteOk.current ? INTERVALLO_MS : INTERVALLO_ERRORE_MS);
    };
    ciclo();
    return () => { ferma.current = true; if (timer) clearTimeout(timer); };
  }, [carica]);

  return (
    <View style={s.container}>
      <ScrollView contentContainerStyle={s.contenuto}>
        <Text style={s.marchio}>AI Volleyball Coach</Text>

        {dati === null && (
          <View style={s.centro}>
            <ActivityIndicator color={brand.colors.brand} />
            <Text style={s.nota}>Carico la partita…</Text>
            {!rete && <Text style={s.avviso}>Connessione assente o instabile: riprovo…</Text>}
          </View>
        )}

        {dati?.stato === "in_corso" && <Punteggio dati={dati} />}

        {dati?.stato === "non_iniziata" && (
          <View style={s.card}>
            <Text style={s.etichetta}>PRESTO IN CAMPO</Text>
            <View style={s.rigaSquadre}>
              <View style={s.squadra}>
                <Stemma nome={dati.squadra} evidenza />
                <Text style={s.nomi} numberOfLines={3}>{dati.squadra}</Text>
              </View>
              <Text style={s.contro}>vs</Text>
              <View style={s.squadra}>
                <Stemma nome={dati.avversario} evidenza={false} />
                <Text style={s.nomi} numberOfLines={3}>{dati.avversario}</Text>
              </View>
            </View>
            <Text style={s.nota}>La partita non è ancora iniziata. Tieni aperta questa pagina: il punteggio comparirà qui da solo.</Text>
          </View>
        )}

        {dati?.stato === "non_disponibile" && (
          <View style={s.card}>
            <Text style={s.titoloMessaggio}>Questo link non è più attivo</Text>
            <Text style={s.testoMessaggio}>
              La diretta si chiude quando la partita finisce, oppure dopo 24 ore. Se la partita è ancora in corso, chiedi all'allenatore un nuovo link.
            </Text>
          </View>
        )}

        {dati?.stato === "riprova" && (
          <View style={s.card}>
            <Text style={s.titoloMessaggio}>Troppi tentativi</Text>
            <Text style={s.testoMessaggio}>Riprova tra qualche minuto.</Text>
          </View>
        )}

        {dati?.stato === "non_attiva" && (
          <View style={s.card}>
            <Text style={s.titoloMessaggio}>Diretta non ancora disponibile</Text>
            <Text style={s.testoMessaggio}>Il servizio non è ancora attivo. Riprova più tardi.</Text>
          </View>
        )}

        {dati !== null && (dati.stato === "in_corso" || dati.stato === "non_iniziata") && (
          <View style={s.piede}>
            {!rete
              ? <Text style={s.avviso}>Connessione instabile: il punteggio potrebbe non essere aggiornato. Riprovo…</Text>
              : <Text style={s.nota}>Si aggiorna da solo{aggiornato ? ` · ultimo aggiornamento ${aggiornato}` : ""}</Text>}
          </View>
        )}

        <Text style={s.privacy}>Qui si vede solo il punteggio. Nessun account, nessun dato personale.</Text>
      </ScrollView>
    </View>
  );
}

function Punteggio({ dati }: { dati: Extract<DirettaGenitori, { stato: "in_corso" }> }) {
  const corrente = dati.set_in_corso;
  const etichettaSet = corrente
    ? `Set ${corrente.numero} in corso`
    : dati.set_conclusi.length > 0 ? "Pausa tra i set" : "Si comincia";
  const descrizione = corrente
    ? `${dati.squadra} ${corrente.noi}, ${dati.avversario} ${corrente.avv}. Set vinti ${dati.set_vinti_noi} a ${dati.set_vinti_avv}.`
    : `Set vinti ${dati.squadra} ${dati.set_vinti_noi}, ${dati.avversario} ${dati.set_vinti_avv}.`;

  return (
    <View style={s.card} accessible accessibilityLiveRegion="polite" accessibilityLabel={descrizione}>
      <View style={s.rigaTesta}>
        <View style={s.live}>
          <View style={s.puntoLive} />
          <Text style={s.liveTesto}>IN DIRETTA</Text>
        </View>
        <Text style={s.nota}>{etichettaSet}</Text>
      </View>

      <View style={s.rigaSquadre}>
        <View style={s.squadra}>
          <Stemma nome={dati.squadra} evidenza />
          <Text style={s.nomi} numberOfLines={3}>{dati.squadra}</Text>
        </View>
        <View style={s.centroPunteggio}>
          {corrente ? (
            <Text style={s.punteggio} adjustsFontSizeToFit numberOfLines={1}>{corrente.noi} – {corrente.avv}</Text>
          ) : (
            <Text style={s.punteggioSpento}>– –</Text>
          )}
        </View>
        <View style={s.squadra}>
          <Stemma nome={dati.avversario} evidenza={false} />
          <Text style={s.nomi} numberOfLines={3}>{dati.avversario}</Text>
        </View>
      </View>

      <View style={s.setVinti}>
        <Text style={s.setVintiEtichetta}>SET VINTI</Text>
        <Text style={s.setVintiNumero}>{dati.set_vinti_noi} – {dati.set_vinti_avv}</Text>
      </View>

      {dati.set_conclusi.length > 0 && (
        <View style={s.conclusi}>
          <Text style={s.setVintiEtichetta}>SET CONCLUSI</Text>
          <View style={s.chipRiga}>
            {dati.set_conclusi.map((x) => (
              <View key={x.numero} style={s.chip}>
                <Text style={s.chipSet}>Set {x.numero}</Text>
                <Text style={s.chipPunti}>{x.noi}–{x.avv}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  contenuto: { padding: 16, gap: 16, paddingBottom: 48, width: "100%", maxWidth: 520, alignSelf: "center", flexGrow: 1 },
  marchio: { color: brand.colors.muted, fontSize: 13, fontWeight: "700", letterSpacing: 0.4, textAlign: "center", marginTop: 8 },
  centro: { alignItems: "center", gap: 10, paddingVertical: 40 },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 22, padding: 18, gap: 18, borderWidth: 1, borderColor: brand.colors.border },
  rigaTesta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  live: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: brand.colors.error, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, minHeight: 28 },
  puntoLive: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  liveTesto: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  etichetta: { color: brand.colors.brand, fontSize: 12, fontWeight: "800", letterSpacing: 0.8 },
  rigaSquadre: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  squadra: { flex: 1, alignItems: "center", gap: 8 },
  stemma: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  stemmaTesto: { fontSize: 18, fontWeight: "800" },
  nomi: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700", textAlign: "center" },
  contro: { color: brand.colors.muted, fontSize: 15, fontWeight: "600" },
  centroPunteggio: { minWidth: 120, alignItems: "center" },
  punteggio: { color: brand.colors.onSurface, fontSize: 48, fontWeight: "800", letterSpacing: -1, lineHeight: 54 },
  punteggioSpento: { color: brand.colors.muted, fontSize: 40, fontWeight: "800", lineHeight: 48 },
  setVinti: { alignItems: "center", gap: 4, backgroundColor: brand.colors.surfaceTertiary, borderRadius: 18, paddingVertical: 12 },
  setVintiEtichetta: { color: brand.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  setVintiNumero: { color: brand.colors.onSurface, fontSize: 30, fontWeight: "800" },
  conclusi: { gap: 8 },
  chipRiga: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: brand.colors.surfaceTertiary, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, minHeight: 36 },
  chipSet: { color: brand.colors.muted, fontSize: 13, fontWeight: "600" },
  chipPunti: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "800" },
  titoloMessaggio: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700", textAlign: "center" },
  testoMessaggio: { color: brand.colors.onSurfaceSecondary, fontSize: 15, lineHeight: 22, textAlign: "center" },
  nota: { color: brand.colors.muted, fontSize: 13, lineHeight: 19, textAlign: "center" },
  avviso: { color: brand.colors.warning, fontSize: 13, lineHeight: 19, textAlign: "center" },
  piede: { alignItems: "center" },
  privacy: { color: brand.colors.muted, fontSize: 12, textAlign: "center", marginTop: 4 },
});
