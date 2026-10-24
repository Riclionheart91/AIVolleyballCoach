import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { brand } from "@/src/config";
import { avvisa } from "@/src/lib/confermaAzione";
import { dataProssimoCiclo, formattaData, leggiRinvii, rinviaPromemoria, rinvioAttivo, rinvioDi, type RinviiPromemoria, type TipoPromemoria } from "@/src/services/promemoria";

/**
 * Pulsante per rinviare un promemoria alla data del ciclo successivo (oggi + cadenza).
 * Se il promemoria e' gia' rinviato mostra la data e permette di riattivarlo subito.
 */
export function RinvioPromemoria({ teamId, tipo, onCambiato }: { teamId: string; tipo: TipoPromemoria; onCambiato?: () => void }) {
  const [rinvii, setRinvii] = useState<RinviiPromemoria | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const carica = useCallback(() => { leggiRinvii(teamId).then(setRinvii).catch(() => setRinvii(null)); }, [teamId]);
  useEffect(() => { carica(); }, [carica]);

  async function applica(finoA: string | null) {
    setInCorso(true);
    try {
      await rinviaPromemoria(teamId, tipo, finoA);
      carica();
      onCambiato?.();
    } catch (e) {
      avvisa("Rinvio non riuscito", (e as Error).message);
    } finally {
      setInCorso(false);
    }
  }

  const attuale = rinvioDi(tipo, rinvii);

  if (rinvioAttivo(attuale)) {
    return (
      <View style={styles.riga}>
        <Text style={styles.testo}>⏭ Promemoria rinviato al {formattaData(attuale!)}</Text>
        <Pressable onPress={() => applica(null)} disabled={inCorso} hitSlop={8}><Text style={styles.link}>Riattiva ora</Text></Pressable>
      </View>
    );
  }

  const prossima = dataProssimoCiclo(tipo, rinvii);
  return (
    <Pressable style={styles.bottone} onPress={() => applica(prossima)} disabled={inCorso} hitSlop={6}>
      <Text style={styles.bottoneTesto}>⏭ Rinvia al {formattaData(prossima)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bottone: { alignSelf: "flex-start", marginTop: 6, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: brand.colors.brandSecondary },
  bottoneTesto: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "700" },
  riga: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 6 },
  testo: { color: brand.colors.muted, fontSize: 12 },
  link: { color: brand.colors.brandSecondary, fontSize: 12, fontWeight: "700" },
});
