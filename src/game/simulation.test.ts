import assert from 'node:assert/strict';
import test from 'node:test';
import { InputState, PITCH } from './constants';
import {
  computeCurveShotParameters,
  createInitialMatchState,
  getHudSnapshot,
  launchCornerCross,
  launchThrowInPass,
  rollGkTipOverCorner,
  rollHeaderSuccess,
  rollRandomCurveShot,
  setupCornerKickSetPiece,
  setupThrowInSetPiece,
  shootBall,
  stepBallPhysics,
  stepSimulation,
} from './simulation';
import { NATIONAL_TEAMS } from './teams';
import { createWorldCupTournament, recordTournamentMatchResult } from './tournament';

const NEUTRAL_INPUT: InputState = {
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
};

test('random curve luck triggers unpredictably around 1-in-3 odds', () => {
  assert.equal(rollRandomCurveShot(() => 0.05), true);
  assert.equal(rollRandomCurveShot(() => 0.32), true);
  assert.equal(rollRandomCurveShot(() => 0.34), false);
  assert.equal(rollRandomCurveShot(() => 0.95), false);

  // Deterministic LCG PRNG over 3000 rolls verifies ~33.3% random curve probability
  let seed = 1337;
  const prng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let curves = 0;
  for (let i = 0; i < 3000; i++) {
    if (rollRandomCurveShot(prng)) curves++;
  }
  const rate = curves / 3000;
  assert.ok(rate > 0.29 && rate < 0.38, `Expected ~0.333 random curve rate, got ${rate}`);
});

test('shootBall applies random curve rolls on any shot and updates HUD stats', () => {
  const state = createInitialMatchState('quick', 'medium');
  state.phase = 'live';
  const shooter = state.players.find((p) => p.team === 'home' && p.role === 'FWD')!;

  const sequence = [0.1, 0.85, 0.72, 0.25, 0.9, 0.15];
  let idx = 0;
  const seqRng = () => sequence[idx++ % sequence.length];

  const results: boolean[] = [];
  for (let i = 1; i <= 6; i++) {
    state.ball.x = 18;
    state.ball.y = 0.34;
    state.ball.z = 2;
    const isCurve = shootBall(state, shooter, 0.75, 1, 0, seqRng);
    results.push(isCurve);

    const hud = getHudSnapshot(state);
    assert.equal(hud.stats.homeShots, i);
  }

  assert.deepEqual(results, [true, false, false, true, false, true]);
  assert.equal(state.stats.homeCurveShots, 3);
});

test('curve shot swings outward laterally then bends back inward via Magnus spin and records trail', () => {
  const state = createInitialMatchState('quick', 'medium');
  state.phase = 'live';
  const shooter = state.players.find((p) => p.team === 'home' && p.role === 'FWD')!;
  // Clear defenders & GK out of path so ball flies freely through the air
  for (const p of state.players) {
    p.x = -30;
    p.z = -18;
  }

  state.ball.x = 14;
  state.ball.y = 0.34;
  state.ball.z = 1.5;
  const curved = shootBall(state, shooter, 0.8, 1, 0, () => 0.1);
  assert.equal(curved, true);
  assert.equal(state.ball.isCurveShot, true);

  const initialVz = state.ball.vz;
  assert.ok(initialVz > 5, `Expected strong positive outward vz launch, got ${initialVz}`);
  assert.ok(state.ball.spinY < -15, `Expected strong negative spinY to bend inward, got ${state.ball.spinY}`);

  let peakZ = state.ball.z;
  for (let step = 0; step < 30; step++) {
    stepBallPhysics(state, NEUTRAL_INPUT, 0.02);
    if (state.ball.z > peakZ) peakZ = state.ball.z;
  }

  // Ball swung outward significantly past start z=1.5, then bent back toward goal
  assert.ok(peakZ - 1.5 > 1.8, `Expected outward banana swing > 1.8m, got ${peakZ - 1.5}`);
  assert.ok(state.ball.vz < 0, `Expected Magnus force to reverse vz inward (< 0), got ${state.ball.vz}`);
  assert.ok(state.ball.z < peakZ - 0.5, `Expected ball to curl inward from peak ${peakZ}, now at ${state.ball.z}`);
  assert.ok(state.ball.curveTrail.length >= 6, `Expected curve trail points, got ${state.ball.curveTrail.length}`);
});

