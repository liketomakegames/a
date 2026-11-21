import { InputState } from './constants';

export type ControllerBrand = 'ps5' | 'switch' | 'xbox';
export type InputMode = 'keyboard' | 'controller';

export interface InputSourceInfo {
  mode: InputMode;
  brand: ControllerBrand | null;
  label: string;
  controllerId?: string;
}

export const DEFAULT_KEYBOARD_SOURCE: InputSourceInfo = {
  mode: 'keyboard',
  brand: null,
  label: 'KEY BINDS',
};

export interface ControllerButtonSpec {
  brand: ControllerBrand;
  name: string;
  shortLabel: string;
  move: string;
  shoot: string;
  pass: string;
  through: string;
  chip: string;
  sprint: string;
  switchPlayer: string;
  pause: string;
  confirm: string;
  cancel: string;
}

export interface ControlPrompts {
  badgeLabel: string;
  move: string;
  shoot: string;
  pass: string;
  through: string;
  chip: string;
  sprint: string;
  switchPlayer: string;
  pause: string;
  penaltyAim: string;
  penaltyDefend: string;
  cornerAim: string;
  cornerHeader: string;
  throwInAim: string;
  pauseHint: string;
}

export interface GamepadButtonLike {
  pressed: boolean;
  value?: number;
}

export interface GamepadLike {
  id: string;
  index: number;
  connected: boolean;
  mapping?: string;
  axes: readonly number[];
  buttons: readonly GamepadButtonLike[];
}

export interface GamepadPollResult {
  input: InputState;
  buttonsDown: boolean[];
  hasActivity: boolean;
  pauseJustPressed: boolean;
  confirmJustPressed: boolean;
  cancelJustPressed: boolean;
  dpadUpJustPressed: boolean;
  dpadDownJustPressed: boolean;
  dpadLeftJustPressed: boolean;
  dpadRightJustPressed: boolean;
}

const CONTROLLER_SPECS: Record<ControllerBrand, ControllerButtonSpec> = {
  ps5: {
    brand: 'ps5',
    name: 'PS5 DualSense',
    shortLabel: 'PS5',
    move: 'L-Stick / D-Pad',
    shoot: '◯',
    pass: '✕',
    through: '△',
    chip: '▢',
    sprint: 'R2 / R1',
    switchPlayer: 'L1',
    pause: 'Options',
    confirm: '✕',
    cancel: '◯',
  },
  switch: {
    brand: 'switch',
    name: 'Switch Controller',
    shortLabel: 'SWITCH',
    move: 'L-Stick / D-Pad',
    shoot: 'A',
    pass: 'B',
    through: 'X',
    chip: 'Y',
    sprint: 'ZR / R',
    switchPlayer: 'L',
    pause: '+',
    confirm: 'A',
    cancel: 'B',
  },
  xbox: {
    brand: 'xbox',
    name: 'Xbox Controller',
    shortLabel: 'XBOX',
    move: 'L-Stick / D-Pad',
    shoot: 'B',
    pass: 'A',
    through: 'Y',
    chip: 'X',
    sprint: 'RT / RB',
    switchPlayer: 'LB',
    pause: 'Menu',
    confirm: 'A',
    cancel: 'B',
  },
};

export function detectControllerBrand(gamepadId: string): ControllerBrand {
  const id = (gamepadId || '').toLowerCase();
  if (/xbox|xinput|microsoft|045e/.test(id)) {
    return 'xbox';
  }
  if (/nintendo|switch|pro controller|joy-?con|057e|2009|2006|2007/.test(id)) {
    return 'switch';
  }
  if (
    /dualsense|dualshock|playstation|sony|wireless controller|054c|0ce6|0df2|09cc|05c4/.test(id)
  ) {
    return 'ps5';
  }
  return 'xbox';
}

export function getControllerSpec(brand: ControllerBrand): ControllerButtonSpec {
  return CONTROLLER_SPECS[brand];
}

export function createControllerSource(gamepadId: string): InputSourceInfo {
  const brand = detectControllerBrand(gamepadId);
  const spec = getControllerSpec(brand);
  return {
    mode: 'controller',
    brand,
    label: `${spec.shortLabel} CONTROLLER`,
    controllerId: gamepadId,
  };
}

