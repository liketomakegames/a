import { TeamConfig, TeamSide } from './constants';

export interface TournamentMatch {
  id: string;
  roundIndex: number;
  matchIndex: number;
  homeTeam: TeamConfig | null;
  awayTeam: TeamConfig | null;
  homeScore: number | null;
  awayScore: number | null;
  penaltiesWinner: TeamSide | null;
  winner: TeamConfig | null;
  completed: boolean;
}

export interface TournamentState {
  userTeamId: string;
  currentRound: number;
  matches: TournamentMatch[];
  champion: TeamConfig | null;
  eliminated: boolean;
}

export const TOURNAMENT_ROUND_NAMES = [
  'Round of 32',
  'Round of 16',
  'Quarterfinals',
  'Semifinals',
  'Final',
];

export function createWorldCupTournament(
  teams: TeamConfig[],
  userTeamId: string,
  rng: () => number = Math.random,
): TournamentState {
  const userTeam = teams.find((t) => t.id === userTeamId) ?? teams[0];
  const others = [...teams.filter((t) => t.id !== userTeam.id)];
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const seeded = [userTeam, ...others.slice(0, 31)];
  const matches: TournamentMatch[] = [];
  for (let i = 0; i < 16; i++) {
    matches.push({
      id: `r0-m${i}`,
      roundIndex: 0,
      matchIndex: i,
      homeTeam: seeded[i * 2],
      awayTeam: seeded[i * 2 + 1],
      homeScore: null,
      awayScore: null,
      penaltiesWinner: null,
      winner: null,
      completed: false,
    });
  }
  const counts = [8, 4, 2, 1];
  for (let r = 1; r <= 4; r++) {
    for (let m = 0; m < counts[r - 1]; m++) {
      matches.push({
        id: `r${r}-m${m}`,
        roundIndex: r,
        matchIndex: m,
        homeTeam: null,
        awayTeam: null,
        homeScore: null,
        awayScore: null,
        penaltiesWinner: null,
        winner: null,
        completed: false,
      });
    }
  }
  return {
    userTeamId: userTeam.id,
    currentRound: 0,
    matches,
    champion: null,
    eliminated: false,
  };
}

function simulateCpuMatch(
  home: TeamConfig,
  away: TeamConfig,
  rng: () => number = Math.random,
): { homeScore: number; awayScore: number; penaltiesWinner: TeamSide | null; winner: TeamConfig } {
  const diff = (home.rating - away.rating) * 0.04;
  const homeLambda = Math.max(0.6, 1.5 + diff);
  const awayLambda = Math.max(0.6, 1.5 - diff);
  const sampleGoals = (lambda: number): number => {
    let goals = 0;
    for (let i = 0; i < 5; i++) {
      if (rng() < lambda / 5) goals++;
    }
    return goals;
  };
  const homeScore = sampleGoals(homeLambda);
  const awayScore = sampleGoals(awayLambda);
  if (homeScore > awayScore) {
    return { homeScore, awayScore, penaltiesWinner: null, winner: home };
  }
  if (awayScore > homeScore) {
    return { homeScore, awayScore, penaltiesWinner: null, winner: away };
  }
  const penWinner: TeamSide = rng() + diff * 0.1 >= 0.5 ? 'home' : 'away';
  return {
    homeScore,
    awayScore,
    penaltiesWinner: penWinner,
    winner: penWinner === 'home' ? home : away,
  };
}

export function getNextUserMatch(tournament: TournamentState): TournamentMatch | null {
  return (
    tournament.matches.find(
      (m) =>
        m.roundIndex === tournament.currentRound &&
        !m.completed &&
        (m.homeTeam?.id === tournament.userTeamId || m.awayTeam?.id === tournament.userTeamId),
    ) ?? null
  );
}

export function recordTournamentMatchResult(
  tournament: TournamentState,
  matchId: string,
  homeScore: number,
  awayScore: number,
  penaltiesWinner: TeamSide | null = null,
  rng: () => number = Math.random,
): TournamentState {
  const matches = tournament.matches.map((m) => ({ ...m }));
  const target = matches.find((m) => m.id === matchId);
  if (!target || !target.homeTeam || !target.awayTeam) return tournament;

  let winner: TeamConfig;
  if (homeScore > awayScore) {
    winner = target.homeTeam;
  } else if (awayScore > homeScore) {
    winner = target.awayTeam;
  } else {
    winner = penaltiesWinner === 'away' ? target.awayTeam : target.homeTeam;
  }

  target.homeScore = homeScore;
  target.awayScore = awayScore;
  target.penaltiesWinner = penaltiesWinner;
  target.winner = winner;
  target.completed = true;

  for (const m of matches) {
    if (m.roundIndex === target.roundIndex && !m.completed && m.homeTeam && m.awayTeam) {
      const res = simulateCpuMatch(m.homeTeam, m.awayTeam, rng);
      m.homeScore = res.homeScore;
      m.awayScore = res.awayScore;
      m.penaltiesWinner = res.penaltiesWinner;
      m.winner = res.winner;
      m.completed = true;
    }
  }

  if (target.roundIndex < 4) {
    const nextRound = target.roundIndex + 1;
    const roundMatches = matches.filter((m) => m.roundIndex === target.roundIndex);
    for (const m of roundMatches) {
      const nextIdx = Math.floor(m.matchIndex / 2);
      const nextMatch = matches.find((nm) => nm.roundIndex === nextRound && nm.matchIndex === nextIdx);
      if (nextMatch && m.winner) {
        if (m.matchIndex % 2 === 0) {
          nextMatch.homeTeam = m.winner;
        } else {
          nextMatch.awayTeam = m.winner;
        }
      }
    }
  }

  const eliminated = winner.id !== tournament.userTeamId;
  const isFinal = target.roundIndex === 4;

  return {
    ...tournament,
    matches,
    currentRound: isFinal ? 4 : target.roundIndex + 1,
    champion: isFinal ? winner : tournament.champion,
    eliminated,
  };
}
