import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Session } from "@supabase/supabase-js";
import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";
import { accettaInvitiPendenti } from "@/src/services/teamInvites";
import { miaSocietaPresidenza, type MiaSocieta } from "@/src/services/societa";
import type { Ruolo, Season, Team } from "@/src/types/database";

const CHIAVE_ULTIMO_TEAM = "aivolleyballcoach:ultimo_team_id";

interface RigaContesto {
  team_id: string;
  team_nome: string;
  team_creato_il: string;
  team_societa_id: string | null;
  ruolo: Ruolo;
  atleta_id: string | null;
  stagione_id: string | null;
  stagione_nome: string | null;
  stagione_stato: string | null;
  /** Esiste una stagione attiva per la società, a prescindere dal fatto che QUESTA squadra sia stata attivata. */
  stagione_societa_esiste: boolean;
  /** Vero solo se la stagione di società è attiva E questa squadra è stata confermata dal presidente per essa. */
  stagione_aperta: boolean;
}

interface SquadraDisponibile {
  team: Team;
  ruolo: Ruolo;
  atletaId: string | null;
}

interface AuthState {
  session: Session | null;
  caricamento: boolean;
  team: Team | null;
  ruolo: Ruolo | null;
  /** Popolato solo se ruolo === "atleta": l'id della SUA scheda anagrafica. */
  atletaId: string | null;
  puoScrivere: boolean;
  soloLettura: boolean;
  /** Può registrare azioni durante un set (staff tecnico o profilo scout), ma non necessariamente gestire la partita. */
  puoScoutare: boolean;
  /** Le funzioni AI sono riservate allo staff: allenatore, vice e presidente. */
  puoUsareAI: boolean;
  /** Aprire, attivare e chiudere una stagione: riservato al presidente. */
  puoGestireStagioni: boolean;
  isSuperuser: boolean;
  /** Se si è presidente di una società, questa: null altrimenti. Va controllata anche senza squadre (società appena fondata). */
  societaPresidenza: MiaSocieta | null;
  /** Finché true, non è ancora certo se la persona sia presidente: chi decide le rotte deve aspettare, non presumere "no". */
  caricamentoSocieta: boolean;
  squadreDisponibili: SquadraDisponibile[];
  cambiaSquadra: (teamId: string) => Promise<void>;
  /**
   * UNICO flag di caricamento per squadra+stagione insieme (prima erano
   * due flag separati con due effetti React indipendenti — la causa
   * della race condition descritta in 0001f_contesto_team.sql). Finché
   * questo è true, nessuna schermata deve decidere se mostrare "crea
   * squadra" o "apri stagione": lo stato è ancora incerto.
   */
  caricamentoContesto: boolean;
  erroreTeam: string | null;
  stagioneAttiva: Season | null;
  /** Esiste una stagione attiva per la società della squadra corrente, anche se questa squadra non è ancora stata attivata per essa. */
  stagioneSocietaEsiste: boolean;
  /** Questa squadra è stata confermata dal presidente per la stagione corrente (equivale a stagioneAttiva !== null, esposto a parte per leggibilità). */
  squadraAttivata: boolean;
  accediConGoogle: () => Promise<void>;
  esci: () => Promise<void>;
  creaPrimaSquadra: (nome: string) => Promise<void>;
  ricaricaContesto: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  const [team, setTeam] = useState<Team | null>(null);
  const [ruolo, setRuolo] = useState<Ruolo | null>(null);
  const [atletaId, setAtletaId] = useState<string | null>(null);
  const [squadreDisponibili, setSquadreDisponibili] = useState<SquadraDisponibile[]>([]);
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [societaPresidenza, setSocietaPresidenza] = useState<MiaSocieta | null>(null);
  const [caricamentoSocieta, setCaricamentoSocieta] = useState(true);
  const [caricamentoContesto, setCaricamentoContesto] = useState(true);
  const [erroreTeam, setErroreTeam] = useState<string | null>(null);
  const [stagioneAttiva, setStagioneAttiva] = useState<Season | null>(null);
  const [stagioneSocietaEsiste, setStagioneSocietaEsiste] = useState(false);

