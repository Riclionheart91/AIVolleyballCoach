import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Session } from "@supabase/supabase-js";
import { supabaseClient } from "@/src/lib/supabase";
import { supabase as cfg } from "@/src/config";
import { accettaInvitiPendenti } from "@/src/services/teamInvites";
import type { Ruolo, Season, Team } from "@/src/types/database";

const CHIAVE_ULTIMO_TEAM = "aivolleyballcoach:ultimo_team_id";

interface AuthState {
  session: Session | null;
  caricamento: boolean;
  team: Team | null;
  ruolo: Ruolo | null;
  /** Popolato solo se ruolo === "atleta": l'id della SUA scheda anagrafica. */
  atletaId: string | null;
  /** true per allenatore/vice_allenatore — unico gruppo con permessi di scrittura. */
  puoScrivere: boolean;
  /** true per presidente — accesso a tutto, ma in sola lettura ovunque. */
  soloLettura: boolean;
  /** true per il super-amministratore globale (vedi app_admins) — accesso trasversale a tutte le squadre. */
  isSuperuser: boolean;
  /** Tutte le squadre a cui l'utente appartiene (di solito una sola, ma un allenatore può seguirne più di una). */
  squadreDisponibili: { team: Team; ruolo: Ruolo; atletaId: string | null }[];
  cambiaSquadra: (teamId: string) => Promise<void>;
  // true finché non sappiamo ancora se l'utente ha un team — evita di
  // mostrare per un istante "nessuna squadra" mentre la query è in corso
  // (lo stesso tipo di falso allarme di "non riesco a caricare la
  // stagione" che nasceva, in GAS, da un errore di auth mascherato).
  caricamentoTeam: boolean;
  erroreTeam: string | null;
  stagioneAttiva: Season | null;
  caricamentoStagione: boolean;
  accediConGoogle: () => Promise<void>;
  esci: () => Promise<void>;
  creaPrimaSquadra: (nome: string) => Promise<void>;
  ricaricaTeam: () => Promise<void>;
  ricaricaStagione: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  const [team, setTeam] = useState<Team | null>(null);
  const [ruolo, setRuolo] = useState<Ruolo | null>(null);
  const [atletaId, setAtletaId] = useState<string | null>(null);
  const [squadreDisponibili, setSquadreDisponibili] = useState<{ team: Team; ruolo: Ruolo; atletaId: string | null }[]>([]);
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [caricamentoTeam, setCaricamentoTeam] = useState(true);
  const [erroreTeam, setErroreTeam] = useState<string | null>(null);
  const [stagioneAttiva, setStagioneAttiva] = useState<Season | null>(null);
  const [caricamentoStagione, setCaricamentoStagione] = useState(true);

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

