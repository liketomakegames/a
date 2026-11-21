import { useEffect, useRef } from 'react';
import { soundEngine } from '../game/audio';
import { Difficulty, HudSnapshot, InputState, MatchMode, MatchState, TeamConfig } from '../game/constants';
import {
  createControllerSource,
  DEFAULT_KEYBOARD_SOURCE,
  GamepadLike,
  InputSourceInfo,
  pickActiveGamepad,
  pollGamepadState,
  triggerGamepadHaptic,
} from '../game/controller';
import { PitchRenderer } from '../game/renderer';
import {
  createInitialMatchState,
  getHudSnapshot,
  setMatchInputSource,
  stepSimulation,
} from '../game/simulation';

export interface TouchInputRef {
  moveX: number;
  moveZ: number;
  sprint: boolean;
  shootHeld: boolean;
  shootJustPressed: boolean;
  shootJustReleased: boolean;
  passJustPressed: boolean;
  throughJustPressed: boolean;
  chipJustPressed: boolean;
  switchJustPressed: boolean;
}

interface GameCanvasProps {
  mode: MatchMode;
  difficulty: Difficulty;
  paused: boolean;
  isPlayingScreen: boolean;
  matchKey: number;
  initialCorner?: boolean;
  initialThrowIn?: boolean;
  homeTeam: TeamConfig;
  awayTeam: TeamConfig;
  touchInputRef: React.MutableRefObject<TouchInputRef>;
  onHudUpdate: (hud: HudSnapshot) => void;
  onMatchComplete: (hud: HudSnapshot) => void;
  onTogglePause: () => void;
  onInputSourceChange: (source: InputSourceInfo) => void;
  onControllerConfirmMenu: () => void;
  onControllerCancelMenu: () => void;
}

function sameInputSource(a: InputSourceInfo, b: InputSourceInfo): boolean {
  return a.mode === b.mode && a.brand === b.brand && a.label === b.label;
}

function moveMenuButtonFocus(step: 1 | -1): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')).filter(
    (btn) => btn.tabIndex !== -1 && btn.offsetParent !== null,
  );
  if (buttons.length === 0) return;
  const currentIdx = buttons.findIndex((b) => b === document.activeElement);
  const nextIdx =
    currentIdx === -1
      ? step === 1
        ? 0
        : buttons.length - 1
      : (currentIdx + step + buttons.length) % buttons.length;
  buttons[nextIdx]?.focus();
}