export function getControlPrompts(source: InputSourceInfo): ControlPrompts {
  if (source.mode === 'controller' && source.brand) {
    const spec = getControllerSpec(source.brand);
    return {
      badgeLabel: spec.shortLabel,
      move: spec.move,
      shoot: spec.shoot,
      pass: spec.pass,
      through: spec.through,
      chip: spec.chip,
      sprint: spec.sprint,
      switchPlayer: spec.switchPlayer,
      pause: spec.pause,
      penaltyAim: `YOUR PENALTY — AIM WITH L-STICK · HOLD & RELEASE ${spec.shoot}`,
      penaltyDefend: `DEFEND GOAL — PRESS ${spec.shoot} + L-STICK LEFT/RIGHT TO DIVE!`,
      cornerAim: `AIM BOX (L-STICK) · PRESS ${spec.shoot} TO WHIP CROSS!`,
      cornerHeader: `PRESS ${spec.shoot} TO CONTEST THE HEADER!`,
      throwInAim: `AIM TEAMMATE (L-STICK / ${spec.switchPlayer}) · PRESS ${spec.pass} OR ${spec.shoot} TO THROW!`,
      pauseHint: `Press ${spec.pause} or Resume to continue`,
    };
  }

  return {
    badgeLabel: 'KEY BINDS',
    move: 'WASD / Arrows',
    shoot: 'J',
    pass: 'M',
    through: 'I',
    chip: 'L',
    sprint: 'O / P',
    switchPlayer: 'Q / E',
    pause: 'Escape',
    penaltyAim: 'YOUR PENALTY — AIM WITH WASD/ARROWS · HOLD & RELEASE J',
    penaltyDefend: 'DEFEND GOAL — PRESS J + LEFT/RIGHT TO DIVE!',
    cornerAim: 'AIM BOX (WASD) · PRESS J TO WHIP CROSS!',
    cornerHeader: 'PRESS J TO CONTEST THE HEADER!',
    throwInAim: 'AIM TEAMMATE (WASD / Q·E) · PRESS M OR J TO THROW!',
    pauseHint: 'Press Escape or Resume to continue',
  };
}

export function applyRadialDeadzone(
  rawX: number,
  rawY: number,
  deadzone = 0.2,
): { x: number; y: number } {
  const mag = Math.hypot(rawX, rawY);
  if (mag <= deadzone) {
    return { x: 0, y: 0 };
  }
  const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  return {
    x: (rawX / mag) * scaled,
    y: (rawY / mag) * scaled,
  };
}

function isButtonActive(btn: GamepadButtonLike | undefined, threshold = 0.35): boolean {
  if (!btn) return false;
  return Boolean(btn.pressed) || (typeof btn.value === 'number' && btn.value > threshold);
}

const STANDARD_BUTTON_COUNT = 17;