test('computeCurveShotParameters produces valid lofted curved trajectory for both wings', () => {
  const rightWing = computeCurveShotParameters({
    ballX: 15,
    ballY: 0.34,
    ballZ: 4,
    team: 'home',
    power: 0.8,
    aimDirX: 1,
    aimDirZ: 0,
  });
  assert.ok(rightWing.vx > 0 && rightWing.vy > 6);
  assert.ok(rightWing.vz > 0 && rightWing.spinY < 0);

  const leftWing = computeCurveShotParameters({
    ballX: 15,
    ballY: 0.34,
    ballZ: -4,
    team: 'home',
    power: 0.8,
    aimDirX: 1,
    aimDirZ: 0,
  });
  assert.ok(leftWing.vx > 0 && leftWing.vy > 6);
  assert.ok(leftWing.vz < 0 && leftWing.spinY > 0);
});

test('World Cup 32 bracket initializes 31 matches and advances user on victory', () => {
  const t = createWorldCupTournament(NATIONAL_TEAMS, 'bra', () => 0.4);
  assert.equal(t.matches.length, 31);
  const r0UserMatch = t.matches.find((m) => m.roundIndex === 0 && m.homeTeam?.id === 'bra');
  assert.ok(r0UserMatch);

  const next = recordTournamentMatchResult(t, r0UserMatch.id, 3, 1, null, () => 0.4);
  assert.equal(next.currentRound, 1);
  assert.equal(next.eliminated, false);
});

test('goalkeeper blocks curve shots when diving into path, but unreached corner shots still score', () => {
  // Case 1: Keeper dives into the curved ball path and blocks it
  const blockedState = createInitialMatchState('quick', 'medium');
  blockedState.phase = 'live';
  const shooter = blockedState.players.find((p) => p.team === 'home' && p.role === 'FWD')!;
  const awayGk = blockedState.players.find((p) => p.team === 'away' && p.role === 'GK')!;

  for (const p of blockedState.players) {
    if (p.id !== awayGk.id) {
      p.x = -30;
      p.z = -18;
    }
  }
  blockedState.ball.x = 22;
  blockedState.ball.y = 0.34;
  blockedState.ball.z = 0;
  assert.equal(shootBall(blockedState, shooter, 0.75, 1, 0, () => 0.1), true);

  awayGk.x = 32.85;
  awayGk.z = 0.2;
  awayGk.diveTimer = 0.55;
  awayGk.vz = 0;

  let saved = false;
  for (let i = 0; i < 40; i++) {
    stepBallPhysics(blockedState, NEUTRAL_INPUT, 0.02);
    if (blockedState.events.some((e) => e.type === 'save')) {
      saved = true;
      break;
    }
  }
  assert.equal(saved, true, 'Expected diving GK in path to block curve shot');
  assert.ok(blockedState.ball.vx < 0, 'Expected blocked ball to deflect away from goal');
  assert.equal(blockedState.ball.isCurveShot, false);

  // Case 2: Keeper dives the wrong way -> curve shot scores
  const scoredState = createInitialMatchState('quick', 'medium');
  scoredState.phase = 'live';
  const shooter2 = scoredState.players.find((p) => p.team === 'home' && p.role === 'FWD')!;
  const awayGk2 = scoredState.players.find((p) => p.team === 'away' && p.role === 'GK')!;
  for (const p of scoredState.players) {
    if (p.id !== awayGk2.id) {
      p.x = -30;
      p.z = -18;
    }
  }
  scoredState.ball.x = 22;
  scoredState.ball.y = 0.34;
  scoredState.ball.z = 1.5;
  assert.equal(shootBall(scoredState, shooter2, 0.75, 1, 0, () => 0.1), true);

  awayGk2.x = 32.85;
  awayGk2.z = -3.1;
  awayGk2.diveTimer = 0.55;
  awayGk2.vz = -4;

  for (let i = 0; i < 60; i++) {
    stepBallPhysics(scoredState, NEUTRAL_INPUT, 0.02);
    if (scoredState.homeScore > 0) break;
  }
  assert.equal(scoredState.homeScore, 1, 'Expected curve shot to score when keeper is beaten');
});

