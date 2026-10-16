import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { brand } from "@/src/config";
import { avvisa } from "@/src/lib/confermaAzione";
import { FASI_SCHEMA, SCHEMA_BASE, VARIANTI_SCHEMA, chiaveSchema, type Assegnazioni, type FaseSchema, type Punto } from "@/src/lib/schemiGioco";
import { CampoSchemaEditor } from "@/src/components/CampoPallini";
import { elencaSchemiGioco, ripristinaSchemaGioco, salvaSchemaGioco } from "@/src/services/schemiGioco";

/** Schermata per definire dove stanno le giocatrici in ricezione, difesa e copertura, rotazione per rotazione. */
export default function SchemiGioco() {
  const { team } = useAuth();
  const [salvati, setSalvati] = useState<Record<string, Assegnazioni>>({});
  const [bozze, setBozze] = useState<Record<string, Assegnazioni>>({});
  const [fase, setFase] = useState<FaseSchema>("ricezione");
  const [variante, setVariante] = useState(1);
  const [rotazione, setRotazione] = useState(1);
  const [pallinoScelto, setPallinoScelto] = useState<number | null>(null);
  const [trascinando, setTrascinando] = useState(false);
  const [inCorso, setInCorso] = useState(false);

  const carica = useCallback(async () => {
    if (!team) return;
    try { setSalvati(await elencaSchemiGioco(team.id)); setBozze({}); }
    catch (e) { avvisa("Errore", (e as Error).message); }
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  const chiave = chiaveSchema(fase, variante, rotazione);
  const corrente: Assegnazioni = bozze[chiave] ?? salvati[chiave] ?? SCHEMA_BASE;
  const numeroBozze = Object.keys(bozze).length;

  /** Sposta un pallino (trascinandolo o toccando il punto di arrivo). */
  function sposta(slot: number, punto: Punto) {
    setBozze((b) => ({ ...b, [chiave]: { ...(b[chiave] ?? salvati[chiave] ?? SCHEMA_BASE), [String(slot)]: punto } }));
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
    setPallinoScelto(null);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← Indietro</Text></Pressable>
        <Text style={styles.titolo}>Schemi di gioco</Text>
      </View>

      <ScrollView scrollEnabled={!trascinando} contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={styles.nota}>
          Per ogni fase e rotazione scegli dove sta ciascuna giocatrice. Nello scouting il campo mostra le giocatrici nelle zone dello schema, così le tocchi dove stanno davvero. La rotazione è la posizione della palleggiatrice (es. "Rotazione 1" = palleggiatrice in posizione 1). Quello che non imposti resta com'è, nelle posizioni di rotazione.
        </Text>

        <View style={styles.selettoreRiga}>
          {FASI_SCHEMA.map((f) => (
            <Pressable key={f.fase} onPress={() => { setFase(f.fase); setPallinoScelto(null); }} style={[styles.chip, fase === f.fase && styles.chipAttivo]}>
              <Text style={[styles.chipTesto, fase === f.fase && styles.chipTestoAttivo]}>{f.etichetta}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.nota}>{infoFase.descrizione}</Text>

        <View style={styles.selettoreRiga}>
          {[1, 2].map((v) => (
            <Pressable key={v} onPress={() => { setVariante(v); setPallinoScelto(null); }} style={[styles.chip, variante === v && styles.chipAttivo]}>
              <Text style={[styles.chipTesto, variante === v && styles.chipTestoAttivo]}>{VARIANTI_SCHEMA[fase][v - 1]}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.nota}>Durante la partita potrai passare da una variante all'altra con un tocco.</Text>

        <View style={styles.selettoreRiga}>
          {[1, 2, 3, 4, 5, 6].map((r) => (
            <Pressable key={r} onPress={() => { setRotazione(r); setPallinoScelto(null); }} style={[styles.chip, rotazione === r && styles.chipAttivo]}>
              <Text style={[styles.chipTesto, rotazione === r && styles.chipTestoAttivo]}>Rot. {r}{configurata(fase, variante, r) ? " ✓" : ""}</Text>
            </Pressable>
          ))}
        </View>

        <CampoSchemaEditor
          posizioni={corrente}
          slotPalleggio={rotazione}
          selezionato={pallinoScelto}
          onSeleziona={setPallinoScelto}
          onSposta={sposta}
          onTrascina={setTrascinando}
        />
        <Text style={styles.nota}>
          Trascina i pallini dove stanno in questa fase, oppure tocca un pallino e poi il punto del campo. Il numero è la posizione di rotazione; "P" è la palleggiatrice.
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
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, alignItems: "center" },
  bottoneSpento: { opacity: 0.4 },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  bottoneSecondario: { borderColor: brand.colors.border, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 8, alignItems: "center" },
  bottoneSecondarioTesto: { color: brand.colors.onSurface, fontSize: 13 },
});
