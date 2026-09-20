import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Modal } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { elencaMembri, cambiaRuoloMembro, impostaPermessoScout, rimuoviMembro, RUOLI_CON_SCOUT, type MembroTeam } from "@/src/services/membri";
import { annullaInvito, elencaInvitiPendenti, invitaMembro, type TeamInvite } from "@/src/services/teamInvites";
import { aggiornaAtleta, elencaAtlete } from "@/src/services/athletes";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { brand, etichetteRuolo } from "@/src/config";
import type { Athlete, Ruolo } from "@/src/types/database";

const RUOLI_COLLABORATORE: Ruolo[] = ["allenatore", "vice_allenatore", "presidente"];

/**
 * Gestione della squadra: chi ha accesso e con quale profilo.
 * Separata in due parti perché rispondono a bisogni diversi —
 * i collaboratori si invitano per email, mentre la rosa esistono già
 * in anagrafica e vanno solo collegate a un account.
 */
export default function GestioneSquadra() {
  const { team } = useAuth();
  const [membri, setMembri] = useState<MembroTeam[]>([]);
  const [inviti, setInviti] = useState<TeamInvite[]>([]);
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [caricamento, setCaricamento] = useState(true);

  const [emailNuovo, setEmailNuovo] = useState("");
  const [ruoloNuovo, setRuoloNuovo] = useState<Ruolo>("vice_allenatore");

  const [membroInModifica, setMembroInModifica] = useState<MembroTeam | null>(null);
  const [atletaPerEmail, setAtletaPerEmail] = useState<Athlete | null>(null);
  const [emailAtleta, setEmailAtleta] = useState("");

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      const [m, i, a] = await Promise.all([
        elencaMembri(team.id).catch(() => []),
        elencaInvitiPendenti(team.id).catch(() => []),
        elencaAtlete(team.id).catch(() => []),
      ]);
      setMembri(m); setInviti(i); setAtlete(a);
    } finally {
      setCaricamento(false);
    }
  }, [team]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  const collaboratori = membri.filter((m) => m.ruolo !== "atleta");
  const atleteCollegate = new Set(membri.filter((m) => m.atleta_id).map((m) => m.atleta_id!));
  const invitiPerAtleta = new Map(inviti.filter((i) => i.atleta_id).map((i) => [i.atleta_id!, i]));

  async function invitaCollaboratore() {
    if (!team || !emailNuovo.trim()) return;
    try {
      await invitaMembro(team.id, emailNuovo.trim(), ruoloNuovo, null);
      setEmailNuovo("");
      carica();
      avvisa("Invito creato", "Al primo accesso con Google entrerà nella squadra con il profilo scelto.");
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  /** L'atleta ha già l'email in anagrafica: si invita con un tocco, senza ridigitarla. */
  async function invitaAtleta(a: Athlete, email: string) {
    if (!team) return;
    try {
      await invitaMembro(team.id, email, "atleta", a.id);
      carica();
      avvisa("Invito creato", `${a.nome} entrerà come atleta al primo accesso con ${email}.`);
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  /** Se l'email manca, la si aggiunge in anagrafica e si invita di seguito: due passaggi in uno. */
  async function salvaEmailEInvita() {
    if (!atletaPerEmail || !emailAtleta.trim()) return;
    try {
      await aggiornaAtleta(atletaPerEmail.id, { email_contatto: emailAtleta.trim() });
      await invitaAtleta(atletaPerEmail, emailAtleta.trim());
      setAtletaPerEmail(null); setEmailAtleta("");
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
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← Profilo</Text></Pressable>
        <Text style={styles.titolo}>Gestione squadra</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}>
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
          <TextInput
            style={styles.input}
            placeholder="Email Google"
            placeholderTextColor={brand.colors.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={emailNuovo}
            onChangeText={setEmailNuovo}
          />
          <View style={styles.chipRiga}>
            {RUOLI_COLLABORATORE.map((r) => (
              <Pressable key={r} onPress={() => setRuoloNuovo(r)} style={[styles.chip, ruoloNuovo === r && styles.chipAttivo]}>
                <Text style={[styles.chipTesto, ruoloNuovo === r && styles.chipTestoAttivo]}>{etichetteRuolo[r] ?? r}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.nota}>
            Il permesso di registrare lo scouting si assegna dopo, toccando la persona nell'elenco qui sopra: vale solo per allenatore e vice.
          </Text>
          <Pressable style={styles.bottone} onPress={invitaCollaboratore} disabled={!emailNuovo.trim()}>
            <Text style={styles.bottoneTesto}>Invia invito</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sezione}>Rosa ({atlete.length})</Text>
          <Text style={styles.nota}>Un tocco invia l'invito se l'email è già in anagrafica; altrimenti la chiede e la salva.</Text>
          {atlete.map((a) => {
            const collegata = atleteCollegate.has(a.id);
            const invitata = invitiPerAtleta.get(a.id);
            const haEmail = !!a.email_contatto?.trim();
            return (
              <View key={a.id} style={styles.riga}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rigaTitolo}>{a.numero_maglia ? `#${a.numero_maglia} ` : ""}{a.nome} {a.cognome}</Text>
                  <Text style={styles.rigaSotto}>
                    {collegata ? "account collegato" : invitata ? `invito inviato a ${invitata.email}` : haEmail ? a.email_contatto : "nessuna email in anagrafica"}
                  </Text>
                </View>
                {collegata ? (
                  <Pressable
                    onPress={() => {
                      const m = membri.find((x) => x.atleta_id === a.id);
                      if (m) chiediRimozione(m);
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.azioneAnnulla}>Revoca accesso</Text>
                  </Pressable>
                ) : invitata ? (
                  <Pressable onPress={async () => { await annullaInvito(invitata.id); carica(); }} hitSlop={8}>
                    <Text style={styles.azioneAnnulla}>Annulla</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={styles.bottonePiccolo}
                    onPress={() => {
                      if (haEmail) invitaAtleta(a, a.email_contatto!.trim());
                      else { setAtletaPerEmail(a); setEmailAtleta(""); }
                    }}
                  >
                    <Text style={styles.bottonePiccoloTesto}>{haEmail ? "Invita" : "+ Email"}</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>

        {inviti.filter((i) => !i.atleta_id).length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sezione}>Inviti in attesa</Text>
            {inviti.filter((i) => !i.atleta_id).map((i) => (
              <View key={i.id} style={styles.riga}>
                <Text style={styles.rigaTitolo}>{i.email} — {etichetteRuolo[i.ruolo] ?? i.ruolo}</Text>
                <Pressable onPress={async () => { await annullaInvito(i.id); carica(); }} hitSlop={8}>
                  <Text style={styles.azioneAnnulla}>Annulla</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

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
                Il permesso scout si assegna solo ad allenatore e vice: chi registra le azioni sta in panchina.
              </Text>
            )}

            <Pressable style={styles.bottoneDistruttivo} onPress={() => membroInModifica && chiediRimozione(membroInModifica)}>
              <Text style={styles.bottoneDistruttivoTesto}>Rimuovi dalla squadra</Text>
            </Pressable>
            <Pressable onPress={() => setMembroInModifica(null)}><Text style={styles.chiudi}>Chiudi</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!atletaPerEmail} animationType="fade" transparent onRequestClose={() => setAtletaPerEmail(null)}>
        <View style={styles.sfondoPopup}>
          <View style={styles.cartaPopup}>
            <Text style={styles.titoloPopup}>Email di {atletaPerEmail?.nome} {atletaPerEmail?.cognome}</Text>
            <Text style={styles.nota}>Viene salvata in anagrafica e usata subito per l'invito.</Text>
            <TextInput
              style={styles.input}
              placeholder="Email Google"
              placeholderTextColor={brand.colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={emailAtleta}
              onChangeText={setEmailAtleta}
              autoFocus
            />
            <Pressable style={styles.bottone} onPress={salvaEmailEInvita} disabled={!emailAtleta.trim()}>
              <Text style={styles.bottoneTesto}>Salva e invita</Text>
            </Pressable>
            <Pressable onPress={() => setAtletaPerEmail(null)}><Text style={styles.chiudi}>Annulla</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 12, padding: 14, gap: 10 },
  sezione: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "700" },
  etichetta: { color: brand.colors.muted, fontSize: 11, textTransform: "uppercase", marginTop: 4 },
  nota: { color: brand.colors.muted, fontSize: 12, lineHeight: 17 },
  riga: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: brand.colors.border, minHeight: 52 },
  rigaTitolo: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "600" },
  rigaSotto: { color: brand.colors.muted, fontSize: 12, marginTop: 2 },
  freccia: { color: brand.colors.brand, fontSize: 20, fontWeight: "700" },
  statoOk: { color: brand.colors.success, fontSize: 18, fontWeight: "800" },
  azioneAnnulla: { color: brand.colors.error, fontSize: 12, fontWeight: "600" },
  bottonePiccolo: { backgroundColor: brand.colors.brand, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  bottonePiccoloTesto: { color: "#000", fontWeight: "700", fontSize: 12 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10 },
  chipRiga: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 12 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  rigaPermesso: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 8 },
  quadratino: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: brand.colors.brand, alignItems: "center", justifyContent: "center", marginTop: 2 },
  quadratinoAttivo: { backgroundColor: brand.colors.brand },
  spunta: { color: "#000", fontWeight: "800", fontSize: 12 },
  testoPermesso: { color: brand.colors.onSurface, fontSize: 14, fontWeight: "600" },
  bottone: { backgroundColor: brand.colors.brand, padding: 12, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  bottoneDistruttivo: { borderColor: brand.colors.error, borderWidth: 1, padding: 12, borderRadius: 8, alignItems: "center" },
  bottoneDistruttivoTesto: { color: brand.colors.error, fontWeight: "700" },
  sfondoPopup: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
  cartaPopup: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 20, gap: 10 },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  chiudi: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 6 },
});