  async function ricaricaTeam() {
    if (!session) {
      setTeam(null);
      setRuolo(null);
      setAtletaId(null);
      setSquadreDisponibili([]);
      setCaricamentoTeam(false);
      return;
    }
    setCaricamentoTeam(true);
    await accettaInvitiPendenti();

    const { data: appartenenze, error: erroreAppartenenze } = await supabaseClient
      .from("team_members")
      .select("team_id, ruolo, atleta_id")
      .eq("user_id", session.user.id);

    if (erroreAppartenenze) {
      console.warn("Errore nel caricamento delle squadre:", erroreAppartenenze.message);
      setErroreTeam(erroreAppartenenze.message);
      setTeam(null); setRuolo(null); setAtletaId(null); setSquadreDisponibili([]);
      setCaricamentoTeam(false);
      return;
    }
    if (!appartenenze || appartenenze.length === 0) {
      setErroreTeam(null);
      setTeam(null); setRuolo(null); setAtletaId(null); setSquadreDisponibili([]);
      setCaricamentoTeam(false);
      return;
    }

    // Query separata per i team, invece di un embedding annidato
    // (.select("teams(*)")): più robusta, non dipende dal fatto che
    // PostgREST riconosca correttamente la relazione al momento della
    // query, ed è più facile da diagnosticare se qualcosa va storto.
    const { data: teamsTrovati, error: erroreTeams } = await supabaseClient
      .from("teams")
      .select("*")
      .in("id", appartenenze.map((a) => a.team_id));

    if (erroreTeams || !teamsTrovati) {
      console.warn("Errore nel caricamento dei dati squadra:", erroreTeams?.message);
      setErroreTeam(erroreTeams?.message ?? "Squadre non trovate");
      setTeam(null); setRuolo(null); setAtletaId(null); setSquadreDisponibili([]);
      setCaricamentoTeam(false);
      return;
    }

    const opzioni: { team: Team; ruolo: Ruolo; atletaId: string | null }[] = appartenenze
      .map((a) => {
        const t = teamsTrovati.find((tt) => tt.id === a.team_id);
        return t ? { team: t, ruolo: a.ruolo as Ruolo, atletaId: (a.atleta_id as string | null) ?? null } : null;
      })
      .filter((x): x is { team: Team; ruolo: Ruolo; atletaId: string | null } => x !== null);

    setSquadreDisponibili(opzioni);
    setErroreTeam(null);

    const ultimoId = await AsyncStorage.getItem(CHIAVE_ULTIMO_TEAM);
    const scelta = opzioni.find((o) => o.team.id === ultimoId) ?? opzioni[0];
    setTeam(scelta.team);
    setRuolo(scelta.ruolo);
    setAtletaId(scelta.atletaId);
    setCaricamentoTeam(false);
  }

  async function cambiaSquadra(teamId: string) {
    const scelta = squadreDisponibili.find((o) => o.team.id === teamId);
    if (!scelta) return;
    setTeam(scelta.team);
    setRuolo(scelta.ruolo);
    setAtletaId(scelta.atletaId);
    await AsyncStorage.setItem(CHIAVE_ULTIMO_TEAM, teamId);
  }

  async function ricaricaStagione() {
    if (!team) {
      setStagioneAttiva(null);
      setCaricamentoStagione(false);
      return;
    }
    setCaricamentoStagione(true);
    const { data, error } = await supabaseClient.from("seasons").select("*").eq("team_id", team.id).eq("stato", "attiva").maybeSingle();
    if (error) console.warn("Errore nel caricamento della stagione attiva:", error.message);
    setStagioneAttiva(data ?? null);
    setCaricamentoStagione(false);
  }

  useEffect(() => {
    ricaricaTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  useEffect(() => {
    ricaricaStagione();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id]);

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
    const { data, error } = await supabaseClient.rpc("crea_team_e_diventa_allenatore", { p_nome: nome });
    if (error) throw error;
    // Scrive subito la preferenza in AsyncStorage, PRIMA di ricaricaTeam():
    // se chiamassimo invece cambiaSquadra() dopo, leggerebbe
    // squadreDisponibili dalla chiusura di questa funzione, che è ancora
    // quella di PRIMA della creazione (gli aggiornamenti di stato React
    // non sono sincroni) — non troverebbe la squadra appena creata e non
    // farebbe nulla. Così invece ricaricaTeam() la trova da sé, perché
    // legge AsyncStorage e ricalcola le opzioni da zero dal database.
    if (data) await AsyncStorage.setItem(CHIAVE_ULTIMO_TEAM, data as string);
    await ricaricaTeam();
  }

  const puoScrivere = ruolo === "allenatore" || ruolo === "vice_allenatore";
  const soloLettura = ruolo === "presidente";

  const value = useMemo<AuthState>(
    () => ({
      session, caricamento, team, ruolo, atletaId, puoScrivere, soloLettura, isSuperuser,
      squadreDisponibili, cambiaSquadra, caricamentoTeam, erroreTeam,
      stagioneAttiva, caricamentoStagione,
      accediConGoogle, esci, creaPrimaSquadra, ricaricaTeam, ricaricaStagione,
    }),
    [session, caricamento, team, ruolo, atletaId, isSuperuser, squadreDisponibili, caricamentoTeam, erroreTeam, stagioneAttiva, caricamentoStagione],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve essere usato dentro <AuthProvider>");
  return ctx;
}
