import { useEffect, useState } from "react";
import { Text, StyleSheet } from "react-native";
import { brand } from "@/src/config";
import { elencaScoutAnonimi, type ScoutAnonimo } from "@/src/services/scoutQr";

/**
 * Per lo staff: chi si e' collegato con il QR e chi sta registrando adesso.
 * Si aggiorna da solo; se non si ha il permesso (non e' staff) non mostra niente.
 */
export function IndicatoreScoutQr({ matchId, ogniMs = 8000 }: { matchId: string; ogniMs?: number }) {
  const [scout, setScout] = useState<ScoutAnonimo[]>([]);

  useEffect(() => {
    let attivo = true;
    const leggi = () => elencaScoutAnonimi(matchId).then((l) => { if (attivo) setScout(l); }).catch(() => { if (attivo) setScout([]); });
    leggi();
    const timer = setInterval(leggi, ogniMs);
    return () => { attivo = false; clearInterval(timer); };
  }, [matchId, ogniMs]);

  const collegati = scout.filter((s) => !s.escluso);
  if (collegati.length === 0) return null;
  const inCampo = collegati.find((s) => s.ha_turno);

  return inCampo ? (
    <Text style={[styles.testo, styles.attivo]} numberOfLines={1}>🟢 {inCampo.nome} sta registrando{collegati.length > 1 ? ` · +${collegati.length - 1} collegat${collegati.length - 1 === 1 ? "o" : "i"}` : ""}</Text>
  ) : (
    <Text style={styles.testo} numberOfLines={1}>👁 {collegati.map((s) => s.nome).join(", ")} collegat{collegati.length === 1 ? "o" : "i"} · nessuno sta registrando</Text>
  );
}

const styles = StyleSheet.create({
  testo: { color: brand.colors.muted, fontSize: 12, fontWeight: "600" },
  attivo: { color: brand.colors.success },
});
