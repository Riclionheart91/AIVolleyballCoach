import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { brand } from "@/src/config";
import { avvisa, confermaAzione } from "@/src/lib/confermaAzione";
import { FASI_SCHEMA, PUNTI_RUOLO_LINEA, SCHEMA_BASE, VARIANTI_SCHEMA, ZONA_PREDEFINITA, ZONE_ATTACCO, chiaveSchema, faseConZona, indiceSchema, ruoloInPosizione, type Assegnazioni, type FaseSchema, type Punto } from "@/src/lib/schemiGioco";
import { CampoSchemaEditor } from "@/src/components/CampoPallini";
import { elencaSchemiGioco, ripristinaSchemaGioco, salvaSchemaGioco } from "@/src/services/schemiGioco";

/** Schermata per definire dove stanno le giocatrici in ricezione, difesa e copertura, rotazione per rotazione. */
export default function SchemiGioco() {
  const { team, puoScrivere, isSuperuser } = useAuth();
  // Gli schemi li vedono tutti (staff, atlete, presidenti); li modifica solo chi allena.
  const modificabile = puoScrivere || isSuperuser;
  const [salvati, setSalvati] = useState<Record<string, Assegnazioni>>({});
  const [bozze, setBozze] = useState<Record<string, Assegnazioni>>({});
  const [fase, setFase] = useState<FaseSchema>("ricezione");
  const [variante, setVariante] = useState(1);
  const [rotazione, setRotazione] = useState(1);
  const [zona, setZona] = useState<number>(ZONA_PREDEFINITA);
  const [pallinoScelto, setPallinoScelto] = useState<number | null>(null);
  const [trascinando, setTrascinando] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  const carica = useCallback(async () => {
    if (!team) return;
    try { setSalvati(await elencaSchemiGioco(team.id)); setBozze({}); }
    catch (e) { avvisa("Errore", (e as Error).message); }
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  const perZona = faseConZona(fase);
  // Ricezione: una rotazione (1-6). Difesa e copertura: la zona da cui si attacca.
  const indice = indiceSchema(fase, rotazione, zona) ?? rotazione;
  const chiave = chiaveSchema(fase, variante, indice);
  const corrente: Assegnazioni = bozze[chiave] ?? salvati[chiave] ?? SCHEMA_BASE;
  const numeroBozze = Object.keys(bozze).length;

  /** Sposta un pallino (trascinandolo o toccando il punto di arrivo). */
  function sposta(slot: number, punto: Punto) {
    if (!Number.isFinite(punto.x) || !Number.isFinite(punto.y)) return;
    setBozze((b) => ({ ...b, [chiave]: { ...(b[chiave] ?? salvati[chiave] ?? SCHEMA_BASE), [String(slot)]: punto } }));
  }

  async function salva() {
    if (!team || numeroBozze === 0) return;
    setInCorso(true);
    try {
      for (const [k, a] of Object.entries(bozze)) {
        const [f, v, r] = k.split(":");
        // Rete di sicurezza: un punto non numerico (non dovrebbe succedere) torna alla posizione base invece di bloccare il salvataggio.
        const pulita: Assegnazioni = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => {
          const pt = a[String(n)];
          return [String(n), pt && Number.isFinite(pt.x) && Number.isFinite(pt.y) ? pt : SCHEMA_BASE[String(n)]];
        }));
        await salvaSchemaGioco(team.id, f as FaseSchema, Number(v), Number(r), pulita);
      }
      const n = Object.keys(bozze).length;
      await carica();
      setMessaggio(n === 1 ? "Schema salvato ✓" : `${n} schemi salvati ✓`);
      setTimeout(() => setMessaggio(null), 4000);
    } catch (e) { avvisa("Salvataggio non riuscito", (e as Error).message); }
    finally { setInCorso(false); }
  }

  async function ripristina() {
    if (!team) return;
    setInCorso(true);
    try {
      if (salvati[chiave]) await ripristinaSchemaGioco(team.id, fase, variante, indice);
      setBozze((b) => { const c = { ...b }; delete c[chiave]; return c; });
      await carica();
    } catch (e) { avvisa("Errore", (e as Error).message); }
    finally { setInCorso(false); }
  }

  const infoFase = FASI_SCHEMA.find((f) => f.fase === fase)!;
  const configurata = (f: FaseSchema, v: number, n: number) => !!(salvati[chiaveSchema(f, v, n)] || bozze[chiaveSchema(f, v, n)]);

  /** Parte dallo schema della variante 1 della stessa rotazione: comodo per creare la variante 2 cambiando poche zone. */
  function copiaDallaVariante1() {
    const origine = bozze[chiaveSchema(fase, 1, indice)] ?? salvati[chiaveSchema(fase, 1, indice)] ?? SCHEMA_BASE;
    setBozze((b) => ({ ...b, [chiave]: { ...origine } }));
    setPallinoScelto(null);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            if (numeroBozze === 0) { router.back(); return; }
            confermaAzione("Uscire senza salvare?", `Hai ${numeroBozze} modifiche non salvate.`, "Esci senza salvare", () => router.back(), true);
          }}
          hitSlop={12}
        >
          <Text style={styles.indietro}>← Indietro</Text>
        </Pressable>
        <Text style={styles.titolo}>Schemi di gioco</Text>
      </View>

      <ScrollView style={{ flex: 1 }} scrollEnabled={!trascinando} contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={styles.nota}>
          {modificabile
            ? "Scegli dove sta ciascuna giocatrice in ricezione, difesa e copertura. Nello scouting le giocatrici sono disegnate come pallini nei punti dello schema, così le tocchi dove stanno davvero. Quello che non imposti resta nelle posizioni di rotazione."
            : "Gli schemi di gioco della squadra: dove si dispongono le giocatrici in ricezione, difesa e copertura. Sola lettura: li modifica l'allenatore."}
        </Text>
        <Text style={styles.nota}>
          {perZona
            ? "Ruoli: P/O palleggiatrice e opposto (stesso punto: chi è davanti e chi è dietro), S schiacciatrice, C centrale. Il libero prende il punto della centrale in seconda linea. Lo schema vale per tutte le rotazioni."
            : "Ruoli: P palleggiatrice, S1 e S2 schiacciatrici, C1 e C2 centrali, O opposto. Rotazione n = palleggiatrice in posizione n (Rot. 1: P in 1, Rot. 2: P in 2, e così via)."}
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

        {perZona && (
          <Text style={styles.nota}>
            {fase === "difesa" ? "Zona da cui attacca l'avversario (in partita la scegli con un tocco):" : "Zona da cui attacchiamo noi (in partita è quella di chi attacca, correggibile con un tocco):"}
          </Text>
        )}
        <View style={styles.selettoreRiga}>
          {(perZona ? [...ZONE_ATTACCO] : [1, 2, 3, 4, 5, 6]).map((n) => {
            const attivo = (perZona ? zona : rotazione) === n;
            return (
              <Pressable key={n} onPress={() => { if (perZona) setZona(n); else setRotazione(n); setPallinoScelto(null); }} style={[styles.chip, attivo && styles.chipAttivo]}>
                <Text style={[styles.chipTesto, attivo && styles.chipTestoAttivo]}>{perZona ? `Zona ${n}` : `Rot. ${n}`}{configurata(fase, variante, n) ? " ✓" : ""}</Text>
              </Pressable>
            );
          })}
        </View>

        <CampoSchemaEditor
          posizioni={corrente}
          slotPalleggio={perZona ? 0 : rotazione}
          selezionato={pallinoScelto}
          onSeleziona={setPallinoScelto}
          onSposta={sposta}
          onTrascina={setTrascinando}
          modificabile={modificabile}
          etichette={Object.fromEntries([1, 2, 3, 4, 5, 6].map((s) => [s, perZona ? PUNTI_RUOLO_LINEA[s].sigla : ruoloInPosizione(s, rotazione)]))}
          sottoEtichette={perZona ? Object.fromEntries([1, 2, 3, 4, 5, 6].map((s) => [s, PUNTI_RUOLO_LINEA[s].linea])) : undefined}
        />
        <Text style={styles.nota}>
          {perZona
            ? `Attacco dalla zona ${zona}.`
            : `Rotazione ${rotazione}: palleggiatrice in posizione ${rotazione}. ${[1, 2, 3, 4, 5, 6].map((s) => `${ruoloInPosizione(s, rotazione)} in ${s}`).join(" · ")}.`}
          {modificabile ? " Trascina i pallini dove stanno in questa fase, oppure tocca un pallino e poi il punto del campo." : ""}
        </Text>

      </ScrollView>

      {modificabile && (
        <View style={styles.barraFissa}>
          {messaggio && <Text style={styles.messaggioOk}>{messaggio}</Text>}
          <View style={styles.selettoreRiga}>
            <Pressable disabled={numeroBozze === 0 || inCorso} onPress={salva} style={[styles.bottone, (numeroBozze === 0 || inCorso) && styles.bottoneSpento]}>
              <Text style={styles.bottoneTesto}>{inCorso ? "Salvo…" : numeroBozze > 0 ? `Salva (${numeroBozze})` : "Salva"}</Text>
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
        </View>
      )}
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
  barraFissa: { padding: 12, gap: 6, borderTopWidth: 1, borderTopColor: brand.colors.border, backgroundColor: brand.colors.surface },
  messaggioOk: { color: brand.colors.success, fontSize: 13, fontWeight: "700" },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, alignItems: "center" },
  bottoneSpento: { opacity: 0.4 },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  bottoneSecondario: { borderColor: brand.colors.border, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 8, alignItems: "center" },
  bottoneSecondarioTesto: { color: brand.colors.onSurface, fontSize: 13 },
});
