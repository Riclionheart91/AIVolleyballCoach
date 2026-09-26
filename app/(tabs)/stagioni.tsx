import { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { chiudiEApriNuovaStagioneSocieta, elencaStagioniSocieta, generaBaselineStagione } from "@/src/services/seasons";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import type { Season } from "@/src/types/database";

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

  return (
    <View style={styles.container}>
      <FlatList
        data={stagioni}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
        refreshControl={<RefreshControl refreshing={caricamento} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListEmptyComponent={!caricamento ? <Text style={styles.vuoto}>Nessuna stagione ancora.</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={styles.cardTitolo}>{item.nome}</Text>
              <Text style={[styles.badge, item.stato === "attiva" && styles.badgeAttiva]}>{item.stato}</Text>
            </View>
            <Text style={styles.cardSotto}>Apertura: {item.data_apertura}</Text>
            <View style={styles.azioni}>
              {puoScrivere && item.stato === "attiva" && (
                <Pressable style={styles.bottoneSecondario} onPress={() => generaBaseline(item.id)}>
                  <Text style={styles.bottoneSecondarioTesto}>Genera baseline</Text>
                </Pressable>
              )}
              {puoGestireStagioni && item.stato === "attiva" && (
                <Pressable style={styles.bottoneSecondarioDistruttivo} onPress={confermaChiusura} disabled={inCorso}>
                  <Text style={styles.bottoneSecondarioDistruttivoTesto}>{inCorso ? "Un attimo…" : "Termina e apri la nuova"}</Text>
                </Pressable>
              )}
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
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, marginBottom: 10, gap: 4 },
  cardTitolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  cardSotto: { color: brand.colors.muted, fontSize: 13 },
  badge: { color: brand.colors.muted, fontSize: 12, textTransform: "uppercase" },
  badgeAttiva: { color: brand.colors.success, fontWeight: "700" },
  azioni: { flexDirection: "row", gap: 8, marginTop: 8 },
  bottoneSecondario: { borderColor: brand.colors.brand, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "600", fontSize: 13 },
  bottoneSecondarioDistruttivo: { borderColor: brand.colors.error, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  bottoneSecondarioDistruttivoTesto: { color: brand.colors.error, fontWeight: "600", fontSize: 13 },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
});
