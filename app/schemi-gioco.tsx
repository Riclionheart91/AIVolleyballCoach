import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { brand } from "@/src/config";
import { avvisa } from "@/src/lib/confermaAzione";
import { FASI_SCHEMA, SCHEMA_BASE, VARIANTI_SCHEMA, chiaveSchema, type Assegnazioni, type FaseSchema } from "@/src/lib/schemiGioco";
import { elencaSchemiGioco, ripristinaSchemaGioco, salvaSchemaGioco } from "@/src/services/schemiGioco";

// Disposizione del campo: rete in alto, fila avanti 4-3-2, fila dietro 5-6-1.
const GRIGLIA: number[][] = [[4, 3, 2], [5, 6, 1]];

/** Schermata per definire dove stanno le giocatrici in ricezione, difesa e copertura, rotazione per rotazione. */
export default function SchemiGioco() {
  const { team } = useAuth();
  const [salvati, setSalvati] = useState<Record<string, Assegnazioni>>({});
  const [bozze, setBozze] = useState<Record<string, Assegnazioni>>({});
  const [fase, setFase] = useState<FaseSchema>("ricezione");
  const [variante, setVariante] = useState(1);
  const [rotazione, setRotazione] = useState(1);
  const [zonaScelta, setZonaScelta] = useState<number | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const carica = useCallback(async () => {
    if (!team) return;
    try { setSalvati(await elencaSchemiGioco(team.id)); setBozze({}); }
    catch (e) { avvisa("Errore", (e as Error).message); }
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  const chiave = chiaveSchema(fase, variante, rotazione);
  const corrente: Assegnazioni = bozze[chiave] ?? salvati[chiave] ?? SCHEMA_BASE;
  const posizioneInZona = (zona: number): number => {
    for (let p = 1; p <= 6; p++) if (Number(corrente[String(p)]) === zona) return p;
    return zona;
  };
  const numeroBozze = Object.keys(bozze).length;

  /** Primo tocco sceglie una zona, il secondo la scambia con la prima. */
  function tocca(zona: number) {
    if (zonaScelta === null) { setZonaScelta(zona); return; }
    if (zonaScelta === zona) { setZonaScelta(null); return; }
    const pA = posizioneInZona(zonaScelta);
    const pB = posizioneInZona(zona);
    const nuovo: Assegnazioni = { ...corrente, [String(pA)]: zona, [String(pB)]: zonaScelta };
    setBozze((b) => ({ ...b, [chiave]: nuovo }));
    setZonaScelta(null);
  }

  async function salva() {
    if (!team || numeroBozze === 0) return;
    setInCorso(true);
    try {
      for (const [k, a] of Object.entries(bozze)) {
        const [f, v, r] = k.split(":");
        await salvaSchemaGioco(team.id, f as FaseSchema, Number(v), Number(r), a);
      }
      await carica();
    } catch (e) { avvisa("Salvataggio non riuscito", (e as Error).message); }
    finally { setInCorso(false); }
  }

  async function ripristina() {
    if (!team) return;
    setInCorso(true);
    try {
      if (salvati[chiave]) await ripristinaSchemaGioco(team.id, fase, variante, rotazione);
      setBozze((b) => { const c = { ...b }; delete c[chiave]; return c; });
      await carica();
    } catch (e) { avvisa("Errore", (e as Error).message); }
    finally { setInCorso(false); }
  }

  const infoFase = FASI_SCHEMA.find((f) => f.fase === fase)!;
  const configurata = (f: FaseSchema, v: number, r: number) => !!(salvati[chiaveSchema(f, v, r)] || bozze[chiaveSchema(f, v, r)]);

  /** Parte dallo schema della variante 1 della stessa rotazione: comodo per creare la variante 2 cambiando poche zone. */
  function copiaDallaVariante1() {
    const origine = bozze[chiaveSchema(fase, 1, rotazione)] ?? salvati[chiaveSchema(fase, 1, rotazione)] ?? SCHEMA_BASE;
    setBozze((b) => ({ ...b, [chiave]: { ...origine } }));
    setZonaScelta(null);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← Indietro</Text></Pressable>
        <Text style={styles.titolo}>Schemi di gioco</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={styles.nota}>
          Per ogni fase e rotazione scegli dove sta ciascuna giocatrice. Nello scouting il campo mostra le giocatrici nelle zone dello schema, così le tocchi dove stanno davvero. La rotazione è la posizione della palleggiatrice (es. "Rotazione 1" = palleggiatrice in posizione 1). Quello che non imposti resta com'è, nelle posizioni di rotazione.
        </Text>

        <View style={styles.selettoreRiga}>
          {FASI_SCHEMA.map((f) => (
            <Pressable key={f.fase} onPress={() => { setFase(f.fase); setZonaScelta(null); }} style={[styles.chip, fase === f.fase && styles.chipAttivo]}>
              <Text style={[styles.chipTesto, fase === f.fase && styles.chipTestoAttivo]}>{f.etichetta}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.nota}>{infoFase.descrizione}</Text>

        <View style={styles.selettoreRiga}>
          {[1, 2].map((v) => (
            <Pressable key={v} onPress={() => { setVariante(v); setZonaScelta(null); }} style={[styles.chip, variante === v && styles.chipAttivo]}>
              <Text style={[styles.chipTesto, variante === v && styles.chipTestoAttivo]}>{VARIANTI_SCHEMA[fase][v - 1]}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.nota}>Durante la partita potrai passare da una variante all'altra con un tocco.</Text>

        <View style={styles.selettoreRiga}>
          {[1, 2, 3, 4, 5, 6].map((r) => (
            <Pressable key={r} onPress={() => { setRotazione(r); setZonaScelta(null); }} style={[styles.chip, rotazione === r && styles.chipAttivo]}>
              <Text style={[styles.chipTesto, rotazione === r && styles.chipTestoAttivo]}>Rot. {r}{configurata(fase, variante, r) ? " ✓" : ""}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.campo}>
          <Text style={styles.rete}>RETE</Text>
          {GRIGLIA.map((riga, i) => (
            <View key={i} style={styles.rigaCampo}>
              {riga.map((zona) => {
                const pos = posizioneInZona(zona);
                const scelta = zonaScelta === zona;
                return (
                  <Pressable key={zona} onPress={() => tocca(zona)} style={[styles.cella, scelta && styles.cellaScelta]}>
                    <Text style={styles.cellaZona}>zona {zona}</Text>
                    <Text style={styles.cellaPos}>pos. {pos}</Text>
                    {pos === rotazione && <Text style={styles.cellaPalleggio}>Palleggio</Text>}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
        <Text style={styles.nota}>
          {zonaScelta === null
            ? "Tocca una zona e poi un'altra per scambiare chi ci sta."
            : `Zona ${zonaScelta} scelta: tocca la zona con cui scambiarla.`}
        </Text>

        <View style={styles.selettoreRiga}>
          <Pressable disabled={numeroBozze === 0 || inCorso} onPress={salva} style={[styles.bottone, (numeroBozze === 0 || inCorso) && styles.bottoneSpento]}>
            <Text style={styles.bottoneTesto}>{numeroBozze > 0 ? `Salva (${numeroBozze})` : "Salva"}</Text>
          </Pressable>
          {variante === 2 && (
            <Pressable disabled={inCorso} onPress={copiaDallaVariante1} style={styles.bottoneSecondario}>
              <Text style={styles.bottoneSecondarioTesto}>Parti dalla variante 1</Text>
            </Pressable>
          )}
          <Pressable disabled={inCorso} onPress={ripristina} style={styles.bottoneSecondario}>
            <Text style={styles.bottoneSecondarioTesto}>Torna alle posizioni di rotazione</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  nota: { color: brand.colors.muted, fontSize: 12 },
  selettoreRiga: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  campo: { backgroundColor: "#1a3a2a", borderRadius: 12, padding: 8, gap: 6, borderWidth: 2, borderColor: brand.colors.brand },
  rete: { color: "#fff", fontSize: 10, fontWeight: "700", letterSpacing: 2, textAlign: "center", borderBottomWidth: 3, borderBottomColor: "#fff", paddingBottom: 2 },
  rigaCampo: { flexDirection: "row", gap: 6 },
  cella: { flex: 1, minHeight: 84, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center", gap: 2 },
  cellaScelta: { borderColor: brand.colors.brand, borderWidth: 3, backgroundColor: "rgba(255,255,255,0.18)" },
  cellaZona: { color: "rgba(255,255,255,0.6)", fontSize: 10 },
  cellaPos: { color: "#fff", fontSize: 18, fontWeight: "800" },
  cellaPalleggio: { color: brand.colors.brand, fontSize: 11, fontWeight: "700" },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, alignItems: "center" },
  bottoneSpento: { opacity: 0.4 },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  bottoneSecondario: { borderColor: brand.colors.border, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 8, alignItems: "center" },
  bottoneSecondarioTesto: { color: brand.colors.onSurface, fontSize: 13 },
});
