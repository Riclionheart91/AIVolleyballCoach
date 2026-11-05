import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Modal } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaMembri, cambiaRuoloMembro, impostaPermessoScout, rimuoviMembro, RUOLI_CON_SCOUT, type MembroTeam } from "@/src/services/membri";
import { annullaInvito, annullaInvitoLink, creaInvitoLink, elencaInvitiLink, elencaInvitiPendenti, linkInvito, type InvitoLink, type RuoloStaff, type TeamInvite } from "@/src/services/teamInvites";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { brand, etichetteRuolo } from "@/src/config";
import { MessaggioWhatsApp } from "@/src/components/MessaggioWhatsApp";
import { TitoloGrande } from "@/src/components/TitoloGrande";
import { invitoStaffLink, invitoStaffPassword } from "@/src/lib/messaggiWhatsApp";
import { creaLinkAccessoStaff, linkAccesso, type MetodoAccesso } from "@/src/services/accessi";
import type { Athlete, Ruolo } from "@/src/types/database";
import { Ionicons } from "@expo/vector-icons";

const RUOLI_COLLABORATORE: Ruolo[] = ["allenatore", "vice_allenatore"];

/**
 * Gestione della squadra: chi ha accesso e con quale profilo.
 * Qui ci sono solo i collaboratori (allenatori e vice), che si invitano con un link su WhatsApp.
 * Le atlete si invitano dalla loro scheda (Rosa → atleta → "Accesso all'app"): un solo punto.
 */
