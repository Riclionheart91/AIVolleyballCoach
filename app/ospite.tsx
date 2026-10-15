import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, FlatList } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { brand } from "@/src/config";
import { miePartiteScoutOspite, type PartitaOspite } from "@/src/services/scoutOspiti";

/**
 * Casa dello SCOUT OSPITE: chi e' stato invitato su una partita senza far
 * parte della squadra. Vede solo le partite a cui e' stato invitato e puo'
 * entrare nello scouting solo quando la partita e' in corso.
 */
export default function Ospite() {
  const { session, esci } = useAuth();
  const [partite, setPartite] = useState<PartitaOspite[] | null>(null);

  const carica = useCallback(async () => {
    setPartite(await miePartiteScoutOspite());
  }, []);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  function formattaData(iso: string | null): string {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("it-IT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  }

  async function onEsci() {
    await esci();
    router.replace("/login");
  }

  return (
    <View style={styles.container}>
      <Text style={styles.titolo}>Scout ospite</Text>
      <Text style={styles.sottotitolo}>
        Sei stato invitato a registrare una partita. Puoi vedere e scoutare solo la partita indicata, e solo mentre è in corso.
      </Text>
      {session?.user.email && <Text style={styles.account}>Connesso come: {session.user.email}</Text>}

      {partite === null ? (
        <ActivityIndicator color={brand.colors.brand} />
      ) : (
        <FlatList
          style={{ width: "100%", maxWidth: 420 }}
          contentContainerStyle={{ gap: 10 }}
          data={partite}
          keyExtractor={(p) => p.match_id}
          ListEmptyComponent={<Text style={styles.sottotitolo}>Nessuna partita disponibile al momento. Se la partita è appena finita l'accesso termina in automatico.</Text>}
          renderItem={({ item }) => {
            const inCorso = item.stato === "in_corso";
            return (
              <View style={styles.card}>
                <Text style={styles.cardSquadra}>{item.team_nome}</Text>
                <Text style={styles.cardTitolo}>vs {item.avversario}</Text>
                {!!item.data && <Text style={styles.cardNota}>{formattaData(item.data)}</Text>}
                {inCorso ? (
                  <Pressable style={styles.bottone} onPress={() => router.push(`/partita/${item.match_id}?ospite=1`)}>
                    <Text style={styles.bottoneTesto}>Entra nello scouting</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.cardNota}>Non ancora iniziata: potrai entrare quando l'allenatore avvia la partita.</Text>
                )}
              </View>
            );
          }}
        />
      )}

      <Pressable style={styles.bottoneSecondario} onPress={carica}>
        <Text style={styles.bottoneSecondarioTesto}>↻ Aggiorna</Text>
      </Pressable>
      <Pressable onPress={onEsci}>
        <Text style={styles.esci}>Esci</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: brand.colors.surface, padding: 24, gap: 14 },
  titolo: { color: brand.colors.onSurface, fontSize: 24, fontWeight: "700", textAlign: "center" },
  sottotitolo: { color: brand.colors.muted, textAlign: "center", maxWidth: 340, lineHeight: 20 },
  account: { color: brand.colors.muted, fontSize: 12 },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 4, borderWidth: 1, borderColor: brand.colors.border },
  cardSquadra: { color: brand.colors.muted, fontSize: 12 },
  cardTitolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  cardNota: { color: brand.colors.muted, fontSize: 12 },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, marginTop: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  bottoneSecondario: { borderColor: brand.colors.brandSecondary, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10 },
  bottoneSecondarioTesto: { color: brand.colors.brandSecondary, fontWeight: "600", fontSize: 13 },
  esci: { color: brand.colors.muted, fontSize: 13, textDecorationLine: "underline" },
});
