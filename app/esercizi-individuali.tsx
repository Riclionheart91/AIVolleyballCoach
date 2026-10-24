import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaAtlete } from "@/src/services/athletes";
import { elencaPianiIndividuali, type PianoIndividuale } from "@/src/services/pianiIndividuali";
import { PianiIndividuali } from "@/src/components/PianiIndividuali";
import { NuovoPianoForm } from "@/src/components/piani/NuovoPianoForm";
import { avvisa } from "@/src/lib/confermaAzione";
import { brand } from "@/src/config";
import type { Athlete } from "@/src/types/database";

interface Riga { atleta: Athlete; piani: PianoIndividuale[] }

/**
 * Esercizi individuali della squadra: si crea un piano (esercizi dal catalogo o scritti a mano) e lo si assegna
 * a un gruppo di persone; ognuna ha la sua copia da spuntare. Toccando una persona si vedono e si modificano i suoi piani.
 */
export default function EserciziIndividuali() {
  const { team, puoScrivere } = useAuth();
  const [righe, setRighe] = useState<Riga[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [nuovo, setNuovo] = useState(false);
  const [aperta, setAperta] = useState<string | null>(null);
  const [versione, setVersione] = useState(0);

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      const atlete = await elencaAtlete(team.id);
      const piani = await Promise.all(atlete.map((a) => elencaPianiIndividuali(a.id).catch(() => [] as PianoIndividuale[])));
      setRighe(atlete.map((a, i) => ({ atleta: a, piani: piani[i] })));
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setCaricamento(false);
    }
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  const media = (piani: PianoIndividuale[]) => {
    const attivi = piani.filter((p) => p.stato === "attivo" && p.attesi_settimana > 0);
    if (attivi.length === 0) return null;
    return Math.round((attivi.reduce((s, p) => s + Math.min(1, p.svolgimenti_settimana / p.attesi_settimana), 0) / attivi.length) * 100);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← Profilo</Text></Pressable>
        <Text style={styles.titolo}>Esercizi individuali</Text>
      </View>

      {!puoScrivere || !team ? (
        <Text style={styles.vuoto}>Questa pagina è riservata allo staff tecnico.</Text>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          {nuovo ? (
            <NuovoPianoForm
              teamId={team.id}
              atlete={righe.map((r) => r.atleta)}
              onAnnulla={() => setNuovo(false)}
              onCreato={(n) => { setNuovo(false); setVersione((v) => v + 1); carica(); avvisa("Piano assegnato", `Creato per ${n} ${n === 1 ? "persona" : "persone"}. Ognuna spunta le sue sedute.`); }}
            />
          ) : (
            <Pressable style={styles.bottone} onPress={() => setNuovo(true)}>
              <Text style={styles.bottoneTesto}>+ Nuovo piano per un gruppo</Text>
            </Pressable>
          )}

          <Text style={styles.nota}>
            Un piano si assegna a più persone insieme: ognuna riceve la sua copia. Tocca una persona per vedere i suoi piani, cambiare, sostituire o togliere gli esercizi, aggiungerne di nuovi o assegnare il piano ad altre.
          </Text>

          {caricamento && righe.length === 0 ? <ActivityIndicator color={brand.colors.brand} style={{ marginTop: 20 }} /> : righe.map(({ atleta, piani }) => {
            const m = media(piani);
            const espansa = aperta === atleta.id;
            return (
              <View key={atleta.id} style={styles.card}>
                <Pressable style={styles.rigaPersona} onPress={() => setAperta(espansa ? null : atleta.id)}>
                  <Text style={styles.freccia}>{espansa ? "▾" : "▸"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nome}>{atleta.nome} {atleta.cognome}</Text>
                    <Text style={styles.sotto}>
                      {piani.length === 0 ? "nessun piano" : `${piani.length} ${piani.length === 1 ? "piano" : "piani"}: ${piani.map((p) => p.titolo).slice(0, 2).join(", ")}${piani.length > 2 ? "…" : ""}`}
                    </Text>
                  </View>
                  {m !== null && <Text style={styles.percentuale}>{m}%</Text>}
                </Pressable>
                {espansa && (
                  <View style={{ marginTop: 10 }}>
                    <PianiIndividuali
                      key={`${atleta.id}-${versione}`}
                      teamId={team.id}
                      athleteId={atleta.id}
                      nomePersona={`${atleta.nome} ${atleta.cognome}`}
                      ruolo={atleta.ruolo_campo}
                      modificabile
                    />
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 40, padding: 16 },
  nota: { color: brand.colors.muted, fontSize: 12, lineHeight: 17 },
  bottone: { backgroundColor: brand.colors.brand, padding: 12, borderRadius: 10, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 12 },
  rigaPersona: { flexDirection: "row", alignItems: "center", gap: 10 },
  freccia: { color: brand.colors.brandSecondary, fontSize: 14, width: 14 },
  nome: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "600" },
  sotto: { color: brand.colors.muted, fontSize: 12, marginTop: 2 },
  percentuale: { color: brand.colors.brand, fontSize: 16, fontWeight: "800" },
});