  useEffect(() => {
    supabaseClient.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCaricamento(false);
    });
    const { data: sub } = supabaseClient.auth.onAuthStateChange((_event, nuovaSessione) => {
      setSession(nuovaSessione);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setIsSuperuser(false); return; }
    supabaseClient.rpc("sono_superuser").then(({ data, error }) => {
      if (!error) setIsSuperuser(Boolean(data));
    });
  }, [session?.user.id]);

  useEffect(() => {
    if (!session) { setSocietaPresidenza(null); setCaricamentoSocieta(false); return; }
    setCaricamentoSocieta(true);
    miaSocietaPresidenza()
      .then(setSocietaPresidenza)
      .catch(() => setSocietaPresidenza(null))
      .finally(() => setCaricamentoSocieta(false));
  }, [session?.user.id]);

  /**
   * Unico punto di caricamento per squadra+stagione. Una sola chiamata
   * RPC (mio_contesto_team), un solo giro di setState — non ci sono più
   * due effetti indipendenti che possono disallinearsi a metà strada.
   */
  async function ricaricaContesto() {
    if (!session) {
      setTeam(null); setRuolo(null); setAtletaId(null);
      setSquadreDisponibili([]); setStagioneAttiva(null); setStagioneSocietaEsiste(false);
      setCaricamentoContesto(false);
      return;
    }

    setCaricamentoContesto(true);
    await accettaInvitiPendenti();

    const { data, error } = await supabaseClient.rpc("mio_contesto_team");

    if (error) {
      console.warn("Errore nel caricamento del contesto squadra:", error.message);
      setErroreTeam(error.message);
      setTeam(null); setRuolo(null); setAtletaId(null);
      setSquadreDisponibili([]); setStagioneAttiva(null); setStagioneSocietaEsiste(false);
      setCaricamentoContesto(false);
      return;
    }

    const righe = (data ?? []) as RigaContesto[];
    setErroreTeam(null);

    if (righe.length === 0) {
      setTeam(null); setRuolo(null); setAtletaId(null);
      setSquadreDisponibili([]); setStagioneAttiva(null); setStagioneSocietaEsiste(false);
      setCaricamentoContesto(false);
      return;
    }

    // Una riga per squadra (già ordinate per data di creazione dalla
    // RPC stessa: niente più dipendenza dall'ordine, non garantito, con
    // cui il database potrebbe restituire i risultati).
    const opzioni: SquadraDisponibile[] = righe.map((r) => ({
      team: { id: r.team_id, nome: r.team_nome, creato_il: r.team_creato_il, creato_da: null, societaId: r.team_societa_id },
      ruolo: r.ruolo,
      atletaId: r.atleta_id,
    }));
    setSquadreDisponibili(opzioni);

    const ultimoId = await AsyncStorage.getItem(CHIAVE_ULTIMO_TEAM);
    const rigaScelta = righe.find((r) => r.team_id === ultimoId) ?? righe[0];

    setTeam(opzioni.find((o) => o.team.id === rigaScelta.team_id)!.team);
    setRuolo(rigaScelta.ruolo);
    setAtletaId(rigaScelta.atleta_id);
    setStagioneSocietaEsiste(rigaScelta.stagione_societa_esiste);
    setStagioneAttiva(
      rigaScelta.stagione_aperta && rigaScelta.stagione_id
        ? { id: rigaScelta.stagione_id, societa_id: rigaScelta.team_societa_id ?? "", nome: rigaScelta.stagione_nome!, stato: "attiva", data_apertura: "", data_chiusura: null, creata_il: "", creata_da: null }
        : null,
    );
    setCaricamentoContesto(false);
  }

  useEffect(() => {
    ricaricaContesto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  async function accediConGoogle() {
    await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: cfg.authRedirectUrl },
    });
  }

  async function esci() {
    await supabaseClient.auth.signOut();
  }

  async function creaPrimaSquadra(nome: string) {
    if (!societaPresidenza) throw new Error("Solo il presidente di una società può creare una squadra.");
    const { data, error } = await supabaseClient.rpc("crea_squadra_in_societa", { p_nome: nome, p_societa_id: societaPresidenza.societa_id });
    if (error) throw error;
    if (data) await AsyncStorage.setItem(CHIAVE_ULTIMO_TEAM, data as string);
    await ricaricaContesto();
  }

  async function cambiaSquadra(teamId: string) {
    await AsyncStorage.setItem(CHIAVE_ULTIMO_TEAM, teamId);
    await ricaricaContesto();
  }

  /**
   * Un presidente può anche avere un ruolo diretto sulla squadra che sta
   * guardando (es. è anche giocatore o allenatore di una delle squadre
   * della propria società): in quel caso `ruolo` riflette il ruolo
   * diretto (es. "allenatore"), non "presidente". I permessi da
   * presidente vanno comunque riconosciuti per QUALSIASI squadra della
   * propria società, non solo quando la riga corrente ha ruolo
   * letteralmente "presidente" (caso raggiunto solo tramite il ramo
   * sintetico, cioè quando non si ha nessun'altra riga diretta su quella
   * squadra).
   */
  const ePresidenteDiQuestaSquadra =
    ruolo === "presidente" || (!!societaPresidenza && !!team?.societaId && team.societaId === societaPresidenza.societa_id);

  const puoScrivere = ruolo === "allenatore" || ruolo === "vice_allenatore";
  const puoScoutare = puoScrivere;
  const puoUsareAI = puoScrivere || ePresidenteDiQuestaSquadra;
  const soloLettura = ruolo === "presidente";
  /** Aprire, attivare e chiudere una stagione: riservato al presidente, non più all'allenatore. */
  const puoGestireStagioni = ePresidenteDiQuestaSquadra;

  const value = useMemo<AuthState>(
    () => ({
      session, caricamento, team, ruolo, atletaId, puoScrivere, soloLettura, puoScoutare, puoUsareAI, puoGestireStagioni, isSuperuser,
      societaPresidenza, caricamentoSocieta, squadreDisponibili, cambiaSquadra, caricamentoContesto, erroreTeam, stagioneAttiva, stagioneSocietaEsiste,
      squadraAttivata: stagioneAttiva !== null,
      accediConGoogle, esci, creaPrimaSquadra, ricaricaContesto,
    }),
    [session, caricamento, team, ruolo, atletaId, isSuperuser, societaPresidenza, caricamentoSocieta, squadreDisponibili, caricamentoContesto, erroreTeam, stagioneAttiva, stagioneSocietaEsiste],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve essere usato dentro <AuthProvider>");
  return ctx;
}
