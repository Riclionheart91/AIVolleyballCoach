import { useEffect, useState, type ComponentProps } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/src/context/AuthContext";
import { elencaAtlete, aggiornaMioContatto } from "@/src/services/athletes";
import { brand, etichetteRuolo } from "@/src/config";
import type { Athlete } from "@/src/types/database";
import { avvisa } from "@/src/lib/confermaAzione";
import { TitoloGrande } from "@/src/components/TitoloGrande";

type NomeIcona = ComponentProps<typeof Ionicons>["name"];

interface VoceElenco {
  chiave: string;
  icona: NomeIcona;
  colore: string;
  testo: string;
  vai: () => void;
}

/** Elenco raggruppato: righe dentro un'unica scheda con icona in quadratino colorato, testo e chevron. */
function GruppoVoci({ titolo, voci }: { titolo: string; voci: VoceElenco[] }) {
  return (
    <View style={styles.sezione}>
      <Text style={styles.titoloGruppo}>{titolo}</Text>
      <View style={styles.schedaElenco}>
        {voci.map((v, i) => (
          <View key={v.chiave}>
            {i > 0 && <View style={styles.separatore} />}
            <Pressable style={styles.voce} onPress={v.vai} accessibilityRole="button">
              <View style={[styles.iconaQuadrata, { backgroundColor: v.colore }]}>
                <Ionicons name={v.icona} size={18} color="#000" />
              </View>
              <Text style={styles.voceTesto}>{v.testo}</Text>
              <Ionicons name="chevron-forward" size={16} color={brand.colors.muted} />
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function Profilo() {
  const { session, team, ruolo, atletaId, puoScrivere, isSuperuser, societaPresidenza, esci } = useAuth();
  const [mieDati, setMieDati] = useState<Athlete | null>(null);
  const [telefono, setTelefono] = useState("");
  const [emailContatto, setEmailContatto] = useState("");
  const [notePersonali, setNotePersonali] = useState("");
  const [salvataggio, setSalvataggio] = useState(false);

  useEffect(() => {
    if (!team || !atletaId) return;
    elencaAtlete(team.id).then((lista) => {
      const io = lista.find((a) => a.id === atletaId) ?? null;
      setMieDati(io);
      setTelefono(io?.telefono ?? "");
      setEmailContatto(io?.email_contatto ?? "");
      setNotePersonali(io?.note_personali ?? "");
    });
  }, [team, atletaId]);

  async function salvaContatti() {
    if (!team) return;
    setSalvataggio(true);
    try {
      await aggiornaMioContatto(team.id, telefono.trim(), emailContatto.trim(), notePersonali.trim());
      avvisa("Salvato", "I tuoi dati di contatto sono stati aggiornati.");
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setSalvataggio(false);
    }
  }

  async function onEsci() {
    await esci();
    router.replace("/login");
  }

  // Nome da mostrare: quello dell'account Google; se non c'è, quello dell'anagrafica (la scheda atleta collegata);
  // solo in ultimo la mail, perché lo schermo non resti senza nome.
  const metaGoogle = (session?.user.user_metadata ?? {}) as { full_name?: string; name?: string; given_name?: string; family_name?: string };
  const nomeGoogle = (metaGoogle.full_name || metaGoogle.name || [metaGoogle.given_name, metaGoogle.family_name].filter(Boolean).join(" ") || "").trim();
  const nomeAnagrafica = mieDati ? `${mieDati.nome ?? ""} ${mieDati.cognome ?? ""}`.trim() : "";
  const nomeVisualizzato = nomeGoogle || nomeAnagrafica || session?.user.email || "—";
  const paroleNome = (nomeGoogle || nomeAnagrafica).split(/\s+/).filter(Boolean);
  const iniziali = paroleNome.length > 0
    ? `${paroleNome[0].charAt(0)}${paroleNome.length > 1 ? paroleNome[paroleNome.length - 1].charAt(0) : ""}`.toUpperCase()
    : ((session?.user.email ?? "?").replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "?");

  const vociSquadra: VoceElenco[] = puoScrivere ? [
    { chiave: "gestione", icona: "people-outline", colore: brand.colors.brand, testo: "Gestione squadra e accessi", vai: () => router.push("/gestione-squadra") },
    { chiave: "pianificazione", icona: "calendar-outline", colore: brand.colors.brandSecondary, testo: "Pianificazione annuale (cicli)", vai: () => router.push("/pianificazione-annuale") },
    { chiave: "individuali", icona: "locate-outline", colore: brand.colors.success, testo: "Esercizi individuali (piani e gruppi)", vai: () => router.push("/esercizi-individuali") },
    { chiave: "tempo-di-gioco", icona: "time-outline", colore: brand.colors.warning, testo: "Tempo di gioco delle atlete", vai: () => router.push("/tempo-di-gioco") },
    { chiave: "campionati", icona: "trophy-outline", colore: brand.colors.warning, testo: "Campionati", vai: () => router.push("/campionati") },
  ] : [];

  const vociGioco: VoceElenco[] = [];
  if (team) vociGioco.push({ chiave: "schemi", icona: "football-outline", colore: brand.colors.brand, testo: "Schemi di gioco (ricezione, difesa)", vai: () => router.push("/schemi-gioco") });

  const vociSocieta: VoceElenco[] = societaPresidenza ? [
    { chiave: "societa", icona: "business-outline", colore: brand.colors.brandSecondary, testo: `Gestione società (${societaPresidenza.nome})`, vai: () => router.push("/gestione-societa") },
    { chiave: "rubrica", icona: "document-text-outline", colore: brand.colors.muted, testo: "Rubrica staff", vai: () => router.push("/rubrica-staff") },
  ] : [];

  const vociAdmin: VoceElenco[] = isSuperuser ? [
    { chiave: "crea-societa", icona: "add-circle-outline", colore: brand.colors.brand, testo: "Crea società", vai: () => router.push("/crea-societa") },
    { chiave: "visione", icona: "eye-outline", colore: brand.colors.brandSecondary, testo: "Presidenti che giocano: visione analisi", vai: () => router.push("/visione-analisi-presidenti") },
  ] : [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contenuto}>
      <TitoloGrande titolo="Profilo" />

      <View style={styles.schedaUtente}>
        <View style={styles.avatar}>
          <Text style={styles.avatarTesto}>{iniziali}</Text>
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={styles.valore} numberOfLines={1}>{nomeVisualizzato}</Text>
          <Text style={styles.sottotitolo} numberOfLines={2}>
            {team?.nome ?? "—"} · {ruolo ? etichetteRuolo[ruolo] : "—"}
          </Text>
        </View>
      </View>

      {ruolo === "atleta" && (
        <View style={styles.card}>
          <Text style={styles.label}>La mia scheda</Text>
          <Text style={styles.valore}>
            {mieDati ? `${mieDati.nome} ${mieDati.cognome}` : "—"}
            {mieDati?.ruolo_campo ? ` — ${mieDati.ruolo_campo}` : ""}
          </Text>
          <Text style={styles.nota}>Nome, cognome, ruolo in campo e numero maglia sono gestiti dall'allenatore. Puoi aggiornare solo i tuoi contatti qui sotto.</Text>

          <TextInput style={styles.input} placeholder="Telefono" placeholderTextColor={brand.colors.muted} keyboardType="phone-pad" value={telefono} onChangeText={setTelefono} />
          <TextInput style={styles.input} placeholder="Email di contatto (se diversa da quella di accesso)" placeholderTextColor={brand.colors.muted} autoCapitalize="none" keyboardType="email-address" value={emailContatto} onChangeText={setEmailContatto} />
          <TextInput style={[styles.input, { minHeight: 70 }]} placeholder="Note personali (es. allergie, disponibilità)" placeholderTextColor={brand.colors.muted} multiline value={notePersonali} onChangeText={setNotePersonali} />
          <Pressable style={styles.bottone} onPress={salvaContatti} disabled={salvataggio}>
            <Text style={styles.bottoneTesto}>{salvataggio ? "Salvataggio…" : "Salva contatti"}</Text>
          </Pressable>
        </View>
      )}

      {ruolo === "presidente" && (
        <View style={styles.card}>
          <Text style={styles.nota}>Il tuo accesso è in sola lettura su tutti i dati della squadra. Trovi l'andamento aggregato nella tab Valutazioni.</Text>
        </View>
      )}

      {vociSquadra.length > 0 && <GruppoVoci titolo="Squadra" voci={vociSquadra} />}
      {vociGioco.length > 0 && <GruppoVoci titolo="Gioco" voci={vociGioco} />}
      {vociSocieta.length > 0 && <GruppoVoci titolo="Società" voci={vociSocieta} />}
      {vociAdmin.length > 0 && <GruppoVoci titolo="Amministrazione piattaforma" voci={vociAdmin} />}

      <View style={styles.sezione}>
        <Text style={styles.titoloGruppo}>Sistema</Text>
        <View style={styles.schedaElenco}>
          {(puoScrivere || isSuperuser) && (
            <>
              <Pressable style={styles.voce} onPress={() => router.push("/impostazioni")} accessibilityRole="button">
                <View style={[styles.iconaQuadrata, { backgroundColor: brand.colors.muted }]}>
                  <Ionicons name="settings-outline" size={18} color="#000" />
                </View>
                <Text style={styles.voceTesto}>Impostazioni</Text>
                <Ionicons name="chevron-forward" size={16} color={brand.colors.muted} />
              </Pressable>
              <View style={styles.separatore} />
            </>
          )}
          <Pressable style={styles.voce} onPress={onEsci} accessibilityRole="button">
            <Text style={styles.esciTesto}>Esci</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  contenuto: { padding: 16, paddingBottom: 48, gap: 18, width: "100%", maxWidth: 900, alignSelf: "center" },
  schedaUtente: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  avatarTesto: { color: brand.colors.brand, fontSize: 20, fontWeight: "800" },
  sottotitolo: { color: brand.colors.muted, fontSize: 14 },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 16, gap: 6 },
  sezione: { gap: 6 },
  titoloGruppo: { color: brand.colors.muted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, paddingLeft: 4 },
  schedaElenco: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, overflow: "hidden" },
  voce: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 14, minHeight: 52 },
  iconaQuadrata: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  voceTesto: { flex: 1, color: brand.colors.onSurface, fontSize: 16, fontWeight: "500" },
  separatore: { height: 1, backgroundColor: brand.colors.border, marginLeft: 58 },
  esciTesto: { flex: 1, color: brand.colors.error, fontSize: 16, fontWeight: "600" },
  label: { color: brand.colors.muted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 2 },
  valore: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  nota: { color: brand.colors.muted, fontSize: 13 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, minHeight: 44, marginTop: 8 },
  bottone: { backgroundColor: brand.colors.brand, paddingHorizontal: 18, minHeight: 44, justifyContent: "center", borderRadius: 999, alignItems: "center", marginTop: 8 },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 15 },
});
