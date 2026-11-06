import { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { chiudiEApriNuovaStagioneSocieta, elencaStagioniSocieta, generaBaselineStagione } from "@/src/services/seasons";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { TitoloGrande } from "@/src/components/TitoloGrande";
import { brand } from "@/src/config";
import type { Season } from "@/src/types/database";
import { SPAZIO_BARRA } from "@/src/lib/spazioBarra";
import { TitoloCompatto, useScorrimentoIOS } from "@/src/lib/scorrimentoIOS";

/**
 * La stagione è ora di società, condivisa da tutte le squadre: questa
 * tab mostra lo storico (attuale + concluse) della società della
 * squadra corrente. Non esiste più un passaggio "crea stagione, poi
 * attivala": aprire la prima stagione o passare alla successiva la
 * rende attiva da subito (vedi apri-stagione.tsx e i servizi in
 * seasons.ts) — qui resta solo l'azione di chiusura+riapertura e la
 * generazione della baseline per la propria squadra.
 */
export default function Stagioni() {
  const { team, puoScrivere, puoGestireStagioni, stagioneAttiva, ricaricaContesto } = useAuth();
  const [stagioni, setStagioni] = useState<Season[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [inCorso, setInCorso] = useState(false);

  const carica = useCallback(async () => {
    if (!team?.societaId) return;
    setCaricamento(true);
    try {
      setStagioni(await elencaStagioniSocieta(team.societaId));
    } finally {
      setCaricamento(false);
    }
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function generaBaseline(seasonId: string) {
    if (!team) return;
    try {
      const n = await generaBaselineStagione(team.id, seasonId);
      if (n === 0) {
        avvisa(
          "Nessuna valutazione da usare come punto di partenza",
          "\"Genera baseline\" prende l'ultima valutazione già registrata per ogni atleta/fondamentale (fino alla data di apertura di questa stagione) e la fissa come punto di riferimento iniziale della stagione, per poter poi misurare i progressi nel tempo. Non ha trovato nessuna valutazione precedente da usare: è normale se è la prima stagione della squadra o se non hai ancora registrato valutazioni. Puoi rilanciarla più avanti, appena avrai le prime valutazioni.",
        );
      } else {
        avvisa("Baseline generata", `${n} valori di riferimento creati (uno per atleta/fondamentale), presi dall'ultima valutazione disponibile prima dell'apertura della stagione.`);
      }
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    }
  }

  function confermaChiusura() {
    if (!team?.societaId) return;
    confermaAzione(
      "Chiudere la stagione e aprirne subito una nuova?",
      "La stagione corrente verrà segnata come conclusa (resta consultabile in sola lettura da tutta la società) e se ne aprirà subito un'altra. Nessuna squadra sarà attiva nella nuova stagione finché non la riattivi tu da Gestione società — comprese quelle che stai usando oggi.",
      "Chiudi e apri la nuova",
      async () => {
        setInCorso(true);
        try {
          await chiudiEApriNuovaStagioneSocieta(team.societaId!);
          await ricaricaContesto();
          carica();
        } catch (e) {
          avvisa("Errore", (e as Error).message);
        } finally {
          setInCorso(false);
        }
      },
      true,
    );
  }

  const attive = stagioni.filter((s) => s.stato === "attiva");
  const altre = stagioni.filter((s) => s.stato !== "attiva");

  function renderAzioni(item: Season) {
    if (item.stato !== "attiva" || !(puoScrivere || puoGestireStagioni)) return null;
    return (
      <View style={styles.azioni}>
        {puoScrivere && (
          <Pressable style={styles.pillSecondaria} onPress={() => generaBaseline(item.id)}>
            <Text style={styles.pillSecondariaTesto}>Genera baseline</Text>
          </Pressable>
        )}
        {puoGestireStagioni && (
          <Pressable style={styles.pillDistruttiva} onPress={confermaChiusura} disabled={inCorso}>
            <Text style={styles.pillDistruttivaTesto}>{inCorso ? "Un attimo…" : "Termina e apri la nuova"}</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const { scrollY, propsLista, indicatore } = useScorrimentoIOS(carica);

  return (
    <View style={styles.container}>
      <TitoloCompatto titolo="Stagioni" scrollY={scrollY} />
      {indicatore}
      <FlatList
        data={altre}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.contenuto}
        {...propsLista}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: altre.length > 0 ? 12 : 0 }}>
            <TitoloGrande titolo="Stagioni" />
            {attive.length > 0 && <Text style={styles.titoloSezione}>In corso</Text>}
            {attive.map((item) => (
              <View key={item.id} style={styles.schedaEvidenza}>
                <View style={styles.rigaTitolo}>
                  <Text style={styles.evidenzaTitolo}>{item.nome}</Text>
                  <Text style={[styles.badge, styles.badgeAttiva]}>{item.stato}</Text>
                </View>
                <Text style={styles.cardSotto}>Apertura: {item.data_apertura}</Text>
                {renderAzioni(item)}
              </View>
            ))}
            {altre.length > 0 && <Text style={styles.titoloSezione}>Storico</Text>}
          </View>
        }
        ListEmptyComponent={!caricamento && stagioni.length === 0 ? <Text style={styles.vuoto}>Nessuna stagione ancora.</Text> : null}
        renderItem={({ item, index }) => (
          <View style={[styles.rigaWrap, index === 0 && styles.rigaPrima, index === altre.length - 1 && styles.rigaUltima]}>
            {index > 0 && <View style={styles.separatore} />}
            <View style={styles.riga}>
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={styles.cardTitolo}>{item.nome}</Text>
                <Text style={styles.cardSotto}>Apertura: {item.data_apertura}</Text>
              </View>
              <Text style={styles.badge}>{item.stato}</Text>
            </View>
          </View>
        )}
      />
      {!stagioneAttiva && !caricamento && (
        <Text style={styles.vuoto}>La tua squadra non è attiva nella stagione corrente della società.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  contenuto: { padding: 16, paddingBottom: SPAZIO_BARRA, width: "100%", maxWidth: 900, alignSelf: "center" },
  titoloSezione: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  schedaEvidenza: { backgroundColor: brand.colors.surfaceSecondary, borderWidth: 1, borderColor: brand.colors.border, borderRadius: 22, padding: 18, gap: 8 },
  rigaTitolo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  evidenzaTitolo: { color: brand.colors.onSurface, fontSize: 24, fontWeight: "700", letterSpacing: -0.4, flexShrink: 1 },
  rigaWrap: { backgroundColor: brand.colors.surfaceSecondary },
  rigaPrima: { borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  rigaUltima: { borderBottomLeftRadius: 18, borderBottomRightRadius: 18 },
  riga: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 16, minHeight: 60 },
  separatore: { height: 1, backgroundColor: brand.colors.border, marginLeft: 16 },
  cardTitolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  cardSotto: { color: brand.colors.muted, fontSize: 13 },
  badge: { color: brand.colors.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 },
  badgeAttiva: { color: brand.colors.success, fontWeight: "700" },
  azioni: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  pillSecondaria: { backgroundColor: brand.colors.surfaceTertiary, paddingHorizontal: 16, borderRadius: 999, minHeight: 36, justifyContent: "center", alignItems: "center" },
  pillSecondariaTesto: { color: brand.colors.onSurface, fontWeight: "600", fontSize: 15 },
  pillDistruttiva: { backgroundColor: brand.colors.surfaceTertiary, paddingHorizontal: 16, borderRadius: 999, minHeight: 36, justifyContent: "center", alignItems: "center" },
  pillDistruttivaTesto: { color: brand.colors.error, fontWeight: "600", fontSize: 15 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
});