test('setupCornerKickSetPiece packs 6-yard box and enters corner_aim phase', () => {
  const state = createInitialMatchState('quick', 'medium');
  setupCornerKickSetPiece(state, {
    kind: 'corner',
    team: 'home',
    x: PITCH.HALF_LENGTH - 0.55,
    z: PITCH.HALF_WIDTH - 0.55,
  });

  assert.equal(state.phase, 'corner_aim');
  assert.ok(state.corner !== null);
  assert.ok(Math.abs(state.ball.x - (PITCH.HALF_LENGTH - 0.55)) < 0.05);
  assert.ok(Math.abs(state.ball.z - (PITCH.HALF_WIDTH - 0.55)) < 0.05);

  // Attacking and defending outfield players are packed near the 6-yard box
  const attackersInBox = state.players.filter(
    (p) => p.team === 'home' && p.role !== 'GK' && p.id !== state.corner!.takerId && p.x > PITCH.HALF_LENGTH - 15,
  );
  const defendersInBox = state.players.filter(
    (p) => p.team === 'away' && p.role !== 'GK' && p.x > PITCH.HALF_LENGTH - 15,
  );
  assert.ok(attackersInBox.length >= 4, `Expected >=4 attackers packed in box, got ${attackersInBox.length}`);
  assert.ok(defendersInBox.length >= 4, `Expected >=4 defenders packed in box, got ${defendersInBox.length}`);

  const awayGk = state.players.find((p) => p.team === 'away' && p.role === 'GK')!;
  assert.ok(awayGk.x > PITCH.HALF_LENGTH - 2.0, 'Expected defending GK positioned on the goal line');
});

test('launchCornerCross whips curved high cross into the box and switches control to box attacker', () => {
  const state = createInitialMatchState('quick', 'medium', true);
  assert.equal(state.phase, 'corner_aim');
  const takerId = state.corner!.takerId;

  launchCornerCross(state);

  assert.equal(state.phase, 'live');
  assert.equal(state.corner, null);
  assert.equal(state.ball.isCurveShot, true);
  assert.equal(state.ball.isCornerCross, true);
  assert.ok(state.ball.vy > 8, `Expected lofted corner cross vy > 8, got ${state.ball.vy}`);
  assert.ok(Math.abs(state.ball.spinY) > 6, `Expected curved spinY on corner cross, got ${state.ball.spinY}`);
  assert.notEqual(state.activePlayerId, takerId, 'Expected active player to switch from corner taker into the box');

  const active = state.players.find((p) => p.id === state.activePlayerId)!;
  assert.equal(active.team, 'home');
  assert.ok(active.x > PITCH.HALF_LENGTH - 10, 'Expected active player to be inside the box');
});

