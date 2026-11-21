import { getControlPrompts, InputSourceInfo } from '../game/controller';

interface PauseModalProps {
  inputSource: InputSourceInfo;
  onResume: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
}

export function PauseModal({ inputSource, onResume, onRestart, onMainMenu }: PauseModalProps) {
  const prompts = getControlPrompts(inputSource);
  return (
    <div
      role="dialog"
      aria-label="Match Paused"
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4"
    >
      <div className="w-full max-w-sm rounded-xl bg-slate-900 border border-white/15 p-6 shadow-2xl flex flex-col gap-4">
        <div className="text-center">
          <h2 className="font-display font-extrabold text-3xl tracking-wide text-white">MATCH PAUSED</h2>
          <p className="text-xs text-slate-400 mt-1">{prompts.pauseHint}</p>
        </div>
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="w-full py-2.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition-colors whitespace-nowrap shrink-0"
          >
            Resume Match
          </button>
          <button
            type="button"
            onClick={onRestart}
            className="w-full py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm border border-white/10 transition-colors whitespace-nowrap shrink-0"
          >
            Restart Match
          </button>
          <button
            type="button"
            onClick={onMainMenu}
            className="w-full py-2.5 px-4 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-300 font-semibold text-sm border border-white/10 transition-colors whitespace-nowrap shrink-0"
          >
            Return to Main Menu
          </button>
        </div>
      </div>
    </div>
  );
}
