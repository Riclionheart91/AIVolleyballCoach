import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { aggiornaAtleta, archiviaAtleta, eliminaAtletaDefinitivamente, leggiAtleta, ripristinaAtleta } from "@/src/services/athletes";
import { confermaAzione, avvisa } from "@/src/lib/confermaAzione";
import { SchedaRendimento } from "@/src/components/SchedaRendimento";
import { CaricoAllenamento } from "@/src/components/CaricoAllenamento";
import { PianiIndividuali } from "@/src/components/PianiIndividuali";
import { TempoDiGiocoAtleta } from "@/src/components/TempoDiGioco";
import { TitoloGrande } from "@/src/components/TitoloGrande";
import { brand, ruoliCampo } from "@/src/config";
import type { Athlete, RuoloCampo } from "@/src/types/database";
import { Ionicons } from "@expo/vector-icons";
import { AccessoAtleta } from "@/src/components/AccessoAtleta";

export default function SchedaAtleta() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { team, puoScrivere, puoVedereAnalisi } = useAuth();
  const [atleta, setAtleta] = useState<Athlete | null>(null);
  const [inModifica, setInModifica] = useState(false);
  const [anagraficaAperta, setAnagraficaAperta] = useState(true);
  const [salvataggio, setSalvataggio] = useState(false);

  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [ruoloCampo, setRuoloCampo] = useState<RuoloCampo | null>(null);
  const [numeroMaglia, setNumeroMaglia] = useState("");
  const [dataNascita, setDataNascita] = useState("");
  const [codiceFiscale, setCodiceFiscale] = useState("");
  const [numeroLicenza, setNumeroLicenza] = useState("");
  const [scadenzaCertMedico, setScadenzaCertMedico] = useState("");
  const [telefono, setTelefono] = useState("");
  const [emailContatto, setEmailContatto] = useState("");
  const [notePersonali, setNotePersonali] = useState("");

  useEffect(() => {
    if (!id) return;
    leggiAtleta(id).then((a) => {
      setAtleta(a);
      caricaCampi(a);
    }).catch((err) => avvisa("Errore", err.message));
  }, [id]);

  function caricaCampi(a: Athlete) {
    setNome(a.nome); setCognome(a.cognome); setRuoloCampo(a.ruolo_campo);
    setNumeroMaglia(a.numero_maglia != null ? String(a.numero_maglia) : "");
    setDataNascita(a.data_nascita ?? ""); setCodiceFiscale(a.codice_fiscale ?? "");
    setNumeroLicenza(a.numero_licenza ?? ""); setScadenzaCertMedico(a.scadenza_certificato_medico ?? "");
    setTelefono(a.telefono ?? ""); setEmailContatto(a.email_contatto ?? ""); setNotePersonali(a.note_personali ?? "");
  }

  const haModifiche = !!atleta && (
    nome !== atleta.nome || cognome !== atleta.cognome || ruoloCampo !== atleta.ruolo_campo ||
    numeroMaglia !== (atleta.numero_maglia != null ? String(atleta.numero_maglia) : "") ||
    dataNascita !== (atleta.data_nascita ?? "") || codiceFiscale !== (atleta.codice_fiscale ?? "") ||
    numeroLicenza !== (atleta.numero_licenza ?? "") || scadenzaCertMedico !== (atleta.scadenza_certificato_medico ?? "") ||
    telefono !== (atleta.telefono ?? "") || emailContatto !== (atleta.email_contatto ?? "") || notePersonali !== (atleta.note_personali ?? "")
  );

  function tornaIndietro() {
    if (inModifica && haModifiche) {
      confermaAzione("Modifiche non salvate", "Vuoi salvarle prima di uscire?", "Esci senza salvare", () => router.back(), true);
    } else {
      router.back();
    }
  }

  async function salva() {
    if (!atleta || !nome.trim() || !cognome.trim()) return;
    setSalvataggio(true);
    try {
      const aggiornato = await aggiornaAtleta(atleta.id, {
        nome: nome.trim(), cognome: cognome.trim(), ruolo_campo: ruoloCampo,
        numero_maglia: numeroMaglia ? Number(numeroMaglia) || null : null,
        data_nascita: dataNascita || null, codice_fiscale: codiceFiscale.trim() || null,
        numero_licenza: numeroLicenza.trim() || null, scadenza_certificato_medico: scadenzaCertMedico || null,
        telefono: telefono.trim() || null, email_contatto: emailContatto.trim() || null, note_personali: notePersonali.trim() || null,
      });
      setAtleta(aggiornato);
      setInModifica(false);
    } catch (e) {
      avvisa("Errore", (e as Error).message);
    } finally {
      setSalvataggio(false);
    }
  }

  function chiediArchiviazione() {
    if (!atleta) return;
    confermaAzione("Archiviare l'atleta?", `"${atleta.nome} ${atleta.cognome}" non comparirà più negli elenchi attivi. Puoi ripristinarla in qualunque momento dalla sezione "Archiviati".`, "Archivia", async () => {
      try { await archiviaAtleta(atleta.id); router.back(); } catch (e) { avvisa("Errore", (e as Error).message); }
    }, true);
  }

  function chiediRipristino() {
    if (!atleta) return;
    ripristinaAtleta(atleta.id).then(() => setAtleta({ ...atleta, status: "attiva" })).catch((e) => avvisa("Errore", e.message));
  }

  function chiediEliminazione() {
    if (!atleta) return;
    confermaAzione(
      "Eliminare definitivamente?",
      `"${atleta.nome} ${atleta.cognome}" e TUTTO il suo storico (valutazioni, presenze, RPE, scout) verranno cancellati per sempre. Se ha un account collegato, perde anche l'accesso alla squadra. Nella maggior parte dei casi è meglio archiviare invece di eliminare. Procedere comunque?`,
      "Elimina definitivamente",
      async () => {
        try { await eliminaAtletaDefinitivamente(atleta.id); router.back(); } catch (e) { avvisa("Errore", (e as Error).message); }
      },
      true,
    );
  }

  if (!atleta) return <View style={styles.container}><ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} /></View>;

  const sottotitolo = [
    atleta.numero_maglia != null ? `#${atleta.numero_maglia}` : null,
    atleta.ruolo_campo || null,
    team?.nome || null,
  ].filter(Boolean).join(" · ");
  const cert = statoCertificato(atleta.scadenza_certificato_medico);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.colonna}>
          <View style={styles.rigaHeader}>
            <Pressable onPress={tornaIndietro} hitSlop={12} style={styles.bersaglio}>
              <Text style={styles.indietro}>‹ Rosa</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
       <View style={styles.colonna}>
        {atleta.status === "archiviata" && <Text style={styles.badgeArchiviata}>ARCHIVIATA</Text>}

        {inModifica ? (
          <>
            <TitoloGrande titolo="Modifica atleta" />
            <Campo etichetta="Nome"><TextInput style={styles.input} value={nome} onChangeText={setNome} placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Cognome"><TextInput style={styles.input} value={cognome} onChangeText={setCognome} placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Ruolo in campo">
              <View style={styles.selettoreRiga}>
                {ruoliCampo.map((r) => (
                  <Pressable key={r} onPress={() => setRuoloCampo(r)} style={[styles.chip, ruoloCampo === r && styles.chipAttivo]}>
                    <Text style={[styles.chipTesto, ruoloCampo === r && styles.chipTestoAttivo]}>{r}</Text>
                  </Pressable>
                ))}
              </View>
            </Campo>
            <Campo etichetta="Numero maglia"><TextInput style={styles.input} keyboardType="numeric" value={numeroMaglia} onChangeText={setNumeroMaglia} placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Data di nascita (AAAA-MM-GG)"><TextInput style={styles.input} value={dataNascita} onChangeText={setDataNascita} placeholder="2010-05-20" placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Codice fiscale"><TextInput style={styles.input} autoCapitalize="characters" value={codiceFiscale} onChangeText={setCodiceFiscale} placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Numero di licenza"><TextInput style={styles.input} value={numeroLicenza} onChangeText={setNumeroLicenza} placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Scadenza certificato medico (AAAA-MM-GG)"><TextInput style={styles.input} value={scadenzaCertMedico} onChangeText={setScadenzaCertMedico} placeholder="2027-06-30" placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Telefono"><TextInput style={styles.input} keyboardType="phone-pad" value={telefono} onChangeText={setTelefono} placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Email"><TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address" value={emailContatto} onChangeText={setEmailContatto} placeholderTextColor={brand.colors.muted} /></Campo>
            <Campo etichetta="Note"><TextInput style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]} multiline value={notePersonali} onChangeText={setNotePersonali} placeholderTextColor={brand.colors.muted} /></Campo>

            <Pressable style={styles.bottone} onPress={salva} disabled={salvataggio || !nome.trim() || !cognome.trim()}>
              {salvataggio ? <ActivityIndicator color="#000" /> : <Text style={styles.bottoneTesto}>Salva</Text>}
            </Pressable>

            {/* Azioni che cambiano lo stato dell'atleta: in fondo, lontane dal pulsante Salva. Archiviata o eliminata
                perde l'accesso all'app (vedi la migrazione 0103). */}
            {puoScrivere && (
              <View style={styles.zonaAzioni}>
                <Text style={styles.nota}>
                  {atleta.status === "attiva"
                    ? "Se l'atleta lascia la squadra, archiviala: resta lo storico ma perde l'accesso all'app."
                    : "Questa atleta è archiviata: non ha accesso all'app. Ripristinandola torna in rosa (l'accesso va riattivato con un nuovo invito)."}
                </Text>
                {atleta.status === "attiva" ? (
                  <Pressable onPress={chiediArchiviazione} style={styles.pillSecondaria}><Text style={styles.pillSecondariaTesto}>Archivia atleta</Text></Pressable>
                ) : (
                  <Pressable onPress={chiediRipristino} style={styles.pillSecondaria}><Text style={styles.pillSecondariaTesto}>Ripristina atleta</Text></Pressable>
                )}
                <Pressable onPress={chiediEliminazione} style={styles.pillElimina} accessibilityLabel="Elimina definitivamente">
                  <Ionicons name="trash-outline" size={16} color={brand.colors.error} />
                  <Text style={styles.elimina}>Elimina definitivamente</Text>
                </Pressable>
              </View>
            )}
          </>
        ) : (
          <>
            {/* Ordine: identità, rendimento in sintesi (anelli, certificato,
                voto, azioni), anagrafica, carico e piani individuali.
                Il dettaglio per fondamentale e gli obiettivi si aprono
                a richiesta, per tenere la scheda compatta. */}
            <TitoloGrande titolo={`${atleta.nome} ${atleta.cognome}`} sottotitolo={sottotitolo || undefined} />

            <SchedaRendimento
              athleteId={atleta.id}
              nomeAtleta={`${atleta.nome} ${atleta.cognome}`}
              modificabile={puoScrivere}
              soloRiepilogo
              riquadroAccanto={
                <View style={styles.riquadro}>
                  <Text style={styles.etichettaRiquadro}>CERTIFICATO</Text>
                  <Text style={[styles.valoreRiquadro, { color: cert.colore }]}>{cert.valore}</Text>
                  <Text style={styles.notaRiquadro}>{cert.nota}</Text>
                </View>
              }
              sottoRiquadri={puoScrivere ? (
                <View style={styles.rigaPulsanti}>
                  <Pressable style={styles.pillPrimaria} onPress={() => setInModifica(true)}>
                    <Text style={styles.pillPrimariaTesto}>Modifica</Text>
                  </Pressable>
                </View>
              ) : undefined}
            />

            <Pressable onPress={() => setAnagraficaAperta(!anagraficaAperta)} style={styles.intestazioneSezione}>
              <Text style={styles.titoloSezione}>Anagrafica</Text>
              <Text style={styles.chevron}>{anagraficaAperta ? "▾" : "▸"}</Text>
            </Pressable>
            {anagraficaAperta && (
              <View style={styles.listaRaggruppata}>
                <RigaSolaLettura etichetta="Data di nascita" valore={atleta.data_nascita} />
                <RigaSolaLettura etichetta="Codice fiscale" valore={atleta.codice_fiscale} />
                <RigaSolaLettura etichetta="Numero di licenza" valore={atleta.numero_licenza} />
                <RigaSolaLettura etichetta="Scadenza certificato medico" valore={atleta.scadenza_certificato_medico} />
                <RigaSolaLettura etichetta="Telefono" valore={atleta.telefono} />
                <RigaSolaLettura etichetta="Email" valore={atleta.email_contatto} />
                <RigaSolaLettura etichetta="Note" valore={atleta.note_personali} ultima />
              </View>
            )}

            {puoScrivere && team && (
              <AccessoAtleta teamId={team.id} nomeSquadra={team.nome} atleta={atleta} />
            )}

            <TempoDiGiocoAtleta teamId={atleta.team_id} athleteId={atleta.id} mostraConfronto={puoScrivere || puoVedereAnalisi} />

            <CaricoAllenamento athleteId={atleta.id} />

            <Text style={[styles.titoloSezione, { marginTop: 12 }]}>Piani individuali</Text>
            {team && (
              <PianiIndividuali
                teamId={team.id}
                athleteId={atleta.id}
                nomePersona={`${atleta.nome} ${atleta.cognome}`}
                ruolo={atleta.ruolo_campo}
                modificabile={puoScrivere}
              />
            )}
          </>
        )}
       </View>
      </ScrollView>

    </View>
  );
}

