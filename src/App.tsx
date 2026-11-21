import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FullTimeModal } from './components/FullTimeModal';
import { GameCanvas, TouchInputRef } from './components/GameCanvas';
import { HudOverlay } from './components/HudOverlay';
import { PauseModal } from './components/PauseModal';
import { TeamSelectScreen } from './components/TeamSelectScreen';
import { TitleOverlay } from './components/TitleOverlay';
import { TouchControls } from './components/TouchControls';
import { TournamentScreen } from './components/TournamentScreen';
import { soundEngine } from './game/audio';
import { Difficulty, HudSnapshot, MatchMode, TeamConfig } from './game/constants';
import { DEFAULT_KEYBOARD_SOURCE, InputSourceInfo } from './game/controller';
import { NATIONAL_TEAMS } from './game/teams';
import {
  createWorldCupTournament,
  recordTournamentMatchResult,
  TournamentMatch,
  TournamentState,
} from './game/tournament';

type ScreenState = 'title' | 'team_select' | 'tournament' | 'playing' | 'paused' | 'gameover';

const INITIAL_HUD: HudSnapshot = {
  homeScore: 0,
  awayScore: 0,
  clockSeconds: 0,
  half: 1,
  phase: 'kickoff',
  activeStamina: 1,
  activeNumber: 10,
  shotPower: 0,
  isChargingShot: false,
  banner: null,
  refereeChasing: false,
  stats: {
    homeShots: 0,
    awayShots: 0,
    homeCurveShots: 0,
    awayCurveShots: 0,
    homeTackles: 0,
    awayTackles: 0,
    homeCards: 0,
    awayCards: 0,
    homePossessionTime: 0,
    awayPossessionTime: 0,
  },
  penalty: null,
  crowdExcitement: 0.25,
  isBallCurving: false,
};

