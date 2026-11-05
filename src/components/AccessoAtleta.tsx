import { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Modal } from "react-native";
import { useFocusEffect } from "expo-router";
import { elencaMembri, impostaPermessoScout, rimuoviMembro, type MembroTeam } from "@/src/services/membri";
import { annullaInvito, elencaInvitiPendenti, invitaMembro, type TeamInvite } from "@/src/services/teamInvites";
import { aggiornaAtleta } from "@/src/services/athletes";
import { creaLinkAccessoAtleta, linkAccesso, metodoAccessoPerEmail, type MetodoAccesso } from "@/src/services/accessi";
import { invitoAccessoAtleta } from "@/src/lib/messaggiWhatsApp";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { MessaggioWhatsApp } from "@/src/components/MessaggioWhatsApp";
import { brand } from "@/src/config";
import type { Athlete } from "@/src/types/database";

/**
 * Accesso all'app di UN'atleta: e' l'unico punto da cui si invita (prima c'era anche un elenco in Gestione squadra).
 * Stati: account collegato (si puo' dare il permesso scout o revocare l'accesso), invito in sospeso (si rimanda o si
 * annulla), nessun invito (si invita su WhatsApp, chiedendo l'email se manca in anagrafica).
 * Un'atleta archiviata o eliminata perde l'accesso (migrazioni 0097 e 0103): qui non si invita.
 */
