import { useCallback, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, RefreshControl } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { creaAtleta, elencaAtlete, elencaAtleteArchiviate, ripristinaAtleta } from "@/src/services/athletes";
import { FabMenu } from "@/src/components/Fab";
import { PopupForm } from "@/src/components/PopupForm";
import { brand, ruoliCampo } from "@/src/config";
import type { Athlete, RuoloCampo } from "@/src/types/database";
import { avvisa } from "@/src/lib/confermaAzione";
import { MessaggioWhatsApp } from "@/src/components/MessaggioWhatsApp";
import { promemoriaSporteasy } from "@/src/lib/messaggiWhatsApp";
import { TitoloGrande } from "@/src/components/TitoloGrande";

/** Testo dentro l'avatar: il numero di maglia, o le iniziali se manca. */
function testoAvatar(a: Athlete): string {
  if (a.numero_maglia) return String(a.numero_maglia);
  return `${(a.nome ?? "").trim().charAt(0)}${(a.cognome ?? "").trim().charAt(0)}`.toUpperCase();
}

export default function Atlete() {
  const { team, puoScrivere } = useAuth();
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [archiviate, setArchiviate] = useState<Athlete[]>([]);
  const [mostraArchiviate, setMostraArchiviate] = useState(false);
  const [caricamento, setCaricamento] = useState(true);
  const [popupAperto, setPopupAperto] = useState(false);
  const [reminderSporteasy, setReminderSporteasy] = useState(false);
  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [ruoloCampo, setRuoloCampo] = useState<RuoloCampo | null>(null);

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      setAtlete(await elencaAtlete(team.id));
      if (mostraArchiviate) setArchiviate(await elencaAtleteArchiviate(team.id));
    } finally {
      setCaricamento(false);
    }
  }, [team, puoScrivere, mostraArchiviate]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  async function aggiungi() {
    if (!team || !nome.trim() || !cognome.trim()) return;
    await creaAtleta(team.id, { nome: nome.trim(), cognome: cognome.trim(), ruolo_campo: ruoloCampo, numero_maglia: null, data_nascita: null });
    setNome(""); setCognome(""); setRuoloCampo(null); setPopupAperto(false);
    carica();
  }

  async function ripristina(id: string) {
    try { await ripristinaAtleta(id); carica(); } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={atlete}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.contenuto}
        refreshControl={<RefreshControl refreshing={caricamento} onRefresh={carica} tintColor={brand.colors.brand} />}
        ListHeaderComponent={
          <>
            <TitoloGrande
              titolo="Rosa"
              sottotitolo={team ? `${team.nome} · ${atlete.length} ${atlete.length === 1 ? "atleta" : "atlete"}` : undefined}
            />
            {puoScrivere && (
              <Pressable style={styles.bottoneReminder} onPress={() => setReminderSporteasy(true)}>
                <View style={styles.iconaReminder}><Text style={styles.iconaReminderTesto}>💬</Text></View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={styles.bottoneReminderTitolo}>Promemoria SportEasy</Text>
                  <Text style={styles.bottoneReminderSotto}>Ricorda alle atlete di aggiornare la scheda su SportEasy</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            )}
            {puoScrivere && (
              <Pressable style={styles.rigaEspandi} onPress={() => setMostraArchiviate(!mostraArchiviate)}>
                <Text style={styles.rigaEspandiTesto}>{mostraArchiviate ? "▾" : "▸"} Rosa archiviate ({archiviate.length})</Text>
              </Pressable>
            )}
            {mostraArchiviate && archiviate.length > 0 && (
              <View style={[styles.scheda, { marginBottom: 16 }]}>
                {archiviate.map((a, i) => (
                  <View key={a.id}>
                    {i > 0 && <View style={styles.separatore} />}
                    <View style={styles.rigaArchiviata}>
                      <View style={[styles.avatar, styles.avatarSpento]}><Text style={[styles.avatarTesto, { color: brand.colors.muted }]}>{testoAvatar(a)}</Text></View>
                      <Text style={[styles.rigaNome, { flex: 1 }]} numberOfLines={1}>{a.nome} {a.cognome}</Text>
                      <Pressable onPress={() => ripristina(a.id)} style={styles.bottoneRipristina}>
                        <Text style={styles.bottoneRipristinaTesto}>Ripristina</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        }
        ListEmptyComponent={!caricamento ? <Text style={styles.vuoto}>Nessuna atleta ancora. Usa il pulsante + qui sotto.</Text> : null}
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.rigaContenitore,
              index === 0 && styles.rigaPrima,
              index === atlete.length - 1 && styles.rigaUltima,
            ]}
          >
            {index > 0 && <View style={styles.separatore} />}
            <Pressable style={styles.riga} onPress={() => router.push(`/atleta/${item.id}`)}>
              <View style={styles.avatar}><Text style={styles.avatarTesto}>{testoAvatar(item)}</Text></View>
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={styles.rigaNome} numberOfLines={1}>{item.nome} {item.cognome}</Text>
                {!!item.ruolo_campo && <Text style={styles.rigaSotto}>{item.ruolo_campo}{item.numero_maglia ? ` — n. ${item.numero_maglia}` : ""}</Text>}
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </View>
        )}
      />

      {puoScrivere && (
        <FabMenu
          titolo="Aggiungi alla rosa"
          voci={[
            { icona: "✍️", etichetta: "Una atleta a mano", descrizione: "Scrivi nome, cognome e ruolo", onPress: () => setPopupAperto(true) },
            { icona: "📄", etichetta: "Importa la rosa da un file", descrizione: "Carichi l'elenco e le atlete entrano tutte insieme", onPress: () => router.push("/importa-atlete") },
          ]}
        />
      )}

      {reminderSporteasy && team && (
        <MessaggioWhatsApp
          visibile
          titolo="Promemoria SportEasy"
          nota="Si apre WhatsApp col messaggio pronto: scegli il gruppo della squadra e premi invia. Puoi modificare il testo qui sopra."
          modelli={[{ etichetta: "SportEasy", testo: promemoriaSporteasy(team.nome) }]}
          onChiudi={() => setReminderSporteasy(false)}
        />
      )}

      <PopupForm visibile={popupAperto} titolo="Nuova atleta" haModifiche={!!(nome.trim() || cognome.trim())} onChiudi={() => { setPopupAperto(false); setNome(""); setCognome(""); setRuoloCampo(null); }}>
        <TextInput style={styles.input} placeholder="Nome" placeholderTextColor={brand.colors.muted} value={nome} onChangeText={setNome} autoFocus />
        <TextInput style={styles.input} placeholder="Cognome" placeholderTextColor={brand.colors.muted} value={cognome} onChangeText={setCognome} />
        <Text style={styles.etichettaCampo}>Ruolo in campo</Text>
        <View style={styles.selettoreRiga}>
          {ruoliCampo.map((r) => (
            <Pressable key={r} onPress={() => setRuoloCampo(r)} style={[styles.chip, ruoloCampo === r && styles.chipAttivo]}>
              <Text style={[styles.chipTesto, ruoloCampo === r && styles.chipTestoAttivo]}>{r}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.bottone} onPress={aggiungi} disabled={!nome.trim() || !cognome.trim()}>
          <Text style={styles.bottoneTesto}>Aggiungi atleta</Text>
        </Pressable>
      </PopupForm>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  contenuto: { padding: 16, paddingBottom: 100, width: "100%", maxWidth: 900, alignSelf: "center" },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 44, fontSize: 16 },
  etichettaCampo: { color: brand.colors.muted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 2 },
  bottone: { backgroundColor: brand.colors.brand, paddingVertical: 12, paddingHorizontal: 20, minHeight: 44, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
  scheda: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, overflow: "hidden" },
  rigaContenitore: { backgroundColor: brand.colors.surfaceSecondary },
  rigaPrima: { borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: "hidden" },
  rigaUltima: { borderBottomLeftRadius: 18, borderBottomRightRadius: 18, overflow: "hidden" },
  separatore: { height: 1, backgroundColor: brand.colors.border, marginLeft: 72 },
  riga: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 14, minHeight: 60 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  avatarSpento: { opacity: 0.7 },
  avatarTesto: { color: brand.colors.brand, fontSize: 17, fontWeight: "700" },
  rigaNome: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  rigaSotto: { color: brand.colors.muted, fontSize: 13 },
  chevron: { color: brand.colors.muted, fontSize: 24, fontWeight: "600" },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  bottoneReminder: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: brand.colors.surfaceSecondary, borderWidth: 1, borderColor: brand.colors.border, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8, minHeight: 60 },
  iconaReminder: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(50,173,230,0.16)", alignItems: "center", justifyContent: "center" },
  iconaReminderTesto: { fontSize: 18 },
  bottoneReminderTitolo: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "600" },
  bottoneReminderSotto: { color: brand.colors.muted, fontSize: 12.5 },
  rigaEspandi: { minHeight: 44, justifyContent: "center", marginBottom: 4 },
  rigaEspandiTesto: { color: brand.colors.brandSecondary, fontSize: 14, fontWeight: "600" },
  rigaArchiviata: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 14, minHeight: 60 },
  bottoneRipristina: { backgroundColor: brand.colors.surfaceTertiary, borderRadius: 999, minHeight: 44, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  bottoneRipristinaTesto: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "600" },
  selettoreRiga: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, minHeight: 44, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14, fontWeight: "600" },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
});