test('controlled player has a probabilistic chance of executing a header (sometimes, not all the time)', () => {
  // Deterministic check that controlled header luck succeeds sometimes (~62% on cross + action) and fails sometimes
  let seed = 42;
  const prng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let successes = 0;
  for (let i = 0; i < 2000; i++) {
    if (rollHeaderSuccess({ isControlled: true, isPressingAction: true, isCornerCross: true }, prng)) {
      successes++;
    }
  }
  const activeRate = successes / 2000;
  assert.ok(activeRate > 0.52 && activeRate < 0.72, `Expected ~0.62 header rate when pressing J, got ${activeRate}`);

  let passiveSuccesses = 0;
  for (let i = 0; i < 2000; i++) {
    if (rollHeaderSuccess({ isControlled: true, isPressingAction: false, isCornerCross: true }, prng)) {
      passiveSuccesses++;
    }
  }
  const passiveRate = passiveSuccesses / 2000;
  assert.ok(passiveRate > 0.24 && passiveRate < 0.40, `Expected ~0.32 passive header rate, got ${passiveRate}`);
  assert.ok(activeRate > passiveRate, 'Pressing action should increase header odds over passive');

  // Verify aerial header contact in stepBallPhysics drives the ball toward goal and sets cooldown
  const state = createInitialMatchState('quick', 'medium', true);
  launchCornerCross(state);
  const attacker = state.players.find((p) => p.id === state.activePlayerId)!;
  // Clear defenders far away so only controlled attacker contests this aerial ball
  for (const p of state.players) {
    if (p.id !== attacker.id) {
      p.x = -30;
      p.z = -18;
    }
  }
  // Place aerial ball at header height directly above controlled attacker
  state.ball.x = attacker.x + 0.2;
  state.ball.y = 1.65;
  state.ball.z = attacker.z;
  state.ball.vx = -2;
  state.ball.vy = -1.5;
  state.ball.vz = -4;

  // Run physics with shootHeld=true across multiple trials; check both header and non-header outcomes happen
  let sawHeader = false;
  let sawMiss = false;
  for (let trial = 0; trial < 30; trial++) {
    attacker.headerCooldown = 0;
    attacker.jumpTimer = 0;
    attacker.kickAnimTimer = 0;
    state.ball.x = attacker.x + 0.2;
    state.ball.y = 1.65;
    state.ball.z = attacker.z;
    state.ball.vx = -2;
    state.ball.vy = -1.5;
    state.ball.vz = -4;
    state.ball.isCornerCross = true;
    state.ball.lastTouchTeam = 'home';

    stepBallPhysics(state, { ...NEUTRAL_INPUT, shootHeld: true }, 0.02);
    assert.ok(attacker.headerCooldown > 0, 'Expected headerCooldown to prevent per-frame re-rolling');
    if (state.ball.vx > 12 && !state.ball.isCornerCross) {
      sawHeader = true;
    } else {
      sawMiss = true;
    }
  }
  assert.equal(sawHeader, true, 'Expected controlled player to execute aerial header sometimes');
  assert.equal(sawMiss, true, 'Expected controlled player not to win aerial header 100% of the time');
});

test('goalkeeper save rarely tips the ball over the bar for an attacking corner kick', () => {
  // 1) Probability test: tip-over corner happens occasionally (~15%), not often
  let seed = 9001;
  const prng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let tipOvers = 0;
  for (let i = 0; i < 2000; i++) {
    if (rollGkTipOverCorner(prng)) tipOvers++;
  }
  const tipRate = tipOvers / 2000;
  assert.ok(tipRate > 0.11 && tipRate < 0.19, `Expected rare ~0.15 tip-over rate, got ${tipRate}`);

  // 2) Normal save (rng >= 0.15) deflects forward back into play, NOT a corner
  const normalState = createInitialMatchState('quick', 'medium');
  normalState.phase = 'live';
  const shooter = normalState.players.find((p) => p.team === 'home' && p.role === 'FWD')!;
  const awayGk = normalState.players.find((p) => p.team === 'away' && p.role === 'GK')!;
  for (const p of normalState.players) {
    if (p.id !== awayGk.id) {
      p.x = -30;
      p.z = -18;
    }
  }
  normalState.ball.x = 29;
  normalState.ball.y = 0.8;
  normalState.ball.z = 0;
  shootBall(normalState, shooter, 0.75, 1, 0, () => 0.8);
  awayGk.x = 32.85;
  awayGk.z = 0;
  awayGk.diveTimer = 0.4;

  for (let i = 0; i < 30; i++) {
    stepBallPhysics(normalState, NEUTRAL_INPUT, 0.02, () => 0.65);
    if (normalState.events.some((e) => e.type === 'save')) break;
  }
  assert.ok(normalState.ball.vx < 0, 'Normal GK save should deflect ball back toward midfield');
  assert.equal(normalState.pendingSetPiece, null);

  // 3) Rare tip-over save (rng < 0.15) sends ball up over GK head & crossbar -> awards corner kick to home
  const tipState = createInitialMatchState('quick', 'medium');
  tipState.phase = 'live';
  const shooter2 = tipState.players.find((p) => p.team === 'home' && p.role === 'FWD')!;
  const awayGk2 = tipState.players.find((p) => p.team === 'away' && p.role === 'GK')!;
  for (const p of tipState.players) {
    if (p.id !== awayGk2.id) {
      p.x = -30;
      p.z = -18;
    }
  }
  tipState.ball.x = 30.8;
  tipState.ball.y = 1.1;
  tipState.ball.z = 0.4;
  shootBall(tipState, shooter2, 0.8, 1, 0, () => 0.8);
  awayGk2.x = 32.85;
  awayGk2.z = 0.4;
  awayGk2.diveTimer = 0.4;

  let sawSaveEvent = false;
  let clearedCrossbar = false;
  for (let i = 0; i < 45; i++) {
    stepBallPhysics(tipState, NEUTRAL_INPUT, 0.02, () => 0.05);
    if (tipState.events.some((e) => e.type === 'save')) {
      sawSaveEvent = true;
    }
    if (sawSaveEvent && tipState.ball.y > PITCH.GOAL_HEIGHT + 0.3) {
      clearedCrossbar = true;
    }
    if (tipState.pendingSetPiece) break;
  }

  assert.equal(sawSaveEvent, true, 'Expected GK save event on tip-over');
  assert.equal(clearedCrossbar, true, 'Expected tipped ball to soar over GK head and crossbar');
  assert.equal(tipState.homeScore, 0, 'Tip-over above crossbar must not count as a goal');
  assert.ok(tipState.pendingSetPiece !== null, 'Expected set piece after tipped ball crosses endline');
  assert.equal(tipState.pendingSetPiece?.kind, 'corner');
  assert.equal(tipState.pendingSetPiece?.team, 'home');

  // Stepping past set_piece_reset transitions cleanly into corner_aim for home
  for (let i = 0; i < 20; i++) {
    stepSimulation(tipState, NEUTRAL_INPUT, 0.04);
    if (getHudSnapshot(tipState).phase === 'corner_aim') break;
  }
  assert.equal(getHudSnapshot(tipState).phase, 'corner_aim');
  assert.equal(tipState.corner?.team, 'home');
});