export function GameCanvas({
  mode,
  difficulty,
  paused,
  isPlayingScreen,
  matchKey,
  initialCorner = false,
  initialThrowIn = false,
  homeTeam,
  awayTeam,
  touchInputRef,
  onHudUpdate,
  onMatchComplete,
  onTogglePause,
  onInputSourceChange,
  onControllerConfirmMenu,
  onControllerCancelMenu,
}: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<PitchRenderer | null>(null);
  const simRef = useRef<MatchState>(createInitialMatchState(mode, difficulty, initialCorner, initialThrowIn));
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const isPlayingScreenRef = useRef(isPlayingScreen);
  isPlayingScreenRef.current = isPlayingScreen;

  const inputSourceRef = useRef<InputSourceInfo>({ ...DEFAULT_KEYBOARD_SOURCE });
  const activeGamepadIndexRef = useRef<number | null>(null);

  const callbacksRef = useRef({
    onHudUpdate,
    onMatchComplete,
    onTogglePause,
    onInputSourceChange,
    onControllerConfirmMenu,
    onControllerCancelMenu,
  });
  callbacksRef.current = {
    onHudUpdate,
    onMatchComplete,
    onTogglePause,
    onInputSourceChange,
    onControllerConfirmMenu,
    onControllerCancelMenu,
  };
  const completedRef = useRef(false);

  useEffect(() => {
    const nextSim = createInitialMatchState(mode, difficulty, initialCorner, initialThrowIn);
    setMatchInputSource(nextSim, inputSourceRef.current);
    simRef.current = nextSim;
    completedRef.current = false;
    callbacksRef.current.onHudUpdate(getHudSnapshot(simRef.current));
  }, [mode, difficulty, matchKey, initialCorner, initialThrowIn]);

  useEffect(() => {
    rendererRef.current?.updateTeamColors(homeTeam, awayTeam);
  }, [homeTeam, awayTeam]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new PitchRenderer(container, homeTeam, awayTeam);
    rendererRef.current = renderer;

    const keysDown = new Set<string>();
    const justPressed = new Set<string>();
    const justReleased = new Set<string>();
    let prevPadButtons: boolean[] = [];

    const setSensedInputSource = (next: InputSourceInfo) => {
      if (!sameInputSource(inputSourceRef.current, next)) {
        inputSourceRef.current = next;
        setMatchInputSource(simRef.current, next);
        callbacksRef.current.onInputSourceChange(next);
      } else {
        setMatchInputSource(simRef.current, next);
      }
    };

    const readGamepads = (): readonly (GamepadLike | null | undefined)[] => {
      try {
        return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
          ? (navigator.getGamepads() as readonly (GamepadLike | null)[])
          : [];
      } catch {
        return [];
      }
    };

    const onGamepadConnected = (e: GamepadEvent) => {
      activeGamepadIndexRef.current = e.gamepad.index;
      setSensedInputSource(createControllerSource(e.gamepad.id));
    };

    const onGamepadDisconnected = (e: GamepadEvent) => {
      if (activeGamepadIndexRef.current === e.gamepad.index) {
        activeGamepadIndexRef.current = null;
      }
      const remaining = pickActiveGamepad(readGamepads(), activeGamepadIndexRef.current);
      if (remaining) {
        activeGamepadIndexRef.current = remaining.index;
        setSensedInputSource(createControllerSource(remaining.id));
      } else {
        prevPadButtons = [];
        setSensedInputSource({ ...DEFAULT_KEYBOARD_SOURCE });
      }
    };

    // Detect if a controller is already connected on mount
    const initialPad = pickActiveGamepad(readGamepads(), null);
    if (initialPad) {
      activeGamepadIndexRef.current = initialPad.index;
      setSensedInputSource(createControllerSource(initialPad.id));
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      const code = e.code;
      const isModifierOnly =
        code === 'ShiftLeft' ||
        code === 'ShiftRight' ||
        code === 'ControlLeft' ||
        code === 'ControlRight' ||
        code === 'AltLeft' ||
        code === 'AltRight' ||
        code === 'MetaLeft' ||
        code === 'MetaRight';

      if (!isModifierOnly) {
        setSensedInputSource({ ...DEFAULT_KEYBOARD_SOURCE });
      }

      if (
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight' ||
        code === 'Space'
      ) {
        e.preventDefault();
      }
      soundEngine.unlock();

      if (code === 'Escape' && !e.repeat) {
        callbacksRef.current.onTogglePause();
        return;
      }

      if (!keysDown.has(code)) {
        justPressed.add(code);
      }
      keysDown.add(code);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const code = e.code;
      if (keysDown.has(code)) {
        keysDown.delete(code);
        justReleased.add(code);
      }
    };

    const clearKeys = () => {
      keysDown.clear();
      justPressed.clear();
      justReleased.clear();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearKeys);
    window.addEventListener('gamepadconnected', onGamepadConnected);
    window.addEventListener('gamepaddisconnected', onGamepadDisconnected);
    document.addEventListener('visibilitychange', clearKeys);

    let hudAccum = 0;

    renderer.startLoop((dt) => {
      const state = simRef.current;
      const touch = touchInputRef.current;

      const activePad = pickActiveGamepad(readGamepads(), activeGamepadIndexRef.current);
      if (activePad) {
        activeGamepadIndexRef.current = activePad.index;
      }
      const padPoll = pollGamepadState(activePad, prevPadButtons);
      prevPadButtons = padPoll.buttonsDown;

      if (padPoll.hasActivity && activePad) {
        soundEngine.unlock();
        setSensedInputSource(createControllerSource(activePad.id));
      }

      if (padPoll.pauseJustPressed) {
        callbacksRef.current.onTogglePause();
      } else if (!isPlayingScreenRef.current) {
        if (padPoll.dpadDownJustPressed || padPoll.dpadRightJustPressed) {
          moveMenuButtonFocus(1);
        } else if (padPoll.dpadUpJustPressed || padPoll.dpadLeftJustPressed) {
          moveMenuButtonFocus(-1);
        } else if (padPoll.confirmJustPressed) {
          const focused = document.activeElement;
          if (focused instanceof HTMLButtonElement && focused.offsetParent !== null) {
            focused.click();
          } else {
            callbacksRef.current.onControllerConfirmMenu();
          }
        } else if (padPoll.cancelJustPressed) {
          callbacksRef.current.onControllerCancelMenu();
        }
      }

      if (!pausedRef.current) {
        let moveX = touch.moveX + padPoll.input.moveX;
        let moveZ = touch.moveZ + padPoll.input.moveZ;
        if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) moveX -= 1;
        if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) moveX += 1;
        if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) moveZ -= 1;
        if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) moveZ += 1;
        moveX = Math.max(-1, Math.min(1, moveX));
        moveZ = Math.max(-1, Math.min(1, moveZ));

        const input: InputState = {
          moveX,
          moveZ,
          sprint: keysDown.has('KeyO') || keysDown.has('KeyP') || touch.sprint || padPoll.input.sprint,
          shootHeld: keysDown.has('KeyJ') || touch.shootHeld || padPoll.input.shootHeld,
          shootJustPressed:
            justPressed.has('KeyJ') || touch.shootJustPressed || padPoll.input.shootJustPressed,
          shootJustReleased:
            justReleased.has('KeyJ') || touch.shootJustReleased || padPoll.input.shootJustReleased,
          passJustPressed:
            justPressed.has('KeyM') || touch.passJustPressed || padPoll.input.passJustPressed,
          throughJustPressed:
            justPressed.has('KeyI') || touch.throughJustPressed || padPoll.input.throughJustPressed,
          chipJustPressed:
            justPressed.has('KeyL') || touch.chipJustPressed || padPoll.input.chipJustPressed,
          switchJustPressed:
            justPressed.has('KeyQ') ||
            justPressed.has('KeyE') ||
            touch.switchJustPressed ||
            padPoll.input.switchJustPressed,
        };

        justPressed.clear();
        justReleased.clear();
        touch.shootJustPressed = false;
        touch.shootJustReleased = false;
        touch.passJustPressed = false;
        touch.throughJustPressed = false;
        touch.chipJustPressed = false;
        touch.switchJustPressed = false;

        stepSimulation(state, input, dt);

        const rumblePad = inputSourceRef.current.mode === 'controller' ? activePad : null;

        for (const ev of state.events) {
          if (ev.type === 'kick') {
            if (ev.isCurveShot) {
              soundEngine.playCurveKick(ev.power);
              triggerGamepadHaptic(rumblePad, 0.55, 0.75, 140);
            } else {
              soundEngine.playKick(ev.power, ev.isPass);
              if (!ev.isPass) {
                triggerGamepadHaptic(rumblePad, 0.35, 0.4, 85);
              }
            }
          } else if (ev.type === 'postHit') {
            soundEngine.playPostHit();
            triggerGamepadHaptic(rumblePad, 0.7, 0.5, 160);
          } else if (ev.type === 'netHit') {
            soundEngine.playNetSwoosh();
          } else if (ev.type === 'whistle') {
            soundEngine.playWhistle(ev.kind);
          } else if (ev.type === 'tackle') {
            soundEngine.playTackle();
            triggerGamepadHaptic(rumblePad, 0.5, 0.3, 110);
          } else if (ev.type === 'goal') {
            soundEngine.playGoalCelebration();
            triggerGamepadHaptic(rumblePad, 0.9, 0.9, 280);
          } else if (ev.type === 'card') {
            soundEngine.playCardSting(ev.card);
          }
        }
        soundEngine.setCrowdExcitement(state.crowdExcitement);

        if (state.phase === 'fulltime' && !completedRef.current) {
          completedRef.current = true;
          callbacksRef.current.onMatchComplete(getHudSnapshot(state));
        }
      }

      renderer.syncFromSimulation(state, pausedRef.current ? 0 : dt);

      hudAccum += dt;
      if (hudAccum >= 0.08) {
        hudAccum = 0;
        callbacksRef.current.onHudUpdate(getHudSnapshot(state));
      }
    });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearKeys);
      window.removeEventListener('gamepadconnected', onGamepadConnected);
      window.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
      document.removeEventListener('visibilitychange', clearKeys);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="game-canvas-container"
      className="fixed inset-0 w-full h-full overflow-hidden bg-slate-950"
    />
  );
}
