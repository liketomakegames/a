import { ArrowLeft, Play, RotateCcw, Trophy } from 'lucide-react';
import {
  getNextUserMatch,
  TOURNAMENT_ROUND_NAMES,
  TournamentMatch,
  TournamentState,
} from '../game/tournament';

interface TournamentScreenProps {
  tournament: TournamentState;
  onPlayNextMatch: (match: TournamentMatch) => void;
  onResetTournament: () => void;
  onBack: () => void;
}

export function TournamentScreen({
  tournament,
  onPlayNextMatch,
  onResetTournament,
  onBack,
}: TournamentScreenProps) {
  const nextMatch = getNextUserMatch(tournament);

  return (
    <div className="fixed inset-0 z-30 bg-slate-950/94 flex flex-col p-5 sm:p-8 overflow-y-auto">
      <div className="max-w-7xl w-full mx-auto flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/15 text-sm font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Menu</span>
            </button>
            <div>
              <h2 className="font-display font-extrabold text-3xl tracking-wide text-white">
                WORLD CUP 32 KNOCKOUT
              </h2>
              <p className="text-xs text-slate-400">
                Single-elimination 7-a-side championship · Current stage:{' '}
                {TOURNAMENT_ROUND_NAMES[tournament.currentRound]}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onResetTournament}
              className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/15 text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>New Bracket</span>
            </button>

            {nextMatch && !tournament.eliminated && !tournament.champion && (
              <button
                type="button"
                data-start="true"
                onClick={() => onPlayNextMatch(nextMatch)}
                className="px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-extrabold text-lg tracking-wide flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>
                  PLAY {nextMatch.homeTeam?.code} VS {nextMatch.awayTeam?.code}
                </span>
              </button>
            )}
          </div>
        </div>

        {tournament.champion && (
          <div className="rounded-xl bg-amber-400 text-slate-950 p-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Trophy className="w-8 h-8 shrink-0" />
              <div>
                <div className="text-xs font-bold uppercase tracking-widest">Tournament Champion</div>
                <div className="font-display font-extrabold text-3xl">
                  {tournament.champion.flag} {tournament.champion.name}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onResetTournament}
              className="px-4 py-2 rounded-lg bg-slate-950 text-white font-bold text-sm whitespace-nowrap shrink-0"
            >
              Play New Tournament
            </button>
          </div>
        )}

        {tournament.eliminated && !tournament.champion && (
          <div className="rounded-xl bg-rose-950/80 border border-rose-500/40 p-4 flex items-center justify-between gap-4">
            <div>
              <div className="font-display font-bold text-2xl text-white">KNOCKED OUT OF THE TOURNAMENT</div>
              <div className="text-xs text-rose-200">Start a fresh 32-team bracket to try again.</div>
            </div>
            <button
              type="button"
              onClick={onResetTournament}
              className="px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-bold text-sm whitespace-nowrap shrink-0"
            >
              Restart Bracket
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {TOURNAMENT_ROUND_NAMES.map((roundName, rIdx) => {
            const roundMatches = tournament.matches.filter((m) => m.roundIndex === rIdx);
            return (
              <div key={roundName} className="flex flex-col gap-2">
                <div className="text-xs font-bold uppercase tracking-wider text-amber-400 px-1 pb-1 border-b border-white/10">
                  {roundName}
                </div>
                <div className="flex flex-col gap-2 justify-around flex-1">
                  {roundMatches.map((m) => {
                    const isUserMatch =
                      m.homeTeam?.id === tournament.userTeamId || m.awayTeam?.id === tournament.userTeamId;
                    return (
                      <div
                        key={m.id}
                        className={`rounded-lg border p-2 text-xs flex flex-col gap-1 ${
                          isUserMatch
                            ? 'bg-slate-800/95 border-amber-400/70'
                            : 'bg-slate-900/80 border-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate font-semibold text-white">
                            {m.homeTeam ? `${m.homeTeam.flag} ${m.homeTeam.code}` : 'TBD'}
                          </span>
                          <span className="font-mono-tabular font-bold text-slate-300">
                            {m.homeScore !== null ? m.homeScore : '-'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate font-semibold text-white">
                            {m.awayTeam ? `${m.awayTeam.flag} ${m.awayTeam.code}` : 'TBD'}
                          </span>
                          <span className="font-mono-tabular font-bold text-slate-300">
                            {m.awayScore !== null ? m.awayScore : '-'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