test('setupThrowInSetPiece enters throw_in_aim with overhead ball, lets user switch target, and passes to teammate', () => {
  const state = createInitialMatchState('quick', 'medium');
  setupThrowInSetPiece(state, {
    kind: 'throw_in',
    team: 'home',
    x: 6,
    z: PITCH.HALF_WIDTH - 0.5,
  });

  assert.equal(getHudSnapshot(state).phase, 'throw_in_aim');
  assert.ok(state.throwIn !== null);
  const taker = state.players.find((p) => p.id === state.throwIn!.takerId)!;
  assert.ok(Math.abs(taker.z - (PITCH.HALF_WIDTH + 0.35)) < 0.05, 'Thrower stands on touchline');
  assert.ok(state.ball.y > 1.9, `Ball held overhead by thrower, got y=${state.ball.y}`);
  assert.ok(state.throwIn!.targetPlayerId !== null, 'Default receiving teammate selected');

  const firstTargetId = state.throwIn!.targetPlayerId;
  // Cycling teammate with Q/E (switchJustPressed) selects a different home teammate
  stepSimulation(state, { ...NEUTRAL_INPUT, switchJustPressed: true }, 0.02);
  const secondTargetId = state.throwIn!.targetPlayerId;
  assert.notEqual(secondTargetId, firstTargetId, 'Expected switchJustPressed to cycle throw-in target');

  // Pressing Pass (M) throws overhead pass toward the chosen teammate and switches control to them
  stepSimulation(state, { ...NEUTRAL_INPUT, passJustPressed: true }, 0.02);
  assert.equal(getHudSnapshot(state).phase, 'live');
  assert.equal(state.throwIn, null);
  assert.equal(state.activePlayerId, secondTargetId);
  assert.equal(state.ball.lastTouchTeam, 'home');
  assert.ok(state.ball.vz < -5, `Expected ball thrown inward across pitch (vz < -5), got ${state.ball.vz}`);
  assert.ok(state.ball.vy > 1.5, `Expected lofted two-handed throw trajectory, got vy=${state.ball.vy}`);
});




