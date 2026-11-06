import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { invitaMembro } from "@/src/services/teamInvites";
import { aggiornaAtleta } from "@/src/services/athletes";
import { creaLinkAccessoAtleta, linkAccesso, metodoAccessoPerEmail, type MetodoAccesso } from "@/src/services/accessi";
import { invitoAccessoAtleta } from "@/src/lib/messaggiWhatsApp";
import { avvisa } from "@/src/lib/confermaAzione";
import { MessaggioWhatsApp } from "@/src/components/MessaggioWhatsApp";
import { brand } from "@/src/config";
import type { Athlete } from "@/src/types/database";

/**
 * "Invita" direttamente dalla riga della Rosa, per le atlete che non hanno ancora un account ne' un invito:
 * un tocco e si apre WhatsApp con il messaggio pronto (stesso flusso di "Accesso all'app" nella scheda atleta).
 * Il metodo (Google o email+password) e' quello rilevato dall'email in anagrafica; se l'email manca la chiede.
 */
export function InvitaDaRiga({ teamId, nomeSquadra, atleta, onCambiato }: {
  teamId: string; nomeSquadra: string; atleta: Athlete; onCambiato: () => void;
}) {
  const [occupato, setOccupato] = useState(false);
  const [popupEmail, setPopupEmail] = useState(false);
  const [emailNuova, setEmailNuova] = useState("");
  const [whatsapp, setWhatsapp] = useState<{ metodo: MetodoAccesso; email: string; link: string | null } | null>(null);

  async function invita(email: string, metodo: MetodoAccesso) {
    if (metodo === "password") {
      const r = await creaLinkAccessoAtleta(atleta.id, "password");
      setWhatsapp({ metodo: r.metodo, email: r.email || email, link: r.token ? linkAccesso(r.token) : null });
    } else {
      await invitaMembro(teamId, email, "atleta", atleta.id);
      setWhatsapp({ metodo: "google", email, link: null });
    }
  }

  async function avvia() {
    if (occupato) return;
    const email = atleta.email_contatto?.trim() ?? "";
    if (!email) { setEmailNuova(""); setPopupEmail(true); return; }
    setOccupato(true);
    try {
      const metodo = await metodoAccessoPerEmail(email).catch(() => "google" as MetodoAccesso);
      await invita(email, metodo);
    } catch (e) { avvisa("Errore", (e as Error).message); }
    finally { setOccupato(false); }
  }

  async function salvaEmailEInvita() {
    const email = emailNuova.trim();
    if (!email) return;
    setOccupato(true);
    try {
      await aggiornaAtleta(atleta.id, { email_contatto: email });
      const metodo = await metodoAccessoPerEmail(email).catch(() => "google" as MetodoAccesso);
      setPopupEmail(false);
      await invita(email, metodo);
    } catch (e) { avvisa("Errore", (e as Error).message); }
    finally { setOccupato(false); }
  }

  return (
    <>
      <Pressable
        onPress={avvia}
        hitSlop={8}
        style={({ pressed }) => [s.pillola, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel={`Invita ${atleta.nome} ${atleta.cognome} all'app su WhatsApp`}
      >
        {occupato ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="logo-whatsapp" size={14} color="#fff" />}
        <Text style={s.pillolaTesto}>Invita</Text>
      </Pressable>

      {whatsapp && (
        <MessaggioWhatsApp
          visibile
          titolo={`Invito all'app — ${atleta.nome} ${atleta.cognome}`}
          atleta={atleta}
          modelli={[{ etichetta: "Invito", testo: invitoAccessoAtleta({ squadra: nomeSquadra, metodo: whatsapp.metodo, email: whatsapp.email, link: whatsapp.link }) }]}
          // La riga si aggiorna (diventa "Invitata") solo dopo, altrimenti questo componente sparirebbe prima di aprire WhatsApp.
          onChiudi={() => { setWhatsapp(null); onCambiato(); }}
        />
      )}

      <Modal visible={popupEmail} animationType="fade" transparent onRequestClose={() => setPopupEmail(false)}>
        <View style={s.sfondo}>
          <View style={s.carta}>
            <Text style={s.titolo}>Email di {atleta.nome} {atleta.cognome}</Text>
            <Text style={s.testo}>Serve per l'invito: viene salvata in anagrafica.</Text>
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
            <Pressable style={[s.primario, (!emailNuova.trim() || occupato) && { opacity: 0.5 }]} onPress={salvaEmailEInvita} disabled={!emailNuova.trim() || occupato}>
              <Text style={s.primarioTesto}>Salva e invita</Text>
            </Pressable>
            <Pressable onPress={() => setPopupEmail(false)}><Text style={s.annulla}>Annulla</Text></Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  pillola: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 30, paddingHorizontal: 11, borderRadius: 999, backgroundColor: "#25D366" },
  pillolaTesto: { color: "#fff", fontSize: 13, fontWeight: "700" },
  sfondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
  carta: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 20, gap: 10, width: "100%", maxWidth: 480, alignSelf: "center" },
  titolo: { color: brand.colors.onSurface, fontSize: 18, fontWeight: "700" },
  testo: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, minHeight: 44 },
  primario: { minHeight: 44, borderRadius: 999, backgroundColor: brand.colors.brand, alignItems: "center", justifyContent: "center" },
  primarioTesto: { color: "#000", fontWeight: "700", fontSize: 15 },
  annulla: { color: brand.colors.muted, fontSize: 14, textAlign: "center", paddingVertical: 6 },
});