export function AccessoAtleta({ teamId, nomeSquadra, atleta, onCambiato }: {
  teamId: string; nomeSquadra: string; atleta: Athlete; onCambiato?: () => void;
}) {
  const [membro, setMembro] = useState<MembroTeam | null>(null);
  const [invito, setInvito] = useState<TeamInvite | null>(null);
  const [emailAnagrafica, setEmailAnagrafica] = useState(atleta.email_contatto?.trim() ?? "");
  const [metodoRilevato, setMetodoRilevato] = useState<MetodoAccesso | null>(null);
  const [metodoScelto, setMetodoScelto] = useState<MetodoAccesso | null>(null);
  const [popupEmail, setPopupEmail] = useState(false);
  const [emailNuova, setEmailNuova] = useState("");
  const [whatsapp, setWhatsapp] = useState<{ metodo: MetodoAccesso; email: string; link: string | null } | null>(null);

  const carica = useCallback(async () => {
    const [membri, inviti] = await Promise.all([
      elencaMembri(teamId).catch(() => [] as MembroTeam[]),
      elencaInvitiPendenti(teamId).catch(() => [] as TeamInvite[]),
    ]);
    setMembro(membri.find((m) => m.atleta_id === atleta.id) ?? null);
    setInvito(inviti.find((i) => i.atleta_id === atleta.id) ?? null);
    const email = atleta.email_contatto?.trim() ?? "";
    setEmailAnagrafica(email);
    setMetodoRilevato(email ? await metodoAccessoPerEmail(email).catch(() => "google" as MetodoAccesso) : null);
  }, [teamId, atleta.id, atleta.email_contatto]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  const metodo: MetodoAccesso = metodoScelto ?? metodoRilevato ?? "google";

  /** Invita: email+password = link personale su WhatsApp; Google = invito legato all'email, poi messaggio su WhatsApp. */
  async function invita(email: string, m: MetodoAccesso) {
    try {
      if (m === "password") {
        const r = await creaLinkAccessoAtleta(atleta.id, "password");
        setWhatsapp({ metodo: r.metodo, email: r.email || email, link: r.token ? linkAccesso(r.token) : null });
      } else {
        await invitaMembro(teamId, email, "atleta", atleta.id);
        setWhatsapp({ metodo: "google", email, link: null });
      }
      carica();
      onCambiato?.();
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  async function salvaEmailEInvita() {
    const email = emailNuova.trim();
    if (!email) return;
    try {
      await aggiornaAtleta(atleta.id, { email_contatto: email });
      const m = metodoScelto ?? await metodoAccessoPerEmail(email).catch(() => "google" as MetodoAccesso);
      setPopupEmail(false);
      setEmailNuova("");
      await invita(email, m);
    } catch (e) { avvisa("Errore", (e as Error).message); }
  }

  function chiediRevoca() {
    if (!membro) return;
    confermaAzione("Revocare l'accesso?", `${membro.email} non potrà più entrare nell'app. I dati registrati restano.`, "Revoca", async () => {
      try { await rimuoviMembro(teamId, membro.user_id); await carica(); onCambiato?.(); }
      catch (e) { avvisa("Errore", (e as Error).message); }
    }, true);
  }

  async function cambiaScout() {
    if (!membro) return;
    try { await impostaPermessoScout(teamId, membro.user_id, !membro.puo_scoutare); await carica(); }
    catch (e) { avvisa("Errore", (e as Error).message); }
  }

  if (atleta.status !== "attiva") return null;

  return (
    <View style={s.card}>
      <Text style={s.titolo}>Accesso all'app</Text>

      {membro ? (
        <>
          <Text style={s.testo}>Account collegato: {membro.email}{membro.puo_scoutare ? " · può fare lo scout" : ""}</Text>
          <View style={s.riga}>
            <Pressable style={[s.pillola, membro.puo_scoutare && s.pillolaAttiva]} onPress={cambiaScout}>
              <Text style={[s.pillolaTesto, membro.puo_scoutare && { color: "#000" }]}>{membro.puo_scoutare ? "Scout attivo" : "Permetti lo scout"}</Text>
            </Pressable>
            <Pressable style={s.pillolaElimina} onPress={chiediRevoca}>
              <Text style={s.pillolaEliminaTesto}>Revoca accesso</Text>
            </Pressable>
          </View>
        </>
      ) : invito ? (
        <>
          <Text style={s.testo}>Invito inviato a {invito.email}. Entrerà come atleta al primo accesso.</Text>
          <View style={s.riga}>
            <Pressable style={s.pillolaPrimaria} onPress={() => setWhatsapp({ metodo: "google", email: invito.email, link: null })}>
              <Text style={s.pillolaPrimariaTesto}>Rimanda su WhatsApp</Text>
            </Pressable>
            <Pressable style={s.pillolaElimina} onPress={async () => { await annullaInvito(invito.id); carica(); onCambiato?.(); }}>
              <Text style={s.pillolaEliminaTesto}>Annulla invito</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={s.testo}>
            {emailAnagrafica ? `Nessun account collegato. Email in anagrafica: ${emailAnagrafica}.` : "Nessun account collegato e nessuna email in anagrafica."}
          </Text>
          {!!emailAnagrafica && (
            <View style={s.riga}>
              {([["google", "Google"], ["password", "Email e password"]] as [MetodoAccesso, string][]).map(([m, et]) => (
                <Pressable key={m} onPress={() => setMetodoScelto(m)} style={[s.pillola, metodo === m && s.pillolaAttiva]} hitSlop={4}>
                  <Text style={[s.pillolaTesto, metodo === m && { color: "#000", fontWeight: "700" }]}>{et}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Pressable
            style={s.pillolaPrimaria}
            onPress={() => { if (emailAnagrafica) invita(emailAnagrafica, metodo); else { setEmailNuova(""); setPopupEmail(true); } }}
          >
            <Text style={s.pillolaPrimariaTesto}>{emailAnagrafica ? "💬 Invita su WhatsApp" : "+ Aggiungi l'email e invita"}</Text>
          </Pressable>
        </>
      )}

      {whatsapp && (
        <MessaggioWhatsApp
          visibile
          titolo={`Invito all'app — ${atleta.nome} ${atleta.cognome}`}
          atleta={atleta}
          modelli={[{ etichetta: "Invito", testo: invitoAccessoAtleta({ squadra: nomeSquadra, metodo: whatsapp.metodo, email: whatsapp.email, link: whatsapp.link }) }]}
          onChiudi={() => setWhatsapp(null)}
        />
      )}

      <Modal visible={popupEmail} animationType="fade" transparent onRequestClose={() => setPopupEmail(false)}>
        <View style={s.sfondo}>
          <View style={s.carta}>
            <Text style={s.titoloPopup}>Email di {atleta.nome} {atleta.cognome}</Text>
            <Text style={s.testo}>Viene salvata in anagrafica e usata subito per l'invito.</Text>
            <TextInput
              style={s.input}
              placeholder="Email"
              placeholderTextColor={brand.colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={emailNuova}
              onChangeText={setEmailNuova}
              autoFocus
            />
            <Pressable style={[s.pillolaPrimaria, !emailNuova.trim() && { opacity: 0.5 }]} onPress={salvaEmailEInvita} disabled={!emailNuova.trim()}>
              <Text style={s.pillolaPrimariaTesto}>Salva e invita</Text>
            </Pressable>
            <Pressable onPress={() => setPopupEmail(false)}><Text style={s.annulla}>Annulla</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 16, gap: 10 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  testo: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  riga: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pillola: { minHeight: 36, paddingHorizontal: 16, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  pillolaAttiva: { backgroundColor: brand.colors.brand },
  pillolaTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14, fontWeight: "600" },
  pillolaPrimaria: { minHeight: 42, paddingHorizontal: 18, borderRadius: 999, backgroundColor: brand.colors.brand, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  pillolaPrimariaTesto: { color: "#000", fontWeight: "700", fontSize: 15 },
  pillolaElimina: { minHeight: 36, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: brand.colors.error, alignItems: "center", justifyContent: "center" },
  pillolaEliminaTesto: { color: brand.colors.error, fontSize: 14, fontWeight: "600" },
  sfondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
  carta: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 20, gap: 10, width: "100%", maxWidth: 480, alignSelf: "center" },
  titoloPopup: { color: brand.colors.onSurface, fontSize: 18, fontWeight: "700" },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, minHeight: 44 },
  annulla: { color: brand.colors.muted, fontSize: 14, textAlign: "center", paddingVertical: 6 },
});
