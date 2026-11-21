import { Gamepad2, Keyboard, Play, Target, Trophy, Users } from 'lucide-react';
import { Difficulty, TeamConfig } from '../game/constants';
import { getControlPrompts, InputSourceInfo } from '../game/controller';

interface TitleOverlayProps {
  homeTeam: TeamConfig;
  awayTeam: TeamConfig;
  difficulty: Difficulty;
  inputSource: InputSourceInfo;
  onChangeDifficulty: (diff: Difficulty) => void;
  onStartQuickMatch: () => void;
  onOpenTournament: () => void;
  onStartPenalties: () => void;
  onOpenCustomize: () => void;
}

export function TitleOverlay({
  homeTeam,
  awayTeam,
  difficulty,
  inputSource,
  onChangeDifficulty,
  onStartQuickMatch,
  onOpenTournament,
  onStartPenalties,
  onOpenCustomize,
}: TitleOverlayProps) {
  const prompts = getControlPrompts(inputSource);
  const sensorToneClass =
    inputSource.mode === 'controller'
      ? inputSource.brand === 'ps5'
        ? 'border-sky-400/50 text-sky-300'
        : inputSource.brand === 'switch'
          ? 'border-rose-400/50 text-rose-300'
          : 'border-emerald-400/50 text-emerald-300'
      : 'border-white/15 text-slate-200';

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-6 sm:p-10 pointer-events-none bg-gradient-to-r from-slate-950/90 via-slate-950/55 to-transparent">
      <div className="flex flex-wrap items-center justify-between gap-4 pointer-events-auto">
        <div className="flex items-center gap-3.5">
          <svg viewBox="0 0 48 48" className="w-11 h-11 shrink-0" aria-hidden="true">
            <path
              d="M24 3L42 10V23C42 33.5 34.2 42.2 24 45C13.8 42.2 6 33.5 6 23V10L24 3Z"
              fill="#0f172a"
              stroke="#facc15"
              strokeWidth="2.5"
            />
            <path d="M13 31C22 31 32 23 34 14" fill="none" stroke="#9333ea" strokeWidth="3.5" strokeLinecap="round" />
            <circle cx="34" cy="14" r="5" fill="#facc15" stroke="#0f172a" strokeWidth="1.5" />
          </svg>
          <div>
            <h1 className="font-display font-extrabold text-3xl sm:text-5xl tracking-tight leading-none text-white hud-text-shadow">
              LIQUID SOCCER <span className="text-amber-400">27</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1">
              7-a-Side Arcade Football
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div
            data-testid="input-sensor"
            data-input-mode={inputSource.mode}
            data-controller-brand={inputSource.brand ?? 'none'}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-950/90 border text-xs font-bold uppercase tracking-wider ${sensorToneClass}`}
          >
            {inputSource.mode === 'controller' ? (
              <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Keyboard className="w-3.5 h-3.5 shrink-0 text-amber-400" />
            )}
            <span>{inputSource.label}</span>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-950/90 border border-white/15">
            {(['easy', 'medium', 'hard'] as Difficulty[]).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => onChangeDifficulty(level)}
                className={`px-3.5 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap shrink-0 ${
                  difficulty === level
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-md flex flex-col gap-5 pointer-events-auto my-auto">
        <div className="bg-slate-950/90 border border-white/15 rounded-lg p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-2.5 h-8 rounded-xs shrink-0" style={{ backgroundColor: homeTeam.primaryColor }} />
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Home</div>
              <div className="font-display font-bold text-xl text-white truncate">
                {homeTeam.flag} {homeTeam.name}
              </div>
            </div>
          </div>

          <span className="font-display font-extrabold text-lg text-amber-400 shrink-0">VS</span>

          <div className="flex items-center gap-2.5 min-w-0 text-right">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Away</div>
              <div className="font-display font-bold text-xl text-white truncate">
                {awayTeam.name} {awayTeam.flag}
              </div>
            </div>
            <span className="w-2.5 h-8 rounded-xs shrink-0" style={{ backgroundColor: awayTeam.primaryColor }} />
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            data-start="true"
            onClick={onStartQuickMatch}
            className="w-full py-3.5 px-5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-extrabold text-2xl tracking-wide flex items-center justify-between transition-colors shadow-lg whitespace-nowrap shrink-0"
          >
            <span>QUICK MATCH</span>
            <Play className="w-6 h-6 fill-current" />
          </button>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onOpenTournament}
              className="py-3 px-4 rounded-lg bg-slate-900/95 hover:bg-slate-800 border border-white/15 text-white font-display font-bold text-lg tracking-wide flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
              <span>WORLD CUP 32</span>
            </button>

            <button
              type="button"
              onClick={onStartPenalties}
              className="py-3 px-4 rounded-lg bg-slate-900/95 hover:bg-slate-800 border border-white/15 text-white font-display font-bold text-lg tracking-wide flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <Target className="w-4 h-4 text-sky-400 shrink-0" />
              <span>PENALTIES</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenCustomize}
            className="w-full py-2.5 px-4 rounded-lg bg-slate-950/90 hover:bg-slate-900 border border-white/15 text-slate-200 font-semibold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Users className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Select National Teams &amp; Customize Kits</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pointer-events-auto">
        <div
          data-testid="title-controls-bar"
          className="text-xs text-slate-300/90 hud-text-shadow flex flex-wrap items-center gap-x-3 gap-y-1"
        >
          <span>{prompts.move} Move &amp; Aim</span>
          <span aria-hidden="true">·</span>
          <span>{prompts.shoot} Shoot (Random Curve Luck!) / Slide / Dive</span>
          <span aria-hidden="true">·</span>
          <span>{prompts.pass} Pass</span>
          <span aria-hidden="true">·</span>
          <span>{prompts.through} Through</span>
          <span aria-hidden="true">·</span>
          <span>{prompts.chip} Chip</span>
          <span aria-hidden="true">·</span>
          <span>{prompts.sprint} Sprint</span>
          <span aria-hidden="true">·</span>
          <span>{prompts.switchPlayer} Switch</span>
          {inputSource.mode === 'controller' && (
            <>
              <span aria-hidden="true">·</span>
              <span>{prompts.pause} Pause</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
