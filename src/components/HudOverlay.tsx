import { Gamepad2, Keyboard, Pause, Volume2, VolumeX } from 'lucide-react';
import { HudSnapshot, TeamConfig } from '../game/constants';
import { getControlPrompts, InputSourceInfo } from '../game/controller';

interface HudOverlayProps {
  hud: HudSnapshot;
  homeTeam: TeamConfig;
  awayTeam: TeamConfig;
  muted: boolean;
  showTouchControls: boolean;
  inputSource: InputSourceInfo;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onToggleTouchControls: () => void;
}

function formatClock(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function HudOverlay({
  hud,
  homeTeam,
  awayTeam,
  muted,
  showTouchControls,
  inputSource,
  onToggleMute,
  onTogglePause,
  onToggleTouchControls,
}: HudOverlayProps) {
  const isPenalty = hud.penalty !== null;
  const activePower = hud.penalty?.charging ? hud.penalty.power : hud.shotPower;
  const showPower = hud.isChargingShot || (hud.penalty?.charging ?? false);
  const prompts = getControlPrompts(inputSource);
  const sensorAccent =
    inputSource.mode === 'controller'
      ? inputSource.brand === 'ps5'
        ? 'text-sky-300'
        : inputSource.brand === 'switch'
          ? 'text-rose-300'
          : 'text-emerald-300'
      : 'text-amber-400';

  return (
    <div className="fixed inset-0 pointer-events-none z-20 flex flex-col justify-between p-4 sm:p-5">
      {/* Top Broadcast Bar */}
      <div className="flex items-start justify-between gap-2 sm:gap-4">
        <div
          data-testid="scoreboard"
          className="pointer-events-auto inline-flex items-stretch bg-slate-950/92 border border-white/15 rounded-md shadow-xl overflow-hidden max-w-[calc(100vw-130px)] sm:max-w-none"
        >
          <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 bg-slate-900">
            <span className="w-1.5 h-5 sm:h-6 rounded-xs shrink-0" style={{ backgroundColor: homeTeam.primaryColor }} />
            <span className="hidden sm:inline text-sm" aria-hidden="true">
              {homeTeam.flag}
            </span>
            <span className="font-display font-extrabold text-base sm:text-lg tracking-wider text-white">
              {homeTeam.code}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 bg-slate-950 border-x border-white/10">
            <span
              data-testid="home-score"
              className="font-display font-extrabold text-xl sm:text-2xl leading-none text-amber-400 tabular-nums"
            >
              {hud.homeScore}
            </span>
            <span className="text-slate-500 font-bold text-xs sm:text-sm">-</span>
            <span
              data-testid="away-score"
              className="font-display font-extrabold text-xl sm:text-2xl leading-none text-white tabular-nums"
            >
              {hud.awayScore}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 bg-slate-900">
            <span className="font-display font-extrabold text-base sm:text-lg tracking-wider text-white">
              {awayTeam.code}
            </span>
            <span className="hidden sm:inline text-sm" aria-hidden="true">
              {awayTeam.flag}
            </span>
            <span className="w-1.5 h-5 sm:h-6 rounded-xs shrink-0" style={{ backgroundColor: awayTeam.primaryColor }} />
          </div>

          <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-emerald-600 text-white font-mono-tabular font-bold text-xs sm:text-sm whitespace-nowrap">
            {isPenalty ? (
              <span>PEN R{hud.penalty?.round}</span>
            ) : (
              <>
                <span className="text-[10px] sm:text-[11px] uppercase tracking-wider opacity-90">
                  {hud.half === 1 ? '1H' : '2H'}
                </span>
                <span data-testid="match-clock">{formatClock(hud.clockSeconds)}</span>
              </>
            )}
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleTouchControls();
            }}
            aria-label="Toggle touch controls"
            title="Toggle on-screen controls"
            className={`w-8 h-8 sm:w-10 sm:h-10 rounded-md border flex items-center justify-center transition-colors ${
              showTouchControls
                ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                : 'bg-slate-950/90 text-slate-200 border-white/15 hover:bg-slate-800'
            }`}
          >
            <Gamepad2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            className="w-8 h-8 sm:w-10 sm:h-10 rounded-md bg-slate-950/90 border border-white/15 text-slate-200 hover:bg-slate-800 flex items-center justify-center transition-colors"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onTogglePause();
            }}
            aria-label="Pause match"
            className="w-8 h-8 sm:w-10 sm:h-10 rounded-md bg-slate-950/90 border border-white/15 text-slate-200 hover:bg-slate-800 flex items-center justify-center transition-colors"
          >
            <Pause className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Penalty Tracker Bar */}
      {isPenalty && hud.penalty && (
        <div className="self-center mt-2 bg-slate-950/92 border border-white/15 rounded-md px-4 py-2 flex flex-col items-center gap-1.5 shadow-xl">
          <div className="flex items-center gap-5 text-xs font-semibold">
            <div className="flex items-center gap-1.5">
              <span className="font-display text-sm tracking-wider text-amber-400 w-9">{homeTeam.code}</span>
              {hud.penalty.homeKicks.map((res, idx) => (
                <span
                  key={`h-${idx}`}
                  className={`w-3.5 h-3.5 rounded-xs border ${
                    res === true
                      ? 'bg-emerald-400 border-emerald-200'
                      : res === false
                        ? 'bg-rose-500 border-rose-300'
                        : 'bg-slate-800 border-slate-600'
                  }`}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-display text-sm tracking-wider text-sky-400 w-9">{awayTeam.code}</span>
              {hud.penalty.awayKicks.map((res, idx) => (
                <span
                  key={`a-${idx}`}
                  className={`w-3.5 h-3.5 rounded-xs border ${
                    res === true
                      ? 'bg-emerald-400 border-emerald-200'
                      : res === false
                        ? 'bg-rose-500 border-rose-300'
                        : 'bg-slate-800 border-slate-600'
                  }`}
                />
              ))}
            </div>
          </div>
          <div className="text-xs font-medium tracking-wide text-amber-300" data-penalty-phase={hud.phase}>
            {hud.phase === 'penalty_aim'
              ? hud.penalty.bannerText
              : hud.phase === 'penalty_flight'
                ? hud.penalty.turn === 'home'
                  ? 'SHOT IN FLIGHT!'
                  : 'DIVE TO SAVE!'
                : 'GET READY FOR NEXT KICK...'}
          </div>
        </div>
      )}

      {/* Center Action Banner (non-blocking) */}
      <div className="flex-1 flex items-start justify-center pt-8">
        {hud.banner && (
          <div
            data-testid="match-banner"
            className={`px-6 py-2.5 rounded-md border shadow-2xl text-center transition-transform ${
              hud.banner.tone === 'goal'
                ? 'bg-amber-400 text-slate-950 border-amber-200'
                : hud.banner.tone === 'curve'
                  ? 'bg-purple-700 text-amber-300 border-amber-400'
                  : hud.banner.tone === 'red'
                    ? 'bg-rose-600 text-white border-rose-300'
                    : hud.banner.tone === 'yellow'
                      ? 'bg-yellow-400 text-slate-950 border-yellow-200'
                      : hud.banner.tone === 'whistle'
                        ? 'bg-slate-950/95 text-amber-300 border-amber-400/50'
                        : 'bg-slate-950/92 text-white border-white/20'
            }`}
          >
            <div className="font-display font-extrabold text-2xl sm:text-4xl tracking-wide leading-none">
              {hud.banner.title}
            </div>
            <div className="text-[11px] sm:text-xs font-bold tracking-wider uppercase opacity-90 mt-1">
              {hud.banner.subtitle}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Controls & Player Stamina / Curve Luck Cluster */}
      <div className="flex items-end justify-between gap-4">
        <div
          data-testid="hud-controls-bar"
          className="hidden md:flex items-center gap-3 px-3 py-1.5 rounded-md bg-slate-950/88 border border-white/10 text-[11px] text-slate-300"
        >
          <span
            data-testid="hud-input-sensor"
            data-input-mode={inputSource.mode}
            data-controller-brand={inputSource.brand ?? 'none'}
            className={`inline-flex items-center gap-1.5 font-bold uppercase tracking-wider pr-2 border-r border-white/10 ${sensorAccent}`}
          >
            {inputSource.mode === 'controller' ? (
              <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Keyboard className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{prompts.badgeLabel}</span>
          </span>
          <span>
            <strong className="text-white">{prompts.move}</strong> Move
          </span>
          <span className="text-slate-600">·</span>
          <span>
            <strong className="text-white">{prompts.shoot}</strong> Shoot / Tackle / Dive
          </span>
          <span className="text-slate-600">·</span>
          <span>
            <strong className="text-white">{prompts.pass}</strong> Pass
          </span>
          <span className="text-slate-600">·</span>
          <span>
            <strong className="text-white">{prompts.through}</strong> Through
          </span>
          <span className="text-slate-600">·</span>
          <span>
            <strong className="text-white">{prompts.chip}</strong> Chip
          </span>
          <span className="text-slate-600">·</span>
          <span>
            <strong className="text-white">{prompts.sprint}</strong> Sprint
          </span>
          <span className="text-slate-600">·</span>
          <span>
            <strong className="text-white">{prompts.switchPlayer}</strong> Switch
          </span>
        </div>

        <div className="ml-auto bg-slate-950/92 border border-white/15 rounded-md px-3.5 py-2 flex items-center gap-4">
          {hud.refereeChasing && (
            <span className="text-xs font-bold tracking-wider text-rose-400 uppercase">REF CHASING!</span>
          )}

          {/* Active Player Stamina */}
          <div className="flex flex-col gap-1 min-w-[116px]">
            <div className="flex items-center justify-between gap-3 text-[11px] font-bold tracking-wider text-slate-300">
              <span>#{hud.activeNumber} STAMINA</span>
              <span className="tabular-nums">{Math.round(hud.activeStamina * 100)}%</span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-xs overflow-hidden">
              <div
                className="h-full bg-emerald-400 transition-all duration-75"
                style={{ width: `${Math.round(hud.activeStamina * 100)}%` }}
              />
            </div>
          </div>

          {showPower && (
            <div className="flex flex-col gap-1 min-w-[92px]">
              <div className="flex items-center justify-between text-[11px] font-bold tracking-wider text-amber-300">
                <span>POWER</span>
                <span className="tabular-nums">{Math.round(activePower * 100)}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-xs overflow-hidden">
                <div
                  className="h-full bg-amber-400"
                  style={{ width: `${Math.round(activePower * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