function Campo({ etichetta, children }: { etichetta: string; children: React.ReactNode }) {
  return <View style={{ gap: 4 }}><Text style={styles.etichettaCampo}>{etichetta}</Text>{children}</View>;
}

function RigaSolaLettura({ etichetta, valore, ultima = false }: { etichetta: string; valore: string | null; ultima?: boolean }) {
  return (
    <>
      <View style={styles.rigaSolaLettura}>
        <Text style={styles.etichettaRiga}>{etichetta}</Text>
        <Text style={styles.valoreSolaLettura}>{valore || "—"}</Text>
      </View>
      {!ultima && <View style={styles.separatore} />}
    </>
  );
}

/** Scadenza del certificato medico: testo breve (gg/mm/aa), colore e nota in base ai giorni mancanti. */
function statoCertificato(scadenza: string | null): { valore: string; colore: string; nota: string } {
  if (!scadenza) return { valore: "—", colore: brand.colors.muted, nota: "non indicato" };
  const [a, m, g] = scadenza.slice(0, 10).split("-");
  const data = new Date(`${scadenza.slice(0, 10)}T00:00:00`);
  if (!a || !m || !g || isNaN(data.getTime())) return { valore: scadenza, colore: brand.colors.muted, nota: "data non valida" };
  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);
  const giorni = Math.round((data.getTime() - oggi.getTime()) / 86400000);
  const valore = `${g}/${m}/${a.slice(2)}`;
  if (giorni < 0) return { valore, colore: brand.colors.error, nota: "scaduto" };
  if (giorni <= 30) return { valore, colore: brand.colors.warning, nota: giorni === 0 ? "scade oggi" : `scade tra ${giorni} gg` };
  return { valore, colore: brand.colors.success, nota: "valido" };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { paddingHorizontal: 16, paddingTop: 8 },
  colonna: { width: "100%", maxWidth: 900, alignSelf: "center", gap: 12 },
  rigaHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44 },
  scroll: { padding: 16, paddingBottom: 48 },
  bersaglio: { minHeight: 44, justifyContent: "center" },
  indietro: { color: brand.colors.brand, fontWeight: "600", fontSize: 17 },
  zonaAzioni: { marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: brand.colors.border, gap: 10, alignItems: "flex-start" },
  nota: { color: brand.colors.muted, fontSize: 12 },
  pillElimina: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: brand.colors.error },
  pillSecondaria: { minHeight: 36, paddingHorizontal: 16, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  pillSecondariaTesto: { color: brand.colors.onSurface, fontWeight: "600", fontSize: 15 },
  elimina: { color: brand.colors.error, fontWeight: "600", fontSize: 15 },
  pillPrimaria: { flex: 1, minHeight: 42, borderRadius: 999, backgroundColor: brand.colors.brand, alignItems: "center", justifyContent: "center" },
  pillPrimariaTesto: { color: "#000", fontSize: 16, fontWeight: "700" },
  rigaPulsanti: { flexDirection: "row", gap: 10 },
  badgeArchiviata: { color: brand.colors.warning, fontWeight: "700", fontSize: 12 },
  riquadro: { flex: 1, backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, padding: 14, gap: 2 },
  etichettaRiquadro: { color: brand.colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  valoreRiquadro: { fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  notaRiquadro: { color: brand.colors.muted, fontSize: 12 },
  intestazioneSezione: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, marginTop: 12 },
  titoloSezione: { color: brand.colors.onSurface, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  chevron: { color: brand.colors.muted, fontSize: 16 },
  listaRaggruppata: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 18, overflow: "hidden" },
  rigaSolaLettura: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 16, paddingVertical: 12, paddingHorizontal: 16, minHeight: 44 },
  etichettaRiga: { color: brand.colors.onSurfaceSecondary, fontSize: 15 },
  valoreSolaLettura: { color: brand.colors.onSurface, fontSize: 15, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  separatore: { height: 1, backgroundColor: brand.colors.border, marginLeft: 16 },
  etichettaCampo: { color: brand.colors.muted, fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 },
  input: { backgroundColor: brand.colors.surfaceSecondary, color: brand.colors.onSurface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 44, fontSize: 16 },
  selettoreRiga: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 16, borderRadius: 999, backgroundColor: brand.colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  chipAttivo: { backgroundColor: brand.colors.brand },
  chipTesto: { color: brand.colors.onSurfaceSecondary, fontSize: 14 },
  chipTestoAttivo: { color: "#000", fontWeight: "700" },
  bottone: { backgroundColor: brand.colors.brand, minHeight: 42, paddingHorizontal: 16, borderRadius: 999, alignItems: "center", justifyContent: "center", marginTop: 8 },
  bottoneTesto: { color: "#000", fontWeight: "700", fontSize: 16 },
});