export default function GestioneSquadra() {
  const { team } = useAuth();
  const [whatsappStaff, setWhatsappStaff] = useState<{ token: string; ruolo: RuoloStaff; modo: MetodoAccesso; email?: string } | null>(null);
  const [metodoStaff, setMetodoStaff] = useState<MetodoAccesso>("google");
  const [emailStaff, setEmailStaff] = useState("");
  const [invitiLink, setInvitiLink] = useState<InvitoLink[]>([]);
  const [membri, setMembri] = useState<MembroTeam[]>([]);
  const [inviti, setInviti] = useState<TeamInvite[]>([]);
  const [caricamento, setCaricamento] = useState(true);

  const [ruoloNuovo, setRuoloNuovo] = useState<RuoloStaff>("vice_allenatore");

  const [membroInModifica, setMembroInModifica] = useState<MembroTeam | null>(null);

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      const [m, i, l] = await Promise.all([
        elencaMembri(team.id).catch(() => []),
        elencaInvitiPendenti(team.id).catch(() => []),
        elencaInvitiLink(team.id).catch(() => []),
      ]);
      setMembri(m); setInviti(i); setInvitiLink(l);
    } finally {
      setCaricamento(false);
    }
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  const collaboratori = membri.filter((m) => m.ruolo !== "atleta");

  /** Crea il link per il ruolo scelto e apre subito WhatsApp col messaggio pronto: il contatto si sceglie li'. */
  async function creaLinkStaff() {
    if (!team) return;
    try {
      if (metodoStaff === "password") {
        // Email e password: l'email e' facoltativa; se manca la sceglie la persona quando apre il link.
        const email = emailStaff.trim();
        const token = await creaLinkAccessoStaff(team.id, ruoloNuovo, email || undefined);
        carica();
        setWhatsappStaff({ token, ruolo: ruoloNuovo, modo: "password", email: email || undefined });
        setEmailStaff("");
        return;
      }
      const token = await creaInvitoLink(team.id, ruoloNuovo);
      carica();
      setWhatsappStaff({ token, ruolo: ruoloNuovo, modo: "google" });
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  async function applicaCambioRuolo(m: MembroTeam, nuovo: Ruolo) {
    if (!team) return;
    try {
      await cambiaRuoloMembro(team.id, m.user_id, nuovo, nuovo === "atleta" ? m.atleta_id : null);
      setMembroInModifica(null);
      carica();
    } catch (e) { avvisa("Cambio non riuscito", (e as Error).message); }
  }

  function chiediRimozione(m: MembroTeam) {
    confermaAzione("Rimuovere dalla squadra?", `${m.email} perderà l'accesso. I dati registrati restano.`, "Rimuovi", async () => {
      if (!team) return;
      try { await rimuoviMembro(team.id, m.user_id); setMembroInModifica(null); carica(); }
      catch (e) { avvisa("Errore", (e as Error).message); }
    }, true);
  }

  if (caricamento) return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.indietroArea}><Text style={styles.indietro}>← Profilo</Text></Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.contenuto}>
        <TitoloGrande titolo="Gestione squadra" />
        <View style={styles.card}>
          <Text style={styles.sezione}>Collaboratori ({collaboratori.length})</Text>
          {collaboratori.map((m) => (
            <Pressable key={m.user_id} style={styles.riga} onPress={() => setMembroInModifica(m)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rigaTitolo}>{m.email}</Text>
                <Text style={styles.rigaSotto}>{etichetteRuolo[m.ruolo] ?? m.ruolo}{m.puo_scoutare ? " · scout" : ""}</Text>
              </View>
              <Text style={styles.freccia}>›</Text>
            </Pressable>
          ))}

          <Text style={styles.etichetta}>Invita un collaboratore</Text>
          <View style={styles.chipRiga}>
            {RUOLI_COLLABORATORE.map((r) => (
              <Pressable key={r} onPress={() => setRuoloNuovo(r as RuoloStaff)} style={[styles.chip, ruoloNuovo === r && styles.chipAttivo]}>
                <Text style={[styles.chipTesto, ruoloNuovo === r && styles.chipTestoAttivo]}>{etichetteRuolo[r] ?? r}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.etichetta}>Come accede</Text>
          <View style={styles.chipRiga}>
            {([["google", "Account Google"], ["password", "Email e password"]] as [MetodoAccesso, string][]).map(([m, et]) => (
              <Pressable key={m} onPress={() => setMetodoStaff(m)} style={[styles.chip, metodoStaff === m && styles.chipAttivo]}>
                <Text style={[styles.chipTesto, metodoStaff === m && styles.chipTestoAttivo]}>{et}</Text>
              </Pressable>
            ))}
          </View>
          {metodoStaff === "password" && (
            <TextInput
              style={styles.input}
              placeholder="Email (facoltativa): se la scrivi sarà quella di accesso"
              placeholderTextColor={brand.colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={emailStaff}
              onChangeText={setEmailStaff}
            />
          )}
          <Text style={styles.nota}>
            {metodoStaff === "google"
              ? "Scegli il ruolo e crea il link: si apre WhatsApp e scegli tu a chi mandarlo. Chi lo apre accede con il suo account Google ed entra in squadra con quel ruolo. Il link vale per una persona e scade dopo 7 giorni."
              : "Scegli il ruolo e crea il link: si apre WhatsApp e scegli tu a chi mandarlo. Chi lo apre sceglie la password e entra con l'email indicata (se l'hai lasciata vuota, la sceglie lui). Il link vale per una persona e scade dopo 7 giorni."}
            {" "}Il permesso di registrare lo scouting si assegna dopo, toccando la persona nell'elenco qui sopra.
          </Text>
          <Pressable style={styles.bottone} onPress={creaLinkStaff}>
            <Text style={styles.bottoneTesto}>💬 Crea il link e invia su WhatsApp</Text>
          </Pressable>
        </View>

        {(invitiLink.length > 0 || inviti.filter((i) => !i.atleta_id).length > 0) && (
          <View style={styles.card}>
            <Text style={styles.sezione}>Inviti staff in attesa</Text>
            {invitiLink.map((l) => (
              <View key={l.id} style={styles.riga}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rigaTitolo}>Link per {(etichetteRuolo[l.ruolo] ?? l.ruolo).toLowerCase()}</Text>
                  <Text style={styles.rigaSotto}>scade il {new Date(l.scade_il).toLocaleDateString("it-IT")}</Text>
                </View>
                <Pressable style={styles.chipScout} onPress={() => setWhatsappStaff({ token: l.token, ruolo: l.ruolo, modo: "google" })} hitSlop={6} accessibilityLabel="Rimanda su WhatsApp">
                  <Text style={styles.chipScoutTesto}>💬</Text>
                </Pressable>
                <Pressable onPress={async () => { await annullaInvitoLink(l.id); carica(); }} hitSlop={8}>
                  <Text style={styles.azioneAnnulla}>Annulla</Text>
                </Pressable>
              </View>
            ))}
            {inviti.filter((i) => !i.atleta_id).map((i) => (
              <View key={i.id} style={styles.riga}>
                <Text style={styles.rigaTitolo}>{i.email} — {etichetteRuolo[i.ruolo] ?? i.ruolo} (invito via email)</Text>
                <Pressable onPress={async () => { await annullaInvito(i.id); carica(); }} hitSlop={8}>
                  <Text style={styles.azioneAnnulla}>Annulla</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {team && whatsappStaff && (
        <MessaggioWhatsApp
          visibile
          titolo="Invito staff su WhatsApp"
          nota="Si apre WhatsApp col messaggio e il link pronti: scegli tu la persona a cui mandarlo e premi invia."
          modelli={[{
            etichetta: "Invito",
            testo: whatsappStaff.modo === "password"
              ? invitoStaffPassword(team.nome, (etichetteRuolo[whatsappStaff.ruolo] ?? whatsappStaff.ruolo).toLowerCase(), linkAccesso(whatsappStaff.token), whatsappStaff.email)
              : invitoStaffLink(team.nome, (etichetteRuolo[whatsappStaff.ruolo] ?? whatsappStaff.ruolo).toLowerCase(), linkInvito(whatsappStaff.token)),
          }]}
          onChiudi={() => setWhatsappStaff(null)}
        />
      )}

      <Modal visible={!!membroInModifica} animationType="fade" transparent onRequestClose={() => setMembroInModifica(null)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>{membroInModifica?.email}</Text>
            <Text style={styles.nota}>Profilo attuale: {membroInModifica ? (etichetteRuolo[membroInModifica.ruolo] ?? membroInModifica.ruolo) : ""}</Text>
            <Text style={styles.etichetta}>Cambia profilo</Text>
            <View style={styles.chipRiga}>
              {RUOLI_COLLABORATORE.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => membroInModifica && applicaCambioRuolo(membroInModifica, r)}
                  style={[styles.chip, membroInModifica?.ruolo === r && styles.chipAttivo]}
                >
                  <Text style={[styles.chipTesto, membroInModifica?.ruolo === r && styles.chipTestoAttivo]}>{etichetteRuolo[r] ?? r}</Text>
                </Pressable>
              ))}
            </View>
            {membroInModifica && RUOLI_CON_SCOUT.includes(membroInModifica.ruolo) ? (
              <Pressable
                style={styles.rigaPermesso}
                onPress={async () => {
                  if (!team || !membroInModifica) return;
                  try {
                    await impostaPermessoScout(team.id, membroInModifica.user_id, !membroInModifica.puo_scoutare);
                    setMembroInModifica({ ...membroInModifica, puo_scoutare: !membroInModifica.puo_scoutare });
                    carica();
                  } catch (e) { avvisa("Errore", (e as Error).message); }
                }}
              >
                <View style={[styles.quadratino, membroInModifica.puo_scoutare && styles.quadratinoAttivo]}>
                  {membroInModifica.puo_scoutare && <Text style={styles.spunta}>✓</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.testoPermesso}>Può registrare lo scouting</Text>
                  <Text style={styles.nota}>Registra le azioni durante il set, le annulla e fa i cambi. Non avvia set né chiude la partita.</Text>
                </View>
              </Pressable>
            ) : (
              <Text style={styles.nota}>
                Il permesso scout non è disponibile per questo profilo.
              </Text>
            )}

            <Pressable style={styles.bottoneDistruttivo} onPress={() => membroInModifica && chiediRimozione(membroInModifica)}>
              <Ionicons name="trash-outline" size={16} color={brand.colors.error} />
              <Text style={styles.bottoneDistruttivoTesto}>Rimuovi dalla squadra</Text>
            </Pressable>
            <Pressable onPress={() => setMembroInModifica(null)}><Text style={styles.chiudi}>Chiudi</Text></Pressable>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8 },
  indietroArea: { minHeight: 44, justifyContent: "center" },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  contenuto: { padding: 16, paddingBottom: 60, gap: 16, width: "100%", maxWidth: 900, alignSelf: "center" },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 16, gap: 10 },
  sezione: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700" },
  etichetta: { color: brand.colors.muted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 4 },
  nota: { color: brand.colors.muted, fontSize: 13, lineHeight: 18 },
  riga: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: brand.colors.border, minHeight: 56 },
  rigaTitolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "600" },
  rigaSotto: { color: brand.colors.muted, fontSize: 14, marginTop: 2 },
  freccia: { color: brand.colors.muted, fontSize: 20, fontWeight: "700" },
  statoOk: { color: brand.colors.success, fontSize: 18, fontWeight: "800" },
  azioneAnnulla: { color: brand.colors.error, fontSize: 13, fontWeight: "600", paddingVertical: 12 },
  bottonePiccolo: { backgroundColor: brand.colors.brand, minHeight: 36, justifyContent: "center", paddingHorizontal: 16, borderRadius: 999 },
  bottonePiccoloTesto: { color: "#000", fontWeight: "700", fontSize: 14 },
  chipScout: { backgroundColor: brand.colors.surfaceTertiary, minHeight: 36, minWidth: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderRadius: 999 },
  chipScoutAttivo: { backgroundColor: brand.colors.brandSecondary },
  chipScoutTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  chipScoutTestoAttivo: { color: "#000" },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, minHeight: 44 },
  chipRiga: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { minHeight: 36, justifyContent: "center", paddingHorizontal: 16, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  rigaPermesso: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 8 },
  quadratino: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: brand.colors.brand, alignItems: "center", justifyContent: "center", marginTop: 2 },
  quadratinoAttivo: { backgroundColor: brand.colors.brand },
  spunta: { color: "#000", fontWeight: "800", fontSize: 12 },
  testoPermesso: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "600" },
  bottone: { backgroundColor: brand.colors.brand, minHeight: 42, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  bottoneDistruttivo: { flexDirection: "row", gap: 6, backgroundColor: brand.colors.surfaceTertiary, minHeight: 36, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  bottoneDistruttivoTesto: { color: brand.colors.error, fontWeight: "700" },
  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 20, gap: 10, width: "100%", maxWidth: 480, alignSelf: "center" },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 18, fontWeight: "700" },
  chiudi: { color: brand.colors.muted, fontSize: 15, textAlign: "center", paddingVertical: 12 },
});
