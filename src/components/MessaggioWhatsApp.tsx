import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, TextInput, Linking, Platform } from "react-native";
import { brand } from "@/src/config";
import { useAuth } from "@/src/context/AuthContext";
import type { Athlete } from "@/src/types/database";

export interface ModelloMessaggio { etichetta: string; testo: string }

/** Numero in formato internazionale per wa.me: solo cifre; senza prefisso si assume Italia (+39). */
export function numeroWhatsApp(telefono: string | null): string | null {
  if (!telefono) return null;
  let n = telefono.trim().replace(/[^\d+]/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  else if (n.startsWith("00")) n = n.slice(2);
  else n = "39" + n; // senza prefisso internazionale: Italia
  n = n.replace(/\D/g, "");
  return n.length >= 10 && n.length <= 15 ? n : null;
}

function apriLink(url: string) {
  if (Platform.OS === "web") window.open(url, "_blank", "noopener");
  else Linking.openURL(url);
}

/**
 * Messaggio WhatsApp precompilato e modificabile. Due usi:
 *  - con `atleta`: scrive a una persona, al numero in anagrafica ("{nome}" diventa il suo nome);
 *  - senza `atleta`: apre WhatsApp col testo e si sceglie il gruppo della squadra.
 * Niente invio automatico: l'ultimo tocco ("invia") resta in WhatsApp, a chi scrive.
 */
export function MessaggioWhatsApp({ visibile, titolo, atleta, nota, modelli, onChiudi }: {
  visibile: boolean; titolo: string; atleta?: Athlete | null;
  /** Senza atleta si sceglie la chat in WhatsApp: questa e' la spiegazione sotto il pulsante. */
  nota?: string; modelli: ModelloMessaggio[]; onChiudi: () => void;
}) {
  const { session } = useAuth();
  const [testo, setTesto] = useState("");

  // Il messaggio e' firmato con il nome di battesimo di chi lo sta mandando (account Google, altrimenti l'inizio dell'email).
  const meta = (session?.user.user_metadata ?? {}) as { full_name?: string; name?: string };
  const firmatario = (meta.full_name || meta.name || session?.user.email?.split("@")[0] || "").trim().split(/\s+/)[0];
  const conFirma = (t: string) => (firmatario ? `${t.replace(/\s+$/, "")}\n— ${firmatario}` : t);
  // Il commento della partita lascia uno spazio fra il risultato e la firma, da riempire.
  const nuovoTesto = (t: string) => (t.endsWith("\n\n") ? `${t}\n${firmatario ? `— ${firmatario}` : ""}` : conFirma(t));

  useEffect(() => {
    if (visibile) setTesto(nuovoTesto(modelli[0]?.testo ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibile]);

  const numero = atleta ? numeroWhatsApp(atleta.telefono) : null;
  const testoFinale = testo.replace(/\{nome\}/g, atleta?.nome ?? "ragazze");

  return (
    <Modal visible={visibile} animationType="slide" transparent onRequestClose={onChiudi}>
      <View style={styles.sfondo}>
        <View style={styles.carta}>
          <ScrollView contentContainerStyle={{ gap: 10 }}>
            <Text style={styles.titolo}>{titolo}</Text>
            {modelli.length > 1 && (
              <View style={styles.riga}>
                {modelli.map((m) => (
                  <Pressable key={m.etichetta} style={[styles.chip, testo === nuovoTesto(m.testo) && styles.chipAttivo]} onPress={() => setTesto(nuovoTesto(m.testo))}>
                    <Text style={[styles.chipTesto, testo === nuovoTesto(m.testo) && styles.chipTestoAttivo]}>{m.etichetta}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <TextInput style={styles.input} multiline value={testo} onChangeText={setTesto} placeholderTextColor={brand.colors.muted} />

            {atleta ? (
              numero ? (
                <>
                  <Pressable style={styles.bottone} onPress={() => apriLink(`https://wa.me/${numero}?text=${encodeURIComponent(testoFinale)}`)}>
                    <Text style={styles.bottoneTesto}>💬 Scrivi a {atleta.nome} su WhatsApp</Text>
                  </Pressable>
                  <Text style={styles.nota}>Si apre la chat con il suo numero ({atleta.telefono}) e il messaggio pronto: premi invia in WhatsApp.</Text>
                </>
              ) : (
                <Text style={styles.nota}>{atleta.nome} non ha un numero di telefono valido in anagrafica. Aggiungilo nella sua scheda (campo Telefono) e riprova.</Text>
              )
            ) : (
              <>
                <Pressable style={styles.bottone} onPress={() => apriLink(`https://wa.me/?text=${encodeURIComponent(testoFinale)}`)}>
                  <Text style={styles.bottoneTesto}>💬 Apri WhatsApp</Text>
                </Pressable>
                <Text style={styles.nota}>{nota ?? "Si apre WhatsApp col messaggio pronto: scegli il gruppo della squadra e premi invia. Aggiungi qui sopra il tuo commento."}</Text>
              </>
            )}
          </ScrollView>
          <Pressable onPress={onChiudi}><Text style={styles.chiudi}>Chiudi</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sfondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 20 },
  carta: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 16, padding: 18, gap: 10, maxHeight: "92%" },
  titolo: { color: brand.colors.onSurface, fontSize: 16, fontWeight: "700" },
  sezione: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "800", textTransform: "uppercase", marginTop: 6 },
  riga: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: brand.colors.surfaceTertiary },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  input: { backgroundColor: brand.colors.surfaceTertiary, color: brand.colors.onSurface, borderRadius: 8, padding: 10, minHeight: 110, textAlignVertical: "top" },
  nota: { color: brand.colors.muted, fontSize: 12 },
  bottone: { backgroundColor: brand.colors.brand, padding: 12, borderRadius: 8, alignItems: "center" },
  bottoneTesto: { color: "#000", fontWeight: "700" },
  rigaAtleta: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  nomeAtleta: { color: brand.colors.onSurface, fontSize: 14 },
  statoAtleta: { color: brand.colors.brandSecondary, fontSize: 13, fontWeight: "700" },
  chiudi: { color: brand.colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 6 },
});