export function pollGamepadState(
  gamepad: GamepadLike | null,
  prevButtons: readonly boolean[],
): GamepadPollResult {
  const buttonsDown = new Array<boolean>(STANDARD_BUTTON_COUNT).fill(false);

  if (!gamepad || !gamepad.connected) {
    return {
      input: {
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
      },
      buttonsDown,
      hasActivity: false,
      pauseJustPressed: false,
      confirmJustPressed: false,
      cancelJustPressed: false,
      dpadUpJustPressed: false,
      dpadDownJustPressed: false,
      dpadLeftJustPressed: false,
      dpadRightJustPressed: false,
    };
  }

  for (let i = 0; i < STANDARD_BUTTON_COUNT; i++) {
    const threshold = i === 6 || i === 7 ? 0.3 : 0.45;
    buttonsDown[i] = isButtonActive(gamepad.buttons[i], threshold);
  }

  const justPressed = (idx: number) => buttonsDown[idx] && !prevButtons[idx];
  const justReleased = (idx: number) => !buttonsDown[idx] && Boolean(prevButtons[idx]);

  const rawStickX = gamepad.axes[0] ?? 0;
  const rawStickY = gamepad.axes[1] ?? 0;
  const stick = applyRadialDeadzone(rawStickX, rawStickY, 0.2);

  let moveX = stick.x;
  let moveZ = stick.y;
  if (buttonsDown[14]) moveX -= 1; // D-pad Left
  if (buttonsDown[15]) moveX += 1; // D-pad Right
  if (buttonsDown[12]) moveZ -= 1; // D-pad Up
  if (buttonsDown[13]) moveZ += 1; // D-pad Down
  moveX = Math.max(-1, Math.min(1, moveX));
  moveZ = Math.max(-1, Math.min(1, moveZ));

  // Modern arcade football layout on standard W3C mapping:
  // 0 (Bottom: A / Cross / B) = Pass
  // 1 (Right: B / Circle / A) = Shoot / Slide / Dive
  // 2 (Left: X / Square / Y) = Chip
  // 3 (Top: Y / Triangle / X) = Through
  // 4 (LB / L1 / L) or 6 (LT / L2 / ZL) = Switch Player
  // 5 (RB / R1 / R) or 7 (RT / R2 / ZR) = Sprint
  // 9 (Menu / Options / +) = Pause
  const passJustPressed = justPressed(0);
  const shootHeld = buttonsDown[1];
  const shootJustPressed = justPressed(1);
  const shootJustReleased = justReleased(1);
  const chipJustPressed = justPressed(2);
  const throughJustPressed = justPressed(3);
  const switchJustPressed = justPressed(4) || justPressed(6);
  const sprint = buttonsDown[5] || buttonsDown[7];
  const pauseJustPressed = justPressed(9);

  // Menu navigation convenience: Switch physical button 1=A confirm vs 0=B cancel, while PS5/Xbox 0=confirm, 1=cancel
  const brand = detectControllerBrand(gamepad.id);
  const confirmJustPressed =
    brand === 'switch'
      ? justPressed(1) || justPressed(9)
      : justPressed(0) || justPressed(9);
  const cancelJustPressed = brand === 'switch' ? justPressed(0) : justPressed(1) || justPressed(8);

  const anyButtonActive = buttonsDown.some(Boolean);
  const stickActive = Math.hypot(stick.x, stick.y) > 0.22;

  return {
    input: {
      moveX,
      moveZ,
      sprint,
      shootHeld,
      shootJustPressed,
      shootJustReleased,
      passJustPressed,
      throughJustPressed,
      chipJustPressed,
      switchJustPressed,
    },
    buttonsDown,
    hasActivity: anyButtonActive || stickActive,
    pauseJustPressed,
    confirmJustPressed,
    cancelJustPressed,
    dpadUpJustPressed: justPressed(12),
    dpadDownJustPressed: justPressed(13),
    dpadLeftJustPressed: justPressed(14),
    dpadRightJustPressed: justPressed(15),
  };
}

export function pickActiveGamepad(
  gamepads: readonly (GamepadLike | null | undefined)[],
  preferredIndex?: number | null,
): GamepadLike | null {
  if (preferredIndex !== undefined && preferredIndex !== null) {
    const preferred = gamepads[preferredIndex];
    if (preferred && preferred.connected) {
      return preferred;
    }
  }
  for (const gp of gamepads) {
    if (gp && gp.connected) {
      return gp;
    }
  }
  return null;
}

export function triggerGamepadHaptic(
  gamepad: GamepadLike | null | undefined,
  strongMagnitude: number,
  weakMagnitude: number,
  durationMs: number,
): void {
  if (!gamepad) return;
  const gpAny = gamepad as unknown as {
    vibrationActuator?: {
      playEffect?: (
        type: string,
        params: {
          startDelay: number;
          duration: number;
          weakMagnitude: number;
          strongMagnitude: number;
        },
      ) => Promise<unknown>;
    };
  };
  try {
    gpAny.vibrationActuator?.playEffect?.('dual-rumble', {
      startDelay: 0,
      duration: durationMs,
      weakMagnitude: Math.max(0, Math.min(1, weakMagnitude)),
      strongMagnitude: Math.max(0, Math.min(1, strongMagnitude)),
    });
  } catch {
    // Ignore unsupported browser haptic errors
  }
}
