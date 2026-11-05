import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, ActivityIndicator, Linking, Platform, Share, type StyleProp, type ViewStyle } from "react-native";
import { brand } from "@/src/config";
import { CodiceQr } from "@/src/components/CodiceQr";
import { apriWhatsApp } from "@/src/lib/apriWhatsApp";
import {
  cambiaLinkGenitori, linkGenitori, messaggioGenitori, ottieniLinkGenitori, revocaLinkGenitori, type LinkGenitori,
} from "@/src/services/liveGenitori";

const apriLink = apriWhatsApp;

function oraScadenza(iso: string): string {
  try { return new Date(iso).toLocaleString("it-IT", { weekday: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}

/**
 * Pulsante "Condividi con i genitori" (solo per chi gestisce la squadra): mostra il QR e il link della diretta
 * "sola visione" — i genitori vedono soltanto il punteggio, senza account. Il link scade a fine partita o dopo 24 ore
 * e si puo' revocare o cambiare in qualsiasi momento.
 *
 * Da collegare in una schermata dove si conosce la partita, ad esempio accanto al QR scout in app/(tabs)/partite.tsx:
 *   <CondividiGenitori matchId={m.id} squadra={team.nome} avversario={m.avversario} />
 * Se la migrazione 0099 non e' ancora applicata, il pulsante mostra un messaggio gentile invece di rompersi.
 */
export function CondividiGenitori({ matchId, squadra, avversario, nascosto, stile }: {
  matchId: string;
  squadra?: string | null;
  avversario?: string | null;
  /** Per esempio quando la partita e' gia' conclusa: il link non avrebbe piu' senso. */
  nascosto?: boolean;
  stile?: StyleProp<ViewStyle>;
}) {
  const [aperto, setAperto] = useState(false);
  const [link, setLink] = useState<LinkGenitori | null>(null);
  const [revocato, setRevocato] = useState(false);
  const [lavoro, setLavoro] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [copiato, setCopiato] = useState(false);

  if (nascosto) return null;

  const url = link ? linkGenitori(link.token) : null;

  async function esegui(azione: () => Promise<void>) {
    setLavoro(true);
    setErrore(null);
    try { await azione(); }
    catch (e) { setErrore(e instanceof Error ? e.message : "Operazione non riuscita"); }
    finally { setLavoro(false); }
  }

  function apri() {
    setAperto(true);
    setCopiato(false);
    setRevocato(false);
    setLink(null);
    esegui(async () => { setLink(await ottieniLinkGenitori(matchId)); });
  }

  function chiudi() { setAperto(false); }

  function nuovo() {
    esegui(async () => { setLink(await cambiaLinkGenitori(matchId)); setRevocato(false); setCopiato(false); });
  }

  function revoca() {
    esegui(async () => { await revocaLinkGenitori(matchId); setLink(null); setRevocato(true); setCopiato(false); });
  }

  function creaDiNuovo() {
    esegui(async () => { setLink(await ottieniLinkGenitori(matchId)); setRevocato(false); });
  }

  async function copia() {
    if (!url) return;
    try {
      const nav = (typeof navigator !== "undefined" ? navigator : undefined) as unknown as { clipboard?: { writeText: (t: string) => Promise<void> } } | undefined;
      if (Platform.OS === "web" && nav?.clipboard) {
        await nav.clipboard.writeText(url);
        setCopiato(true);
        setTimeout(() => setCopiato(false), 3000);
      } else {
        // Sul telefono si apre il foglio di condivisione del sistema, che ha anche "Copia".
        await Share.share({ message: url });
      }
    } catch {
      setErrore("Copia non riuscita: seleziona il link e copialo a mano.");
    }
  }

  async function invia() {
    if (!url) return;
    try { await Share.share({ message: messaggioGenitori(squadra, avversario, url) }); }
    catch { /* condivisione annullata */ }
  }

  return (
    <>
      <Pressable
        testID="condividi-genitori"
        accessibilityRole="button"
        style={[s.pulsante, stile]}
        onPress={apri}
      >
        <Text style={s.pulsanteTesto}>👨‍👩‍👧 Condividi con i genitori</Text>
      </Pressable>

      <Modal visible={aperto} animationType="slide" transparent onRequestClose={chiudi}>
        <View style={s.sfondo}>
          <View style={s.carta}>
            <ScrollView contentContainerStyle={s.contenuto}>
              <Text accessibilityRole="header" style={s.titolo}>Condividi con i genitori</Text>
              <Text style={s.nota}>
                Chi apre il link vede solo il punteggio in diretta: squadre, set vinti e set in corso. Non serve nessun account e non compaiono nomi di atlete né statistiche. Il link smette di funzionare quando la partita finisce, o dopo 24 ore.
              </Text>

              {lavoro && !url && <ActivityIndicator color={brand.colors.brand} />}
              {errore && <Text style={s.errore}>{errore}</Text>}

              {url && link && (
                <View style={{ gap: 12 }}>
                  <CodiceQr testo={url} dimensione={220} />
                  <Text style={s.link} selectable>{url}</Text>
                  {!!link.scade_il && <Text style={[s.nota, { textAlign: "center" }]}>Valido fino a {oraScadenza(link.scade_il)}, o alla fine della partita.</Text>}
                  <View style={s.colonna}>
                    <Pressable style={[s.primario, lavoro && s.spento]} onPress={() => apriLink(`https://wa.me/?text=${encodeURIComponent(messaggioGenitori(squadra, avversario, url))}`)} disabled={lavoro}>
                      <Text style={s.primarioTesto}>💬 Manda su WhatsApp</Text>
                    </Pressable>
                    <View style={s.riga}>
                      <Pressable style={s.secondario} onPress={copia}><Text style={s.secondarioTesto}>{copiato ? "Copiato ✓" : "Copia il link"}</Text></Pressable>
                      {Platform.OS !== "web" && <Pressable style={s.secondario} onPress={invia}><Text style={s.secondarioTesto}>Invia…</Text></Pressable>}
                    </View>
                    <View style={s.riga}>
                      <Pressable style={[s.secondario, lavoro && s.spento]} onPress={nuovo} disabled={lavoro}><Text style={s.secondarioTesto}>Nuovo link</Text></Pressable>
                      <Pressable style={[s.secondario, lavoro && s.spento]} onPress={revoca} disabled={lavoro}><Text style={[s.secondarioTesto, { color: brand.colors.error }]}>Revoca</Text></Pressable>
                    </View>
                  </View>
                </View>
              )}

              {!url && revocato && (
                <View style={{ gap: 10 }}>
                  <Text style={s.nota}>Link revocato: chi lo ha non vede più il punteggio.</Text>
                  <Pressable style={[s.primario, lavoro && s.spento]} onPress={creaDiNuovo} disabled={lavoro}>
                    <Text style={s.primarioTesto}>Crea un nuovo link</Text>
                  </Pressable>
                </View>
              )}

              {!url && !revocato && !lavoro && errore && (
                <Pressable style={s.secondario} onPress={creaDiNuovo}><Text style={s.secondarioTesto}>Riprova</Text></Pressable>
              )}

              <Pressable style={s.chiudi} onPress={chiudi}>
                <Text style={s.chiudiTesto}>Chiudi</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  pulsante: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: brand.colors.brand, paddingHorizontal: 18, paddingVertical: 10 },
  pulsanteTesto: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  sfondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end", alignItems: "center" },
  carta: { width: "100%", maxWidth: 520, maxHeight: "92%", backgroundColor: brand.colors.surfaceSecondary, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: brand.colors.border },
  contenuto: { padding: 18, gap: 14, paddingBottom: 28 },
  titolo: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700" },
  nota: { color: brand.colors.muted, fontSize: 13, lineHeight: 19 },
  errore: { color: brand.colors.error, fontSize: 13, lineHeight: 19 },
  link: { color: brand.colors.brandSecondary, fontSize: 12, textAlign: "center" },
  colonna: { gap: 10 },
  riga: { flexDirection: "row", gap: 10 },
  primario: { minHeight: 48, borderRadius: 999, backgroundColor: brand.colors.brand, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  primarioTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
  secondario: { flex: 1, minHeight: 44, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  secondarioTesto: { color: brand.colors.onSurface, fontWeight: "600", fontSize: 15 },
  spento: { opacity: 0.5 },
  chiudi: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  chiudiTesto: { color: brand.colors.muted, fontSize: 15, fontWeight: "600" },
});