export function App() {
  const initialCorner = useMemo(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('corner') === '1',
    [],
  );
  const initialThrowIn = useMemo(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('throwin') === '1',
    [],
  );
  const autostart = useMemo(
    () =>
      initialCorner ||
      initialThrowIn ||
      (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('autostart') === '1'),
    [initialCorner, initialThrowIn],
  );

  const [screen, setScreen] = useState<ScreenState>(autostart ? 'playing' : 'title');
  const [matchMode, setMatchMode] = useState<MatchMode>(autostart ? 'quick' : 'attract');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [matchKey, setMatchKey] = useState(1);

  const [teams, setTeams] = useState<TeamConfig[]>(() => NATIONAL_TEAMS.map((t) => ({ ...t })));
  const [homeTeamId, setHomeTeamId] = useState('bra');
  const [awayTeamId, setAwayTeamId] = useState('arg');
  const [tournament, setTournament] = useState<TournamentState>(() =>
    createWorldCupTournament(NATIONAL_TEAMS, 'bra'),
  );
  const [activeTournamentMatchId, setActiveTournamentMatchId] = useState<string | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [finalHud, setFinalHud] = useState<HudSnapshot | null>(null);
  const [muted, setMuted] = useState(false);
  const [inputSource, setInputSource] = useState<InputSourceInfo>(DEFAULT_KEYBOARD_SOURCE);
  const [showTouchControls, setShowTouchControls] = useState(() =>
    typeof window !== 'undefined' && ('ontouchstart' in window || window.innerWidth < 768),
  );

  const touchInputRef = useRef<TouchInputRef>({
    moveX: 0,
    moveZ: 0,
    sprint: false,
    shootHeld: false,
    shootJustPressed: false,
    shootJustReleased: false,
    passJustPressed: false,
    throughJustPressed: false,
    chipJustPressed: false,
    switchJustPressed: false,
  });

  const homeTeam = useMemo(() => teams.find((t) => t.id === homeTeamId) ?? teams[0], [teams, homeTeamId]);
  const awayTeam = useMemo(() => teams.find((t) => t.id === awayTeamId) ?? teams[1], [teams, awayTeamId]);

  useEffect(() => {
    const bodyState =
      screen === 'playing'
        ? 'playing'
        : screen === 'paused'
          ? 'paused'
          : screen === 'gameover'
            ? 'gameover'
            : 'title';
    document.body.dataset.state = bodyState;
  }, [screen]);

  useEffect(() => {
    document.body.dataset.inputMode = inputSource.mode;
    document.body.dataset.controllerBrand = inputSource.brand ?? 'none';
  }, [inputSource]);

  const startQuickMatch = useCallback(() => {
    soundEngine.unlock();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setActiveTournamentMatchId(null);
    setFinalHud(null);
    setMatchMode('quick');
    setMatchKey((k) => k + 1);
    setScreen('playing');
  }, []);

  const startPenalties = useCallback(() => {
    soundEngine.unlock();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setActiveTournamentMatchId(null);
    setFinalHud(null);
    setMatchMode('penalty');
    setMatchKey((k) => k + 1);
    setScreen('playing');
  }, []);

  const playTournamentMatch = useCallback(
    (match: TournamentMatch) => {
      if (!match.homeTeam || !match.awayTeam) return;
      soundEngine.unlock();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const userIsHome = match.homeTeam.id === tournament.userTeamId;
      setHomeTeamId(userIsHome ? match.homeTeam.id : match.awayTeam.id);
      setAwayTeamId(userIsHome ? match.awayTeam.id : match.homeTeam.id);
      setActiveTournamentMatchId(match.id);
      setFinalHud(null);
      setMatchMode('tournament');
      setMatchKey((k) => k + 1);
      setScreen('playing');
    },
    [tournament.userTeamId],
  );

  useEffect(() => {
    if (screen !== 'title') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        startQuickMatch();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screen, startQuickMatch]);

  const togglePause = useCallback(() => {
    setScreen((prev) => (prev === 'playing' ? 'paused' : prev === 'paused' ? 'playing' : prev));
  }, []);

  const handleControllerConfirmMenu = useCallback(() => {
    if (screen === 'title') {
      startQuickMatch();
    } else if (screen === 'paused') {
      setScreen('playing');
    }
  }, [screen, startQuickMatch]);

  const handleControllerCancelMenu = useCallback(() => {
    if (screen === 'paused') {
      setScreen('playing');
    } else if (screen === 'team_select' || screen === 'tournament') {
      setScreen('title');
    }
  }, [screen]);

  const handleMatchComplete = useCallback((snapshot: HudSnapshot) => {
    setFinalHud(snapshot);
    setScreen('gameover');
  }, []);

  const advanceTournament = useCallback(() => {
    if (!activeTournamentMatchId || !finalHud) {
      setScreen('tournament');
      return;
    }
    const match = tournament.matches.find((m) => m.id === activeTournamentMatchId);
    if (!match) {
      setScreen('tournament');
      return;
    }
    const userIsHome = match.homeTeam?.id === tournament.userTeamId;
    const mHomeScore = userIsHome ? finalHud.homeScore : finalHud.awayScore;
    const mAwayScore = userIsHome ? finalHud.awayScore : finalHud.homeScore;
    const penWinner =
      mHomeScore === mAwayScore
        ? Math.random() < 0.55
          ? userIsHome
            ? 'home'
            : 'away'
          : userIsHome
            ? 'away'
            : 'home'
        : null;

    setTournament((prev) =>
      recordTournamentMatchResult(prev, activeTournamentMatchId, mHomeScore, mAwayScore, penWinner),
    );
    setActiveTournamentMatchId(null);
    setMatchMode('attract');
    setScreen('tournament');
  }, [activeTournamentMatchId, finalHud, tournament.matches, tournament.userTeamId]);

  const returnToMenu = useCallback(() => {
    setActiveTournamentMatchId(null);
    setFinalHud(null);
    setMatchMode('attract');
    setMatchKey((k) => k + 1);
    setScreen('title');
  }, []);

  const restartMatch = useCallback(() => {
    setFinalHud(null);
    setMatchKey((k) => k + 1);
    setScreen('playing');
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !soundEngine.isMuted();
    soundEngine.setMuted(nextMuted);
    setMuted(nextMuted);
  }, []);

  const updateTeam = useCallback((updated: TeamConfig) => {
    setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }, []);

  const openTournament = useCallback(() => {
    setTournament((prev) =>
      prev.userTeamId === homeTeamId ? prev : createWorldCupTournament(teams, homeTeamId),
    );
    setScreen('tournament');
  }, [homeTeamId, teams]);

  return (
    <main className="relative w-full h-full overflow-hidden bg-slate-950">
      <GameCanvas
        mode={matchMode}
        difficulty={difficulty}
        paused={screen === 'paused'}
        isPlayingScreen={screen === 'playing'}
        matchKey={matchKey}
        initialCorner={initialCorner && matchKey === 1}
        initialThrowIn={initialThrowIn && matchKey === 1}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        touchInputRef={touchInputRef}
        onHudUpdate={setHud}
        onMatchComplete={handleMatchComplete}
        onTogglePause={togglePause}
        onInputSourceChange={setInputSource}
        onControllerConfirmMenu={handleControllerConfirmMenu}
        onControllerCancelMenu={handleControllerCancelMenu}
      />

      {screen === 'title' && (
        <TitleOverlay
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          difficulty={difficulty}
          inputSource={inputSource}
          onChangeDifficulty={setDifficulty}
          onStartQuickMatch={startQuickMatch}
          onOpenTournament={openTournament}
          onStartPenalties={startPenalties}
          onOpenCustomize={() => setScreen('team_select')}
        />
      )}

      {screen === 'team_select' && (
        <TeamSelectScreen
          teams={teams}
          homeTeamId={homeTeamId}
          awayTeamId={awayTeamId}
          onSelectHome={(id) => {
            setHomeTeamId(id);
            setTournament(createWorldCupTournament(teams, id));
          }}
          onSelectAway={setAwayTeamId}
          onUpdateTeam={updateTeam}
          onBack={() => setScreen('title')}
        />
      )}

      {screen === 'tournament' && (
        <TournamentScreen
          tournament={tournament}
          onPlayNextMatch={playTournamentMatch}
          onResetTournament={() => setTournament(createWorldCupTournament(teams, homeTeamId))}
          onBack={() => setScreen('title')}
        />
      )}

      {(screen === 'playing' || screen === 'paused' || screen === 'gameover') && (
        <HudOverlay
          hud={hud}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          muted={muted}
          showTouchControls={showTouchControls}
          inputSource={inputSource}
          onToggleMute={toggleMute}
          onTogglePause={togglePause}
          onToggleTouchControls={() => setShowTouchControls((v) => !v)}
        />
      )}

      {screen === 'playing' && showTouchControls && <TouchControls touchInputRef={touchInputRef} />}

      {screen === 'paused' && (
        <PauseModal
          inputSource={inputSource}
          onResume={() => setScreen('playing')}
          onRestart={restartMatch}
          onMainMenu={returnToMenu}
        />
      )}

      {screen === 'gameover' && finalHud && (
        <FullTimeModal
          mode={matchMode}
          hud={finalHud}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          onPlayAgain={restartMatch}
          onContinueTournament={matchMode === 'tournament' ? advanceTournament : undefined}
          onMainMenu={returnToMenu}
        />
      )}
    </main>
  );
}

export default App;
