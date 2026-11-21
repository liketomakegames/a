import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRadialDeadzone,
  createControllerSource,
  DEFAULT_KEYBOARD_SOURCE,
  detectControllerBrand,
  GamepadLike,
  getControlPrompts,
  pickActiveGamepad,
  pollGamepadState,
} from './controller';
import { createInitialMatchState, setMatchInputSource } from './simulation';

function makePad(
  id: string,
  overrides: { axes?: number[]; pressed?: number[]; values?: Record<number, number>; index?: number } = {},
): GamepadLike {
  const buttons = Array.from({ length: 17 }, (_, idx) => ({
    pressed: overrides.pressed?.includes(idx) ?? false,
    value: overrides.values?.[idx] ?? (overrides.pressed?.includes(idx) ? 1 : 0),
  }));
  return {
    id,
    index: overrides.index ?? 0,
    connected: true,
    mapping: 'standard',
    axes: overrides.axes ?? [0, 0, 0, 0],
    buttons,
  };
}

test('detectControllerBrand identifies PS5 DualSense, Nintendo Switch, and Xbox controllers', () => {
  assert.equal(detectControllerBrand('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'), 'ps5');
  assert.equal(detectControllerBrand('Sony Interactive Entertainment Wireless Controller'), 'ps5');
  assert.equal(detectControllerBrand('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'), 'switch');
  assert.equal(detectControllerBrand('Nintendo Switch Joy-Con (L+R)'), 'switch');
  assert.equal(detectControllerBrand('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'), 'xbox');
  assert.equal(detectControllerBrand('Microsoft X-Box One pad'), 'xbox');
});

test('applyRadialDeadzone filters stick drift and rescales active deflection', () => {
  assert.deepEqual(applyRadialDeadzone(0.1, -0.1, 0.2), { x: 0, y: 0 });
  const active = applyRadialDeadzone(0.6, 0, 0.2);
  assert.ok(active.x > 0.49 && active.x < 0.51);
  assert.equal(active.y, 0);
});

test('pollGamepadState handles movement, shot charge/release edges, pass/chip/through, sprint, switch, and pause', () => {
  const xboxId = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';

  // Frame 1: hold shoot (btn 1), move right with stick, hold RT sprint (btn 7 value 0.8), press switch (btn 4)
  const pad1 = makePad(xboxId, {
    axes: [0.85, -0.4, 0, 0],
    pressed: [1, 4],
    values: { 7: 0.85 },
  });
  const res1 = pollGamepadState(pad1, []);
  assert.equal(res1.hasActivity, true);
  assert.ok(res1.input.moveX > 0.6);
  assert.ok(res1.input.moveZ < -0.2);
  assert.equal(res1.input.shootHeld, true);
  assert.equal(res1.input.shootJustPressed, true);
  assert.equal(res1.input.shootJustReleased, false);
  assert.equal(res1.input.sprint, true);
  assert.equal(res1.input.switchJustPressed, true);

  // Frame 2: release shoot (btn 1 released), press Pass (btn 0) and Pause (btn 9)
  const pad2 = makePad(xboxId, {
    axes: [0, 0, 0, 0],
    pressed: [0, 9],
  });
  const res2 = pollGamepadState(pad2, res1.buttonsDown);
  assert.equal(res2.input.shootHeld, false);
  assert.equal(res2.input.shootJustPressed, false);
  assert.equal(res2.input.shootJustReleased, true);
  assert.equal(res2.input.passJustPressed, true);
  assert.equal(res2.pauseJustPressed, true);
});

test('getControlPrompts and setMatchInputSource update prompts dynamically across keyboard, PS5, Switch, and Xbox', () => {
  const kbPrompts = getControlPrompts(DEFAULT_KEYBOARD_SOURCE);
  assert.equal(kbPrompts.badgeLabel, 'KEY BINDS');
  assert.equal(kbPrompts.shoot, 'J');

  const ps5Source = createControllerSource('DualSense Wireless Controller (Vendor: 054c Product: 0ce6)');
  const ps5Prompts = getControlPrompts(ps5Source);
  assert.equal(ps5Prompts.badgeLabel, 'PS5');
  assert.equal(ps5Prompts.shoot, '◯');
  assert.equal(ps5Prompts.pass, '✕');
  assert.equal(ps5Prompts.pause, 'Options');

  const switchSource = createControllerSource('Nintendo Switch Pro Controller (Vendor: 057e Product: 2009)');
  const switchPrompts = getControlPrompts(switchSource);
  assert.equal(switchPrompts.badgeLabel, 'SWITCH');
  assert.equal(switchPrompts.shoot, 'A');
  assert.equal(switchPrompts.pass, 'B');
  assert.equal(switchPrompts.pause, '+');

  // Verify live set-piece & penalty banners react immediately when switching devices
  const cornerState = createInitialMatchState('quick', 'medium', true, false);
  assert.ok(cornerState.banner?.subtitle.includes('WASD'));
  setMatchInputSource(cornerState, ps5Source);
  assert.ok(cornerState.banner?.subtitle.includes('◯'));

  const penState = createInitialMatchState('penalty', 'medium');
  assert.ok(penState.penalty?.bannerText.includes('WASD/ARROWS'));
  setMatchInputSource(penState, switchSource);
  assert.ok(penState.penalty?.bannerText.includes('L-STICK'));
  assert.ok(penState.penalty?.bannerText.includes('HOLD & RELEASE A'));

  setMatchInputSource(penState, DEFAULT_KEYBOARD_SOURCE);
  assert.ok(penState.penalty?.bannerText.includes('WASD/ARROWS'));
});

test('pickActiveGamepad prefers requested index when connected and falls back cleanly', () => {
  const pad0 = makePad('Xbox Controller', { index: 0 });
  const pad1 = makePad('DualSense Wireless Controller', { index: 1 });
  assert.equal(pickActiveGamepad([pad0, pad1], 1)?.id, 'DualSense Wireless Controller');
  assert.equal(pickActiveGamepad([null, pad1], 0)?.id, 'DualSense Wireless Controller');
  assert.equal(pickActiveGamepad([null, null], 0), null);
});
