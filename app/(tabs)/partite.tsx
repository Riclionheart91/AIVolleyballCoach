import { useCallback, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, RefreshControl, ActivityIndicator, Modal, ScrollView } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { andamentoSquadraPartite, convertiPartitaInAllenamento, creaMatch, eliminaPartita, impostaLuogoPartita, elencaPartite, rendimentoRotazioniPartita, type AndamentoSquadraPartiteVoce, type RendimentoRotazionePartita } from "@/src/services/matches";
import { elencaCampionati, riassegnaCampionatoPartita } from "@/src/services/championships";
import { PannelloSporteasy } from "@/src/components/PannelloSporteasy";
import { brand } from "@/src/config";
import type { Campionato, Match } from "@/src/types/database";
import { avvisa, confermaAzione } from "@/src/lib/confermaAzione";
import { elencaScoutOspiti, invitaScoutOspite, rimuoviScoutOspite, type ScoutOspite } from "@/src/services/scoutOspiti";

export default function Partite() {
  const { team, puoScrivere, isSuperuser } = useAuth();
  // Stessa regola applicata dal database (funzione elimina_partita):
  // allenatore/vice della squadra oppure superuser.
  const puoEliminare = puoScrivere || isSuperuser;
  const [partite, setPartite] = useState<Match[]>([]);
  const [andamento, setAndamento] = useState<AndamentoSquadraPartiteVoce[]>([]);
  const [campionati, setCampionati] = useState<Campionato[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [avversario, setAvversario] = useState("");
  const [luogo, setLuogo] = useState<"casa" | "trasferta">("casa");
  const [tipoGara, setTipoGara] = useState<"campionato" | "amichevole">("amichevole");
  const [campionatoId, setCampionatoId] = useState<string | null>(null);
  const [pickerCampionatoMatchId, setPickerCampionatoMatchId] = useState<string | null>(null);
  // Chiuso di default: occupava spazio in cima anche quando non serviva.
  const [mostraAndamento, setMostraAndamento] = useState(false);
  const [mostraPassate, setMostraPassate] = useState(false);
  const [rotazioniPartita, setRotazioniPartita] = useState<{ nome: string; righe: RendimentoRotazionePartita[] } | null>(null);

  async function apriRotazioni(m: Match) {
    try {
      const righe = await rendimentoRotazioniPartita(m.id);
      setRotazioniPartita({ nome: m.avversario, righe });
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      const [listaPartite, listaAndamento, listaCampionati] = await Promise.all([
        elencaPartite(team.id),
        andamentoSquadraPartite(team.id).catch(() => []),
        elencaCampionati(team.id).catch(() => []),
      ]);
      setPartite(listaPartite);
      setAndamento(listaAndamento);
      setCampionati(listaCampionati);
    } finally {
      setCaricamento(false);
    }
  }, [team, puoScrivere]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  // Ordine: dalla piu' vicina a oggi alla piu' lontana. Una partita conclusa e' "passata"
  // (nascosta) dal giorno prima della prossima partita da giocare; quelle non concluse
  // restano sempre visibili.
  const { visibili, nascoste } = (() => {
    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
    const adesso = Date.now();
    const prossima = partite
      .filter((m) => m.stato !== "conclusa" && new Date(m.data).getTime() >= oggi.getTime())
      .sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime())[0];
    let soglia: number | null = null;
    if (prossima) { const g = new Date(prossima.data); g.setHours(0, 0, 0, 0); soglia = g.getTime() - 24 * 3600 * 1000; }
    const sonoPassate = (m: Match) => m.stato === "conclusa" && soglia !== null && adesso >= soglia;
    const ordinate = [...partite].sort((a, b) => Math.abs(new Date(a.data).getTime() - adesso) - Math.abs(new Date(b.data).getTime() - adesso));
    return { visibili: ordinate.filter((m) => !sonoPassate(m)), nascoste: ordinate.filter(sonoPassate) };
  })();
  const elenco = mostraPassate ? [...visibili, ...nascoste].sort((a, b) => Math.abs(new Date(a.data).getTime() - Date.now()) - Math.abs(new Date(b.data).getTime() - Date.now())) : visibili;

  async function nuovaPartita() {
    if (!team || !avversario.trim()) return;
    try {
      const matchId = await creaMatch(team.id, avversario.trim(), new Date().toISOString(), luogo, tipoGara === "campionato" ? campionatoId : null, tipoGara);
      setAvversario("");
      router.push(`/partita/${matchId}/prepara`);
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    }
  }

  function apriPartita(m: Match) {
    if (m.stato === "programmata") {
      if (!puoScrivere) { avvisa("Partita non ancora iniziata", "L'allenatore non ha ancora preparato questa partita."); return; }
      router.push(`/partita/${m.id}/prepara`);
      return;
    }
    router.push(`/partita/${m.id}`);
  }

  function chiediConversioneInAllenamento(m: Match) {
    confermaAzione(
      "Convertire in allenamento?",
      `"${m.avversario}" del ${new Date(m.data).toLocaleDateString("it-IT")} verrà spostato tra gli allenamenti. Usalo quando la lettura automatica del calendario SportEasy ha sbagliato categoria.`,
      "Sposta tra gli allenamenti",
      async () => {
        try {
          await convertiPartitaInAllenamento(m.id);
          carica();
          avvisa("Convertito", "Lo trovi ora nella tab Allenamenti.");
        } catch (e) { avvisa("Impossibile convertire", (e as Error).message); }
      },
    );
  }

  // Scout ospite: persona esterna invitata su UNA partita (vede solo quella, solo finche' e' in corso).
  const [ospitiPartita, setOspitiPartita] = useState<Match | null>(null);
  const [ospitiElenco, setOspitiElenco] = useState<ScoutOspite[]>([]);
  const [emailOspite, setEmailOspite] = useState("");
  const [invioOspite, setInvioOspite] = useState(false);

  async function apriOspiti(m: Match) {
    setOspitiPartita(m);
    setEmailOspite("");
    setOspitiElenco([]);
    try { setOspitiElenco(await elencaScoutOspiti(m.id)); }
    catch (e) { avvisa("Impossibile leggere gli inviti", (e as Error).message); }
  }

  async function onInvitaOspite() {
    if (!ospitiPartita || !emailOspite.trim()) return;
    setInvioOspite(true);
    try {
      await invitaScoutOspite(ospitiPartita.id, emailOspite.trim());
      setEmailOspite("");
      setOspitiElenco(await elencaScoutOspiti(ospitiPartita.id));
    } catch (e) { avvisa("Invito non riuscito", (e as Error).message); }
    finally { setInvioOspite(false); }
  }

  async function onRimuoviOspite(o: ScoutOspite) {
    if (!ospitiPartita) return;
    try {
      await rimuoviScoutOspite(o.id);
      setOspitiElenco(await elencaScoutOspiti(ospitiPartita.id));
    } catch (e) { avvisa("Impossibile rimuovere", (e as Error).message); }
  }

  function chiediEliminazione(m: Match) {
    const quando = new Date(m.data).toLocaleDateString("it-IT");
    const haDati = m.stato !== "programmata";
    confermaAzione(
      "Eliminare la partita?",
      `"vs ${m.avversario}" del ${quando} verrà eliminata definitivamente${haDati ? ", insieme a set, formazioni e azioni di scouting registrate" : ""}. L'operazione non si può annullare.`,
      "Elimina",
      async () => {
        try {
          await eliminaPartita(m.id);
          setPartite((prev) => prev.filter((p) => p.id !== m.id));
          carica();
        } catch (e) { avvisa("Impossibile eliminare", (e as Error).message); }
      },
      true,
    );
  }

  async function onCambiaLuogo(matchId: string, luogo: "casa" | "trasferta") {
    try {
      await impostaLuogoPartita(matchId, luogo);
      setPartite((prev) => prev.map((p) => (p.id === matchId ? { ...p, luogo } : p)));
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    }
  }

  async function onScegliCampionato(matchId: string, campionatoId: string | null) {
    try {
      await riassegnaCampionatoPartita(matchId, campionatoId);
      setPickerCampionatoMatchId(null);
      carica();
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    }
  }

  return (
    <View style={styles.container}>
      <Modal visible={!!rotazioniPartita} animationType="slide" transparent onRequestClose={() => setRotazioniPartita(null)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>Rotazioni — vs {rotazioniPartita?.nome}</Text>
            <Text style={styles.nota}>Identificate da chi era in posizione 1 al servizio. Dalla peggiore.</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {(rotazioniPartita?.righe ?? []).length === 0 ? (
                <Text style={styles.nota}>Nessun dato per rotazione: servono eventi registrati con la formazione impostata.</Text>
              ) : rotazioniPartita!.righe.map((r, i) => (
                <View key={i} style={styles.rigaRotazione}>
                  <Text style={styles.rigaRotazioneNome}>{r.rotazione_di}</Text>
                  <Text style={[styles.rigaRotazioneSaldo, r.saldo < 0 && styles.saldoNegativo]}>
                    {r.saldo >= 0 ? "+" : ""}{r.saldo} ({r.punti_fatti}/{r.errori_commessi} su {r.azioni_totali})
                  </Text>
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setRotazioniPartita(null)}><Text style={styles.chiudiPopup}>Chiudi</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!ospitiPartita} animationType="slide" transparent onRequestClose={() => setOspitiPartita(null)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>Scout ospite — vs {ospitiPartita?.avversario}</Text>
            <Text style={styles.nota}>
              Invita una persona esterna alla squadra: accede con Google usando questa email e vede soltanto questa partita, solo mentre è in corso. Può registrare azioni, annullare, fare cambi e gestire il Libero; non vede altro e non può avviare o chiudere set e partita. L'accesso termina da solo a partita conclusa.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Email dello scout (account Google)"
              placeholderTextColor={brand.colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={emailOspite}
              onChangeText={setEmailOspite}
            />
            <Pressable style={styles.bottone} onPress={onInvitaOspite} disabled={invioOspite}>
              <Text style={styles.bottoneTesto}>{invioOspite ? "Un attimo…" : "Invita"}</Text>
            </Pressable>
            <ScrollView style={{ maxHeight: 220 }}>
              {ospitiElenco.length === 0 ? (
                <Text style={styles.nota}>Nessuno scout ospite invitato.</Text>
              ) : ospitiElenco.map((o) => (
                <View key={o.id} style={styles.rigaRotazione}>
                  <Text style={styles.rigaRotazioneNome} numberOfLines={1}>{o.email}</Text>
                  <Pressable onPress={() => onRimuoviOspite(o)} hitSlop={8}>
                    <Text style={styles.erroreTesto}>Rimuovi</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setOspitiPartita(null)}><Text style={styles.chiudiPopup}>Chiudi</Text></Pressable>
          </View>
        </View>
      </Modal>

      <FlatList
        data={elenco}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingBottom: 60 }}
        ListHeaderComponent={
          <View style={{ gap: 16, marginBottom: 12 }}>

      {puoScrivere && (
        <>
          <View style={styles.form}>
            <TextInput style={styles.input} placeholder="Avversario" placeholderTextColor={brand.colors.muted} value={avversario} onChangeText={setAvversario} />
            <View style={styles.selettoreRiga}>
              {(["casa", "trasferta"] as const).map((l) => (
                <Pressable key={l} onPress={() => setLuogo(l)} style={[styles.chip, luogo === l && styles.chipAttivo]}>
                  <Text style={[styles.chipTesto, luogo === l && styles.chipTestoAttivo]}>{l === "casa" ? "Casa" : "Trasferta"}</Text>
                </Pressable>
              ))}
              {(["amichevole", "campionato"] as const).map((t) => (
                <Pressable key={t} onPress={() => setTipoGara(t)} style={[styles.chip, tipoGara === t && styles.chipAttivo]}>
                  <Text style={[styles.chipTesto, tipoGara === t && styles.chipTestoAttivo]}>{t === "amichevole" ? "Amichevole" : "Campionato"}</Text>
                </Pressable>
              ))}
            </View>
            {tipoGara === "campionato" && (
              <View style={styles.selettoreRiga}>
                {campionati.length === 0 ? (
                  <Text style={styles.nota}>Nessun campionato configurato — aggiungine uno da Impostazioni, oppure procedi come amichevole.</Text>
                ) : (
                  campionati.map((c) => (
                    <Pressable key={c.id} onPress={() => setCampionatoId(c.id)} style={[styles.chip, campionatoId === c.id && styles.chipAttivo]}>
                      <Text style={[styles.chipTesto, campionatoId === c.id && styles.chipTestoAttivo]}>{c.nome}</Text>
                    </Pressable>
                  ))
                )}
              </View>
            )}
            <Pressable style={styles.bottone} onPress={nuovaPartita} disabled={!avversario.trim()}>
              <Text style={styles.bottoneTesto}>Crea partita (poi convocati e formazione)</Text>
            </Pressable>
          </View>

          <PannelloSporteasy teamId={team!.id} onSincronizzato={carica} />

        </>
      )}

      {andamento.length > 0 && (
        <View style={styles.cardAndamento}>
          <Pressable onPress={() => setMostraAndamento(!mostraAndamento)}>
            <Text style={styles.sottotitoloSezione}>{mostraAndamento ? "▾" : "▸"} Rendimento medio per fondamentale</Text>
          </Pressable>
          {mostraAndamento && andamento.slice(0, 8).map((v, i) => (
            <View key={i} style={styles.rigaAndamento}>
              <Text style={styles.rigaAndamentoTesto}>{v.partita.slice(0, 10)} vs {v.avversario} — {v.fondamentale}</Text>
              <Text style={styles.rigaAndamentoValore}>+{v.punti} / -{v.errori}</Text>
            </View>
          ))}
        </View>
      )}

      {nascoste.length > 0 && (
        <Pressable style={styles.chip} onPress={() => setMostraPassate(!mostraPassate)}>
          <Text style={styles.chipTesto}>{mostraPassate ? "Nascondi le partite passate" : `Mostra le partite passate (${nascoste.length})`}</Text>
        </Pressable>
      )}
          </View>
        }
        refreshControl={<RefreshControl refreshing={caricamento} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListEmptyComponent={!caricamento ? <Text style={styles.vuoto}>Nessuna partita ancora.</Text> : null}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => apriPartita(item)}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.cardTitolo}>vs {item.avversario}</Text>
              <Text style={[styles.badge, item.stato === "in_corso" && styles.badgeInCorso, item.stato === "programmata" && styles.badgeProgrammata]}>
                {item.stato === "programmata" ? "da preparare" : item.stato}
              </Text>
            </View>
            <Text style={styles.cardSotto}>{new Date(item.data).toLocaleDateString("it-IT")} — {item.luogo} — {item.tipo_gara}{item.sporteasy_uid ? " · da SportEasy" : ""}</Text>
            {puoScrivere && (
              <View style={styles.selettoreRiga}>
                {(["casa", "trasferta"] as const).map((l) => (
                  <Pressable key={l} onPress={() => item.luogo !== l && onCambiaLuogo(item.id, l)} style={[styles.chip, item.luogo === l && styles.chipAttivo]}>
                    <Text style={[styles.chipTesto, item.luogo === l && styles.chipTestoAttivo]}>{l === "casa" ? "🏠 Casa" : "🚌 Trasferta"}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {puoScrivere && (
              <Pressable onPress={() => setPickerCampionatoMatchId(pickerCampionatoMatchId === item.id ? null : item.id)}>
                <Text style={styles.linkCampionato}>
                  Campionato: {campionati.find((c) => c.id === item.campionato_id)?.nome ?? "nessuno (amichevole)"} — tocca per cambiare
                </Text>
              </Pressable>
            )}
            {pickerCampionatoMatchId === item.id && (
              <View style={styles.selettoreRiga}>
                <Pressable onPress={() => onScegliCampionato(item.id, null)} style={[styles.chip, !item.campionato_id && styles.chipAttivo]}>
                  <Text style={[styles.chipTesto, !item.campionato_id && styles.chipTestoAttivo]}>Amichevole</Text>
                </Pressable>
                {campionati.map((c) => (
                  <Pressable key={c.id} onPress={() => onScegliCampionato(item.id, c.id)} style={[styles.chip, item.campionato_id === c.id && styles.chipAttivo]}>
                    <Text style={[styles.chipTesto, item.campionato_id === c.id && styles.chipTestoAttivo]}>{c.nome}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {puoScrivere && (
              <Pressable onPress={() => chiediConversioneInAllenamento(item)}>
                <Text style={styles.linkConverti}>È un allenamento — spostalo</Text>
              </Pressable>
            )}
            {item.stato === "conclusa" && <Text style={styles.cardRisultato}>Set: {item.set_vinti_noi} - {item.set_vinti_avversario}</Text>}
            {puoScrivere && item.stato !== "programmata" && (
              <View style={{ flexDirection: "row", gap: 16 }}>
                <Pressable onPress={() => router.push(`/analisi-partita/${item.id}`)}>
                  <Text style={styles.linkCampionato}>📈 Analisi completa</Text>
                </Pressable>
                <Pressable onPress={() => apriRotazioni(item)}>
                  <Text style={styles.linkCampionato}>📊 Rotazioni</Text>
                </Pressable>
              </View>
            )}
            {puoEliminare && item.stato !== "conclusa" && (
              <Pressable onPress={() => apriOspiti(item)} hitSlop={8} style={styles.bottoneOspite}>
                <Text style={styles.bottoneOspiteTesto}>👁 Scout ospite</Text>
              </Pressable>
            )}
            {puoEliminare && (
              <Pressable onPress={() => chiediEliminazione(item)} hitSlop={8} style={styles.bottoneElimina}>
                <Text style={styles.bottoneEliminaTesto}>🗑 Elimina partita</Text>
              </Pressable>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface, padding: 16, gap: 16 },
  form: { gap: 8, backgroundColor: brand.colors.surfaceSecondary, padding: 12, borderRadius: 12 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  nota: { color: brand.colors.muted, fontSize: 12 },
  bottone: { backgroundColor: brand.colors.brand, padding: 10, borderRadius: 8, alignItems: "center", flex: 1 },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  bottoneSecondario: { borderColor: brand.colors.brand, borderWidth: 1, padding: 10, borderRadius: 8, alignItems: "center", flex: 1 },
  bottoneSecondarioTesto: { color: brand.colors.brand, fontWeight: "600" },
  selettoreRiga: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  rigaEspandi: { paddingVertical: 2 },
  rigaEspandiTesto: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "600" },
  erroreTesto: { color: brand.colors.error, fontSize: 12 },
  rigaClassificazione: { color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  tagPartita: { color: brand.colors.brand, fontWeight: "700" },
  tagAllenamento: { color: brand.colors.brandSecondary, fontWeight: "700" },
  cardAndamento: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 12, gap: 6 },
  sottotitoloSezione: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "700" },
  rigaAndamento: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaAndamentoTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12, flex: 1, marginRight: 8 },
  rigaAndamentoValore: { color: brand.colors.brand, fontWeight: "700", fontSize: 12 },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, marginBottom: 10, gap: 2 },
  cardTitolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  cardSotto: { color: brand.colors.muted, fontSize: 13 },
  linkCampionato: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "600", marginTop: 4 },
  linkConverti: { color: brand.colors.muted, fontSize: 11, marginTop: 4 },
  bottoneElimina: { alignSelf: "flex-start", marginTop: 8, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: brand.colors.error },
  bottoneOspite: { alignSelf: "flex-start", marginTop: 8, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: brand.colors.brandSecondary },
  bottoneOspiteTesto: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "600" },
  bottoneEliminaTesto: { color: brand.colors.error, fontSize: 12, fontWeight: "600" },
  cardRisultato: { color: brand.colors.brand, fontWeight: "700", marginTop: 4 },
  badge: { color: brand.colors.muted, fontSize: 12, textTransform: "uppercase" },
  badgeInCorso: { color: brand.colors.warning, fontWeight: "700" },
  badgeProgrammata: { color: brand.colors.brandSecondary, fontWeight: "700" },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 20 },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 18, gap: 10 },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  chiudiPopup: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 6 },
  rigaRotazione: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  rigaRotazioneNome: { color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  rigaRotazioneSaldo: { color: brand.colors.success, fontSize: 12, fontWeight: "700" },
  saldoNegativo: { color: brand.colors.error },
});
