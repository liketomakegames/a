import { HudSnapshot, MatchMode, TeamConfig } from '../game/constants';

interface FullTimeModalProps {
  mode: MatchMode;
  hud: HudSnapshot;
  homeTeam: TeamConfig;
  awayTeam: TeamConfig;
  onPlayAgain: () => void;
  onContinueTournament?: () => void;
  onMainMenu: () => void;
}

export function FullTimeModal({
  mode,
  hud,
  homeTeam,
  awayTeam,
  onPlayAgain,
  onContinueTournament,
  onMainMenu,
}: FullTimeModalProps) {
  const won = hud.homeScore > hud.awayScore;
  const draw = hud.homeScore === hud.awayScore;
  const totalPoss = Math.max(1, hud.stats.homePossessionTime + hud.stats.awayPossessionTime);
  const homePossPct = Math.round((hud.stats.homePossessionTime / totalPoss) * 100);

  return (
    <div
      role="dialog"
      aria-label="Full Time Summary"
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-slate-900 border border-white/15 p-6 shadow-2xl flex flex-col gap-5">
        <div className="text-center">
          <div className="text-xs font-bold uppercase tracking-widest text-amber-400">
            {mode === 'penalty' ? 'Penalty Shootout Complete' : 'Full Time'}
          </div>
          <h2 className="font-display font-extrabold text-4xl tracking-wide text-white mt-1">
            {won ? 'VICTORY!' : draw ? 'DRAW' : 'DEFEAT'}
          </h2>
        </div>

        <div className="flex items-center justify-between bg-slate-950 rounded-lg border border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="text-xl">{homeTeam.flag}</span>
            <span className="font-display font-bold text-xl">{homeTeam.code}</span>
          </div>
          <div className="font-display font-extrabold text-4xl tabular-nums text-amber-400">
            {hud.homeScore} - {hud.awayScore}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-xl">{awayTeam.code}</span>
            <span className="text-xl">{awayTeam.flag}</span>
          </div>
        </div>

        {mode !== 'penalty' && (
          <div className="grid grid-cols-3 gap-2 text-center bg-slate-950/60 rounded-lg p-3 border border-white/5 text-xs">
            <div>
              <div className="text-slate-400">Shots (Curve)</div>
              <div className="font-mono-tabular font-bold text-sm text-white mt-0.5">
                {hud.stats.homeShots} ({hud.stats.homeCurveShots}) - {hud.stats.awayShots}
              </div>
            </div>
            <div>
              <div className="text-slate-400">Possession</div>
              <div className="font-mono-tabular font-bold text-sm text-white mt-0.5">
                {homePossPct}% - {100 - homePossPct}%
              </div>
            </div>
            <div>
              <div className="text-slate-400">Cards</div>
              <div className="font-mono-tabular font-bold text-sm text-white mt-0.5">
                {hud.stats.homeCards} - {hud.stats.awayCards}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {mode === 'tournament' && onContinueTournament ? (
            <button
              type="button"
              data-start="true"
              onClick={onContinueTournament}
              className="w-full py-3 px-4 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-sm transition-colors whitespace-nowrap shrink-0"
            >
              Advance Tournament Bracket
            </button>
          ) : (
            <button
              type="button"
              data-start="true"
              onClick={onPlayAgain}
              className="w-full py-3 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition-colors whitespace-nowrap shrink-0"
            >
              Play Again
            </button>
          )}
          <button
            type="button"
            onClick={onMainMenu}
            className="w-full py-2.5 px-4 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-300 font-semibold text-sm border border-white/10 transition-colors whitespace-nowrap shrink-0"
          >
            Main Menu
          </button>
        </div>
      </div>
    </div>
  );
}
