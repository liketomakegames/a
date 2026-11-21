import { useRef, useState } from 'react';
import { TouchInputRef } from './GameCanvas';

interface TouchControlsProps {
  touchInputRef: React.MutableRefObject<TouchInputRef>;
}

export function TouchControls({ touchInputRef }: TouchControlsProps) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const [knobOffset, setKnobOffset] = useState({ x: 0, y: 0 });
  const pointerIdRef = useRef<number | null>(null);

  const updateStick = (clientX: number, clientY: number) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width * 0.36;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    setKnobOffset({ x: dx, y: dy });
    touchInputRef.current.moveX = dx / maxR;
    touchInputRef.current.moveZ = dy / maxR;
  };

  const resetStick = () => {
    pointerIdRef.current = null;
    setKnobOffset({ x: 0, y: 0 });
    touchInputRef.current.moveX = 0;
    touchInputRef.current.moveZ = 0;
  };

  return (
    <div className="fixed inset-x-0 bottom-14 z-30 pointer-events-none flex items-end justify-between px-5 sm:px-8">
      <div
        ref={padRef}
        aria-label="Virtual movement joystick"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointerIdRef.current = e.pointerId;
          updateStick(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (pointerIdRef.current === e.pointerId) {
            updateStick(e.clientX, e.clientY);
          }
        }}
        onPointerUp={resetStick}
        onPointerCancel={resetStick}
        className="pointer-events-auto relative w-28 h-28 rounded-xl bg-slate-950/75 border-2 border-white/25 flex items-center justify-center touch-none"
      >
        <div
          className="w-12 h-12 rounded-lg bg-amber-400/90 border border-yellow-200 shadow-lg"
          style={{ transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)` }}
        />
      </div>

      <div className="pointer-events-auto grid grid-cols-3 gap-2.5 touch-none">
        <button
          type="button"
          onPointerDown={() => {
            touchInputRef.current.switchJustPressed = true;
          }}
          className="w-14 h-12 rounded-lg bg-slate-900/90 border border-white/25 text-xs font-bold text-slate-100 active:bg-slate-700"
        >
          SWITCH
        </button>
        <button
          type="button"
          onPointerDown={() => {
            touchInputRef.current.throughJustPressed = true;
          }}
          className="w-14 h-12 rounded-lg bg-sky-600/90 border border-sky-300/40 text-xs font-bold text-white active:bg-sky-500"
        >
          THRU
        </button>
        <button
          type="button"
          onPointerDown={() => {
            touchInputRef.current.chipJustPressed = true;
          }}
          className="w-14 h-12 rounded-lg bg-emerald-600/90 border border-emerald-300/40 text-xs font-bold text-white active:bg-emerald-500"
        >
          CHIP
        </button>
        <button
          type="button"
          onPointerDown={() => {
            touchInputRef.current.sprint = true;
          }}
          onPointerUp={() => {
            touchInputRef.current.sprint = false;
          }}
          onPointerCancel={() => {
            touchInputRef.current.sprint = false;
          }}
          className="w-14 h-12 rounded-lg bg-slate-900/90 border border-white/25 text-xs font-bold text-amber-300 active:bg-slate-700"
        >
          SPRINT
        </button>
        <button
          type="button"
          onPointerDown={() => {
            touchInputRef.current.passJustPressed = true;
          }}
          className="w-14 h-12 rounded-lg bg-indigo-600/90 border border-indigo-300/40 text-xs font-bold text-white active:bg-indigo-500"
        >
          PASS
        </button>
        <button
          type="button"
          onPointerDown={() => {
            touchInputRef.current.shootHeld = true;
            touchInputRef.current.shootJustPressed = true;
          }}
          onPointerUp={() => {
            touchInputRef.current.shootHeld = false;
            touchInputRef.current.shootJustReleased = true;
          }}
          onPointerCancel={() => {
            touchInputRef.current.shootHeld = false;
            touchInputRef.current.shootJustReleased = true;
          }}
          className="w-14 h-12 rounded-lg bg-rose-600/95 border border-rose-300/50 text-xs font-extrabold text-white active:bg-rose-500"
        >
          SHOOT
        </button>
      </div>
    </div>
  );
}
