import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, TextInput, Linking, Platform } from "react-native";
import { brand } from "@/src/config";
import { elencaAtlete } from "@/src/services/athletes";
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
 * Messaggio da inviare su WhatsApp: il testo e' modificabile, "{nome}" viene
 * sostituito col nome di ogni atleta. Un pulsante lo manda al gruppo (si sceglie
 * la chat in WhatsApp), uno per atleta apre la chat col suo numero in anagrafica.
 * Niente invio automatico: l'ultimo tocco ("invia") resta in WhatsApp, a chi scrive.
 */
export function MessaggioWhatsApp({ visibile, titolo, teamId, modelli, onChiudi }: {
  visibile: boolean; titolo: string; teamId: string; modelli: ModelloMessaggio[]; onChiudi: () => void;
}) {
  const [atlete, setAtlete] = useState<Athlete[]>([]);
  const [testo, setTesto] = useState("");
  const [inviate, setInviate] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visibile) return;
    setTesto(modelli[0]?.testo ?? "");
    setInviate(new Set());
    elencaAtlete(teamId).then(setAtlete).catch(() => setAtlete([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibile, teamId]);

  const personalizza = (nome: string) => testo.replace(/\{nome\}/g, nome);
  const conNumero = atlete.filter((a) => numeroWhatsApp(a.telefono));
  const senzaNumero = atlete.filter((a) => !numeroWhatsApp(a.telefono));

  return (
    <Modal visible={visibile} animationType="slide" transparent onRequestClose={onChiudi}>
      <View style={styles.sfondo}>
        <View style={styles.carta}>
          <ScrollView contentContainerStyle={{ gap: 10 }}>
            <Text style={styles.titolo}>{titolo}</Text>

            {modelli.length > 1 && (
              <View style={styles.riga}>
                {modelli.map((m) => (
                  <Pressable key={m.etichetta} style={[styles.chip, testo === m.testo && styles.chipAttivo]} onPress={() => setTesto(m.testo)}>
                    <Text style={[styles.chipTesto, testo === m.testo && styles.chipTestoAttivo]}>{m.etichetta}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <TextInput style={styles.input} multiline value={testo} onChangeText={setTesto} placeholderTextColor={brand.colors.muted} />
            <Text style={styles.nota}>Puoi modificare il testo. «{"{nome}"}» diventa il nome di ogni atleta quando scrivi alle singole.</Text>

            <Pressable style={styles.bottone} onPress={() => apriLink(`https://wa.me/?text=${encodeURIComponent(personalizza("ragazze"))}`)}>
              <Text style={styles.bottoneTesto}>💬 Manda al gruppo</Text>
            </Pressable>
            <Text style={styles.nota}>Si apre WhatsApp con il messaggio pronto: scegli il gruppo della squadra e premi invia.</Text>

            <Text style={styles.sezione}>Oppure a ogni atleta</Text>
            {conNumero.length === 0 && <Text style={styles.nota}>Nessuna atleta ha un numero di telefono in anagrafica.</Text>}
            {conNumero.map((a) => (
              <Pressable
                key={a.id}
                style={styles.rigaAtleta}
                onPress={() => {
                  setInviate((prev) => new Set(prev).add(a.id));
                  apriLink(`https://wa.me/${numeroWhatsApp(a.telefono)}?text=${encodeURIComponent(personalizza(a.nome))}`);
                }}
              >
                <Text style={styles.nomeAtleta}>{a.cognome} {a.nome}</Text>
                <Text style={[styles.statoAtleta, inviate.has(a.id) && { color: brand.colors.success }]}>{inviate.has(a.id) ? "✓ aperto" : "Scrivi ›"}</Text>
              </Pressable>
            ))}
            {senzaNumero.length > 0 && (
              <Text style={styles.nota}>Senza numero valido: {senzaNumero.map((a) => `${a.nome} ${a.cognome}`).join(", ")}. Aggiungilo nella scheda dell'atleta.</Text>
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
