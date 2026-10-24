import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { brand } from "@/src/config";
import { avvisa, confermaAzione } from "@/src/lib/confermaAzione";
import { schemaDiPartenza, FASI_SCHEMA, PUNTI_RUOLO_LINEA, SCHEMA_BASE, VARIANTI_SCHEMA, ZONA_PREDEFINITA, chiaveSchema, faseConZona, indiceSchema, ruoloInPosizione, type Assegnazioni, type FaseSchema, type Punto } from "@/src/lib/schemiGioco";
import { CampoSchemaEditor } from "@/src/components/CampoPallini";
import { elencaSchemiGiocoConOrigine, impostaSchemiStandardDaSquadra, ripristinaSchemaGioco, salvaSchemaGioco } from "@/src/services/schemiGioco";

/** Schermata per definire dove stanno le giocatrici in ricezione, difesa e copertura, rotazione per rotazione. */
export default function SchemiGioco() {
  const { team, puoScrivere, isSuperuser } = useAuth();
  // Gli schemi li vedono tutti (staff, atlete, presidenti); li modifica solo chi allena.
  const modificabile = puoScrivere || isSuperuser;
  const [salvati, setSalvati] = useState<Record<string, Assegnazioni>>({});
  const [daStandard, setDaStandard] = useState<Record<string, boolean>>({});
  const [bozze, setBozze] = useState<Record<string, Assegnazioni>>({});
  const [fase, setFase] = useState<FaseSchema>("ricezione");
  const [variante, setVariante] = useState(1);
  const [rotazione, setRotazione] = useState(1);
  const [pallinoScelto, setPallinoScelto] = useState<number | null>(null);
  const [trascinando, setTrascinando] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  const carica = useCallback(async () => {
    if (!team) return;
    try { const r = await elencaSchemiGiocoConOrigine(team.id); setSalvati(r.schemi); setDaStandard(r.standard); setBozze({}); }
    catch (e) { avvisa("Errore", (e as Error).message); }
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  const perZona = faseConZona(fase);
  // Ricezione: una rotazione (1-6). Difesa e copertura: un solo schema (per ruolo e linea) per variante.
  const indice = indiceSchema(fase, rotazione, ZONA_PREDEFINITA) ?? rotazione;
  const chiave = chiaveSchema(fase, variante, indice);
  const corrente: Assegnazioni = bozze[chiave] ?? salvati[chiave] ?? schemaDiPartenza(fase);
  const numeroBozze = Object.keys(bozze).length;

  /** Sposta un pallino (trascinandolo o toccando il punto di arrivo). */
  function sposta(slot: number, punto: Punto) {
    if (!Number.isFinite(punto.x) || !Number.isFinite(punto.y)) return;
    setBozze((b) => ({ ...b, [chiave]: { ...(b[chiave] ?? salvati[chiave] ?? schemaDiPartenza(fase)), [String(slot)]: punto } }));
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
          return [String(n), pt && Number.isFinite(pt.x) && Number.isFinite(pt.y) ? pt : schemaDiPartenza(f as FaseSchema)[String(n)]];
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
      if (salvati[chiave] && !daStandard[chiave]) await ripristinaSchemaGioco(team.id, fase, variante, indice);
      setBozze((b) => { const c = { ...b }; delete c[chiave]; return c; });
      await carica();
    } catch (e) { avvisa("Errore", (e as Error).message); }
    finally { setInCorso(false); }
  }

  async function impostaStandard() {
    if (!team) return;
    confermaAzione(
      "Usare questi schemi come standard?",
      "Gli schemi di questa squadra diventano lo standard di tutte le squadre: chi non li ha personalizzati li vedrà subito, e le nuove squadre partiranno da qui.",
      "Imposta standard",
      async () => {
        setInCorso(true);
        try {
          const n = await impostaSchemiStandardDaSquadra(team.id);
          await carica();
          setMessaggio(`Standard aggiornato (${n} schemi) ✓`);
          setTimeout(() => setMessaggio(null), 4000);
        } catch (e) { avvisa("Errore", (e as Error).message); }
        finally { setInCorso(false); }
      },
    );
  }

  const infoFase = FASI_SCHEMA.find((f) => f.fase === fase)!;
  const configurata = (f: FaseSchema, v: number, n: number) => !!(salvati[chiaveSchema(f, v, n)] || bozze[chiaveSchema(f, v, n)]);

  /** Parte dallo schema della variante 1 della stessa rotazione: comodo per creare la variante 2 cambiando poche zone. */
  function copiaDallaVariante1() {
    const origine = bozze[chiaveSchema(fase, 1, indice)] ?? salvati[chiaveSchema(fase, 1, indice)] ?? schemaDiPartenza(fase);
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
            ? "Scegli dove sta ciascuna giocatrice in ricezione, difesa e copertura. Nello scouting le giocatrici sono disegnate come pallini nei punti dello schema, così le tocchi dove stanno davvero. Quello che non imposti resta nella disposizione di base."
            : "Gli schemi di gioco della squadra: dove si dispongono le giocatrici in ricezione, difesa e copertura. Sola lettura: li modifica l'allenatore."}
        </Text>
        <Text style={styles.nota}>
          {perZona
            ? "Ruoli: P/O palleggiatrice e opposto, S schiacciatrice, C centrale. Il libero prende il punto della centrale in seconda linea. Disposizione di base: S in 4 e 6, P/O in 1 e 2, C in 3 e 5."
            : "Ruoli: P palleggiatrice, S1 e S2 schiacciatrici, C1 e C2 centrali, O opposto. Rotazione n = palleggiatrice in posizione n (Rot. 1: P in 1, Rot. 2: P in 2, e così via)."}
        </Text>

        <View style={styles.selettoreRiga}>
          {FASI_SCHEMA.map((f) => (
            <Pressable key={f.fase} onPress={() => { setFase(f.fase); if (f.fase === "difesa") setVariante(1); setPallinoScelto(null); }} style={[styles.chip, fase === f.fase && styles.chipAttivo]}>
              <Text style={[styles.chipTesto, fase === f.fase && styles.chipTestoAttivo]}>{f.etichetta}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.nota}>{infoFase.descrizione}</Text>

        {fase !== "difesa" && (
          <>
        <View style={styles.selettoreRiga}>
          {[1, 2].map((v) => (
            <Pressable key={v} onPress={() => { setVariante(v); setPallinoScelto(null); }} style={[styles.chip, variante === v && styles.chipAttivo]}>
              <Text style={[styles.chipTesto, variante === v && styles.chipTestoAttivo]}>{VARIANTI_SCHEMA[fase][v - 1]}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.nota}>Durante la partita potrai passare da una variante all'altra con un tocco.</Text>
          </>
        )}

        {!perZona && (
          <View style={styles.selettoreRiga}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <Pressable key={n} onPress={() => { setRotazione(n); setPallinoScelto(null); }} style={[styles.chip, rotazione === n && styles.chipAttivo]}>
                <Text style={[styles.chipTesto, rotazione === n && styles.chipTestoAttivo]}>Rot. {n}{configurata(fase, variante, n) ? " ✓" : ""}</Text>
              </Pressable>
            ))}
          </View>
        )}

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
            ? "Vale per tutte le rotazioni: ogni giocatrice va nel punto del suo ruolo e della sua linea (prima o seconda)."
            : `Rotazione ${rotazione}: palleggiatrice in posizione ${rotazione}. ${[1, 2, 3, 4, 5, 6].map((s) => `${ruoloInPosizione(s, rotazione)} in ${s}`).join(" · ")}.`}
          {modificabile ? " Trascina i pallini dove stanno in questa fase, oppure tocca un pallino e poi il punto del campo." : ""}
        </Text>
        <Text style={styles.nota}>
          {daStandard[chiave] ? "📋 Schema standard (uguale per tutte le squadre): se lo modifichi e salvi, diventa personalizzato per la tua squadra."
            : salvati[chiave] ? "✏️ Schema personalizzato dalla tua squadra." : "Nessuno schema salvato: si usano le posizioni base."}
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
              <Text style={styles.bottoneSecondarioTesto}>Torna allo standard</Text>
            </Pressable>
            {isSuperuser && (
              <Pressable disabled={inCorso} onPress={impostaStandard} style={styles.bottoneSecondario}>
                <Text style={styles.bottoneSecondarioTesto}>Usa questa squadra come standard</Text>
              </Pressable>
            )}
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
