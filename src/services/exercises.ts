import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";
import { istruzioniAggiuntive } from "@/src/services/pianoAnnuale";
import type { Exercise } from "@/src/types/database";

export async function elencaEsercizi(teamId: string): Promise<Exercise[]> {
  const { data, error } = await supabaseClient.from("exercises").select("*").eq("team_id", teamId).order("nome");
  if (error) throw error;
  return data ?? [];
}

export async function creaEsercizio(teamId: string, input: Pick<Exercise, "nome" | "categoria" | "descrizione">): Promise<Exercise> {
  const { data, error } = await supabaseClient.from("exercises").insert({ team_id: teamId, ...input }).select().single();
  if (error) throw error;
  return data;
}

export async function leggiEsercizio(id: string): Promise<Exercise> {
  const { data, error } = await supabaseClient.from("exercises").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function aggiornaEsercizio(id: string, input: Partial<Pick<Exercise, "nome" | "categoria" | "descrizione">>): Promise<Exercise> {
  const { data, error } = await supabaseClient.from("exercises").update(input).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function eliminaEsercizio(id: string): Promise<void> {
  const { error } = await supabaseClient.from("exercises").delete().eq("id", id);
  if (error) throw error;
}

export interface EsercizioProposto {
  nome: string;
  categoria: string;
  descrizione: string;
}

export interface RisultatoGenerazioneEsercizi {
  errore: boolean;
  messaggio?: string;
  esercizi?: EsercizioProposto[];
}

/**
 * Propone nuovi esercizi da aggiungere al catalogo. I nomi già
 * presenti vengono passati all'AI e le proposte duplicate scartate:
 * senza questo accorgimento il catalogo si riempie di varianti quasi
 * identiche dello stesso esercizio, che è esattamente ciò che rende
 * poi illeggibile l'elenco.
 */
export interface ContestoGenerazione {
  /** Blocco del piano annuale in cui si sta lavorando: gli esercizi seguiranno i suoi obiettivi. */
  periodo?: { nome: string; tipo: string; obiettivi_tecnici: string; obiettivi_fisici: string; obiettivi_tattici: string } | null;
  /** Ruolo su cui concentrarsi ("Palleggiatore", "Centrale"...): utile per i lavori a gruppi per ruolo. */
  ruolo?: string | null;
  /** Atleta specifica con le sue carenze: genera esercizi correttivi individuali. */
  atleta?: { nome: string; ruolo: string | null; carenze: { fondamentale: string; media: number }[] } | null;
  /** Momento della seduta: in riscaldamento gli esercizi individuali correttivi trovano spazio naturale. */
  fase?: "riscaldamento" | "tecnica" | "qualsiasi";
}

export async function generaEserciziAI(
  teamId: string,
  categoria: string,
  quanti: number,
  esistenti: Exercise[],
  istruzioniExtra?: string,
  contesto?: ContestoGenerazione,
): Promise<RisultatoGenerazioneEsercizi> {
  const nomiEsistenti = esistenti.map((e) => e.nome);

  const bloccoPeriodo = contesto?.periodo
    ? `Periodo della stagione: "${contesto.periodo.nome}" (${contesto.periodo.tipo.replace(/_/g, " ")}). ` +
      `Obiettivi del periodo — tecnici: ${contesto.periodo.obiettivi_tecnici || "non indicati"}; fisici: ${contesto.periodo.obiettivi_fisici || "non indicati"}; tattici: ${contesto.periodo.obiettivi_tattici || "non indicati"}. ` +
      `Gli esercizi devono essere coerenti con questo periodo (in uno di scarico riduci volume e intensità).\n`
    : "";

  const bloccoRuolo = contesto?.ruolo
    ? `Esercizi destinati a un gruppo di sole ${contesto.ruolo}: devono allenare competenze specifiche di quel ruolo, non generiche.\n`
    : "";

  const bloccoAtleta = contesto?.atleta
    ? `Esercizi CORRETTIVI INDIVIDUALI per ${contesto.atleta.nome}` +
      (contesto.atleta.ruolo ? ` (${contesto.atleta.ruolo})` : "") + ". " +
      `Punti deboli rilevati dalle valutazioni: ${contesto.atleta.carenze.map((c) => `${c.fondamentale} (media ${c.media}/10)`).join(", ")}. ` +
      `Gli esercizi devono aggredire proprio queste carenze, essere svolgibili individualmente o in coppia, e richiedere poco spazio e poca attrezzatura.\n`
    : "";

  const bloccoFase = contesto?.fase === "riscaldamento"
    ? `Devono poter essere svolti in RISCALDAMENTO: progressivi, a bassa intensità iniziale, senza carichi massimali né salti ripetuti a freddo.\n`
    : contesto?.fase === "tecnica"
      ? `Devono collocarsi nella parte di allenamento tecnico specifico, a intensità piena.\n`
      : "";

  const prompt =
    `Sei un allenatore di pallavolo. Proponi ${quanti} esercizi nuovi per la categoria "${categoria}".\n` +
    bloccoPeriodo + bloccoRuolo + bloccoAtleta + bloccoFase +
    (nomiEsistenti.length > 0
      ? `Il catalogo contiene già questi esercizi, NON riproporli né proporne varianti quasi identiche:\n${nomiEsistenti.join(" | ")}\n\n`
      : "") +
    `Rispondi SOLO con JSON, senza altro testo:\n` +
    `{"esercizi":[{"nome":"...","categoria":"${categoria}","descrizione":"come si svolge, in 2-3 frasi: disposizione, obiettivo, criterio di riuscita"}]}` +
    istruzioniAggiuntive(istruzioniExtra);

  const { data: sessione } = await supabaseClient.auth.getSession();
  if (!sessione.session) return { errore: true, messaggio: "Sessione scaduta, effettua di nuovo l'accesso." };

  const { data, error } = await supabaseClient.functions.invoke(cfg.aiRouterFunction, { body: { team_id: teamId, prompt } });
  if (error) return { errore: true, messaggio: error.message };
  if (data.errore) {
    return { errore: true, messaggio: [data.messaggio, data.dettagli, (data.chiaviMancanti ?? []).length ? `Chiavi non configurate: ${(data.chiaviMancanti ?? []).join(", ")}` : ""].filter(Boolean).join("\n\n") };
  }

  try {
    const pulito = String(data.testo).trim().replace(/^```json\s*|```$/g, "");
    const parsed = JSON.parse(pulito);
    const normalizza = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
    const giaPresenti = new Set(nomiEsistenti.map(normalizza));

    const esercizi: EsercizioProposto[] = (parsed.esercizi ?? [])
      .filter((e: Record<string, unknown>) => e.nome)
      .map((e: Record<string, unknown>) => ({
        nome: String(e.nome).trim(),
        categoria: String(e.categoria ?? categoria).trim() || categoria,
        descrizione: String(e.descrizione ?? "").trim(),
      }))
      .filter((e: EsercizioProposto) => !giaPresenti.has(normalizza(e.nome)));

    if (esercizi.length === 0) return { errore: true, messaggio: "Nessuna proposta nuova: l'AI ha suggerito solo esercizi già presenti nel catalogo." };
    return { errore: false, esercizi };
  } catch {
    return { errore: true, messaggio: "Risposta AI non nel formato atteso." };
  }
}

export interface CarenzaAtleta {
  fondamentale: string;
  media: number;
  numero_valutazioni: number;
}

/** Fondamentali più deboli di un'atleta, dalle valutazioni degli ultimi 4 mesi. */
export async function carenzeAtleta(athleteId: string, quante = 3): Promise<CarenzaAtleta[]> {
  const { data, error } = await supabaseClient.rpc("carenze_atleta", { p_athlete_id: athleteId, p_quante: quante });
  if (error) throw error;
  return data ?? [];
}
