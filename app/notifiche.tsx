import { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { calcolaNotifiche, type Notifica } from "@/src/services/notifiche";
import { brand } from "@/src/config";
import { RinvioPromemoria } from "@/src/components/RinvioPromemoria";
import { MessaggioWhatsApp } from "@/src/components/MessaggioWhatsApp";
import { promemoriaCertificato } from "@/src/lib/messaggiWhatsApp";

export default function CentroNotifiche() {
  const { team, puoScrivere } = useAuth();
  const [notifiche, setNotifiche] = useState<Notifica[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [whatsapp, setWhatsapp] = useState<Notifica | null>(null);

  const carica = useCallback(async () => {
    if (!team) return;
    setCaricamento(true);
    try {
      setNotifiche(await calcolaNotifiche(team.id, puoScrivere));
    } finally {
      setCaricamento(false);
    }
  }, [team, puoScrivere]);

  useFocusEffect(useCallback(() => { carica(); }, [carica]));

  function apri(n: Notifica) {
    if (n.link) router.push(n.link as never);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.indietro}>← Indietro</Text></Pressable>
        <Text style={styles.titolo}>Notifiche</Text>
      </View>

      {caricamento ? (
        <ActivityIndicator color={brand.colors.brand} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={notifiche}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          ListEmptyComponent={<Text style={styles.vuoto}>Nessuna notifica al momento.</Text>}
          renderItem={({ item }) => (
            <Pressable style={[styles.riga, item.urgente && styles.rigaUrgente]} onPress={() => apri(item)} disabled={!item.link}>
              <Text style={[styles.rigaTitolo, item.urgente && styles.rigaTitoloUrgente]}>{item.urgente ? "⚠ " : ""}{item.titolo}</Text>
              <Text style={styles.rigaDescrizione}>{item.descrizione}</Text>
              {team && (item.tipo === "ciclo_valutazione" || item.tipo === "piano_annuale") && (
                <RinvioPromemoria teamId={team.id} tipo={item.tipo === "ciclo_valutazione" ? "valutazioni" : "piano_annuale"} onCambiato={carica} />
              )}
              {item.tipo === "certificato_medico" && item.atleta && (
                <Pressable style={styles.bottoneWhatsapp} onPress={() => setWhatsapp(item)} hitSlop={6}>
                  <Text style={styles.bottoneWhatsappTesto}>💬 Avvisa su WhatsApp</Text>
                </Pressable>
              )}
            </Pressable>
          )}
        />
      )}

      {team && whatsapp?.atleta && whatsapp.scadenza && (
        <MessaggioWhatsApp
          visibile
          titolo={`Certificato — ${whatsapp.atleta.nome} ${whatsapp.atleta.cognome}`}
          atleta={whatsapp.atleta}
          modelli={[{ etichetta: "Certificato", testo: promemoriaCertificato(team.nome, whatsapp.scadenza) }]}
          onChiudi={() => setWhatsapp(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, borderBottomWidth: 1, borderBottomColor: brand.colors.border },
  indietro: { color: brand.colors.brand, fontWeight: "700", fontSize: 15 },
  titolo: { color: brand.colors.onSurface, fontSize: 17, fontWeight: "700" },
  vuoto: { color: brand.colors.muted, textAlign: "center", marginTop: 32 },
  riga: { backgroundColor: brand.colors.surfaceSecondary, borderRadius: 10, padding: 12, gap: 4 },
  rigaUrgente: { borderWidth: 1, borderColor: brand.colors.error },
  rigaTitolo: { color: brand.colors.onSurface, fontWeight: "700", fontSize: 14 },
  rigaTitoloUrgente: { color: brand.colors.error },
  bottoneWhatsapp: { alignSelf: "flex-start", marginTop: 6, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: brand.colors.brandSecondary },
  bottoneWhatsappTesto: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "600" },
  rigaDescrizione: { color: brand.colors.onSurfaceSecondary, fontSize: 13 },
});
