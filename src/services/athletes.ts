import { supabaseClient } from "@/src/lib/supabase";
import { ruoliCampo } from "@/src/config";
import type { Athlete, RuoloCampo } from "@/src/types/database";

export async function elencaAtlete(teamId: string): Promise<Athlete[]> {
  const { data, error } = await supabaseClient
    .from("athletes")
    .select("*")
    .eq("team_id", teamId)
    .eq("status", "attiva")
    .order("cognome");
  if (error) throw error;
  return data ?? [];
}

export async function creaAtleta(
  teamId: string,
  input: Pick<Athlete, "nome" | "cognome" | "numero_maglia" | "data_nascita"> & { ruolo_campo: RuoloCampo | null },
): Promise<Athlete> {
  const { data, error } = await supabaseClient.from("athletes").insert({ team_id: teamId, ...input }).select().single();
  if (error) throw error;
  return data;
}

/** Solo allenatore/vice: modifica i campi "assegnati dalla società" (mai i contatti, quelli li tocca solo l'atleta con aggiornaMioContatto). */
export async function aggiornaAtleta(
  atletaId: string,
  input: Partial<Pick<Athlete, "nome" | "cognome" | "numero_maglia" | "data_nascita" | "ruolo_campo">>,
): Promise<Athlete> {
  const { data, error } = await supabaseClient.from("athletes").update(input).eq("id", atletaId).select().single();
  if (error) throw error;
  return data;
}

export async function archiviaAtleta(atletaId: string): Promise<void> {
  const { error } = await supabaseClient.from("athletes").update({ status: "archiviata" }).eq("id", atletaId);
  if (error) throw error;
}

/** L'atleta aggiorna solo i propri dati di contatto — mai ruolo_campo/numero_maglia/status, che restano decisioni dell'allenatore (RPC lato server lo impone comunque, questo è solo il wrapper client). */
export async function aggiornaMioContatto(teamId: string, telefono: string, emailContatto: string, notePersonali: string): Promise<void> {
  const { error } = await supabaseClient.rpc("aggiorna_mio_contatto", {
    p_team_id: teamId,
    p_telefono: telefono,
    p_email_contatto: emailContatto,
    p_note_personali: notePersonali,
  });
  if (error) throw error;
}

export interface RigaImportAtleta {
  numeroRiga: number;
  nome: string;
  cognome: string;
  ok: boolean;
  errore?: string;
}

/**
 * Import massivo da testo CSV incollato (non da file, per restare
 * identico su web e nativo senza dipendenze aggiuntive di file-picking).
 * Formato atteso, una atleta per riga: Nome,Cognome,RuoloCampo,NumeroMaglia
 * — RuoloCampo e NumeroMaglia sono opzionali (si può lasciare vuoto).
 * Non si ferma al primo errore: prova tutte le righe e ritorna un
 * riepilogo riga per riga, così un'unica riga malformata non blocca le
 * altre 20 già corrette.
 */
export async function importaAtleteCsv(teamId: string, testoCsv: string): Promise<RigaImportAtleta[]> {
  const righe = testoCsv.split("\n").map((r) => r.trim()).filter((r) => r.length > 0);
  const risultati: RigaImportAtleta[] = [];

  for (let i = 0; i < righe.length; i++) {
    const numeroRiga = i + 1;
    const colonne = righe[i].split(",").map((c) => c.trim());
    const [nome, cognome, ruoloCampoTesto, numeroMagliaTesto] = colonne;

    if (!nome || !cognome) {
      risultati.push({ numeroRiga, nome: nome ?? "", cognome: cognome ?? "", ok: false, errore: "Nome e cognome sono obbligatori" });
      continue;
    }

    const ruoloCampo = (ruoliCampo as readonly string[]).includes(ruoloCampoTesto) ? (ruoloCampoTesto as RuoloCampo) : null;
    const numeroMaglia = numeroMagliaTesto && !Number.isNaN(Number(numeroMagliaTesto)) ? Number(numeroMagliaTesto) : null;

    try {
      await creaAtleta(teamId, { nome, cognome, ruolo_campo: ruoloCampo, numero_maglia: numeroMaglia, data_nascita: null });
      risultati.push({ numeroRiga, nome, cognome, ok: true });
    } catch (e) {
      risultati.push({ numeroRiga, nome, cognome, ok: false, errore: (e as Error).message });
    }
  }

  return risultati;
}
