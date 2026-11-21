import { useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { TeamConfig } from '../game/constants';
import { updateTeamKit } from '../game/teams';

interface TeamSelectScreenProps {
  teams: TeamConfig[];
  homeTeamId: string;
  awayTeamId: string;
  onSelectHome: (id: string) => void;
  onSelectAway: (id: string) => void;
  onUpdateTeam: (team: TeamConfig) => void;
  onBack: () => void;
}

export function TeamSelectScreen({
  teams,
  homeTeamId,
  awayTeamId,
  onSelectHome,
  onSelectAway,
  onUpdateTeam,
  onBack,
}: TeamSelectScreenProps) {
  const [slot, setSlot] = useState<'home' | 'away'>('home');
  const activeId = slot === 'home' ? homeTeamId : awayTeamId;
  const activeTeam = teams.find((t) => t.id === activeId) ?? teams[0];

  return (
    <div className="fixed inset-0 z-30 bg-slate-950/92 flex flex-col p-5 sm:p-8 overflow-y-auto">
      <div className="max-w-6xl w-full mx-auto flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/15 text-sm font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <h2 className="font-display font-extrabold text-3xl tracking-wide text-white">
              NATIONAL TEAMS &amp; KIT STUDIO
            </h2>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-lg border border-white/15">
            <button
              type="button"
              onClick={() => setSlot('home')}
              className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap shrink-0 ${
                slot === 'home' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:text-white'
              }`}
            >
              Home Team
            </button>
            <button
              type="button"
              onClick={() => setSlot('away')}
              className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap shrink-0 ${
                slot === 'away' ? 'bg-amber-400 text-slate-950' : 'text-slate-300 hover:text-white'
              }`}
            >
              Away Team
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-2.5 max-h-[65vh] overflow-y-auto pr-1">
            {teams.map((team) => {
              const isHome = team.id === homeTeamId;
              const isAway = team.id === awayTeamId;
              const isSelected = team.id === activeId;
              return (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => (slot === 'home' ? onSelectHome(team.id) : onSelectAway(team.id))}
                  className={`p-3 rounded-lg border text-left transition-colors flex flex-col gap-1.5 ${
                    isSelected
                      ? 'bg-slate-800 border-amber-400'
                      : 'bg-slate-900/90 border-white/10 hover:border-white/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-lg">{team.flag}</span>
                    <span className="font-mono-tabular text-xs font-bold text-slate-300">{team.code}</span>
                  </div>
                  <div className="font-display font-bold text-base text-white truncate">{team.name}</div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <span
                        className="w-3.5 h-3.5 rounded-xs border border-white/20"
                        style={{ backgroundColor: team.primaryColor }}
                      />
                      <span
                        className="w-3.5 h-3.5 rounded-xs border border-white/20"
                        style={{ backgroundColor: team.secondaryColor }}
                      />
                    </div>
                    {(isHome || isAway) && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-0.5">
                        <Check className="w-3 h-3" />
                        {isHome ? 'HOME' : 'AWAY'}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-4 bg-slate-900 border border-white/15 rounded-xl p-5 flex flex-col gap-4 h-fit">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-xl tracking-wide text-white">
                EDIT {slot.toUpperCase()} KIT
              </h3>
              <span className="text-2xl">{activeTeam.flag}</span>
            </div>

            <div className="bg-slate-950 rounded-lg border border-white/10 p-4 flex items-center justify-center gap-6">
              <svg viewBox="0 0 80 86" className="w-24 h-24" aria-label="Outfield kit preview">
                <path
                  d="M22 10L8 24L16 34L22 28V76H58V28L64 34L72 24L58 10H48C46 15 34 15 32 10H22Z"
                  fill={activeTeam.primaryColor}
                  stroke="#ffffff"
                  strokeWidth="2"
                />
                <rect x="22" y="36" width="36" height="10" fill={activeTeam.secondaryColor} />
                <text
                  x="40"
                  y="65"
                  textAnchor="middle"
                  fill={activeTeam.secondaryColor}
                  fontSize="14"
                  fontWeight="800"
                  fontFamily="Barlow Condensed, sans-serif"
                >
                  {activeTeam.code}
                </text>
              </svg>

              <svg viewBox="0 0 80 86" className="w-20 h-20" aria-label="Goalkeeper kit preview">
                <path
                  d="M22 10L8 24L16 34L22 28V76H58V28L64 34L72 24L58 10H48C46 15 34 15 32 10H22Z"
                  fill={activeTeam.gkColor}
                  stroke="#94a3b8"
                  strokeWidth="2"
                />
                <text
                  x="40"
                  y="52"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="12"
                  fontWeight="800"
                  fontFamily="Barlow Condensed, sans-serif"
                >
                  GK
                </text>
              </svg>
            </div>

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
                <span>Team Name</span>
                <input
                  type="text"
                  maxLength={22}
                  value={activeTeam.name}
                  onChange={(e) => onUpdateTeam(updateTeamKit(activeTeam, { name: e.target.value }))}
                  className="px-3 py-2 rounded-lg bg-slate-950 border border-white/15 text-sm text-white focus:outline-none focus:border-amber-400"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
                <span>3-Letter Short Code</span>
                <input
                  type="text"
                  maxLength={3}
                  value={activeTeam.code}
                  onChange={(e) => onUpdateTeam(updateTeamKit(activeTeam, { code: e.target.value }))}
                  className="px-3 py-2 rounded-lg bg-slate-950 border border-white/15 text-sm font-mono-tabular uppercase text-white focus:outline-none focus:border-amber-400"
                />
              </label>

              <div className="grid grid-cols-3 gap-2.5 pt-1">
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
                  <span>Primary</span>
                  <input
                    type="color"
                    value={activeTeam.primaryColor}
                    onChange={(e) => onUpdateTeam(updateTeamKit(activeTeam, { primaryColor: e.target.value }))}
                    className="w-full h-10 rounded cursor-pointer bg-slate-950 border border-white/15 p-1"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
                  <span>Secondary</span>
                  <input
                    type="color"
                    value={activeTeam.secondaryColor}
                    onChange={(e) => onUpdateTeam(updateTeamKit(activeTeam, { secondaryColor: e.target.value }))}
                    className="w-full h-10 rounded cursor-pointer bg-slate-950 border border-white/15 p-1"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-300">
                  <span>Keeper</span>
                  <input
                    type="color"
                    value={activeTeam.gkColor}
                    onChange={(e) => onUpdateTeam(updateTeamKit(activeTeam, { gkColor: e.target.value }))}
                    className="w-full h-10 rounded cursor-pointer bg-slate-950 border border-white/15 p-1"
                  />
                </label>
              </div>
            </div>

            <button
              type="button"
              onClick={onBack}
              className="w-full mt-2 py-2.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition-colors whitespace-nowrap shrink-0"
            >
              Done &amp; Save Kits
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
