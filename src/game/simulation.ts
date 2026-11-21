import {
  BallState,
  CURVE_SHOT_CHANCE,
  Difficulty,
  FORMATION_7V7,
  FormationSlot,
  GK_TIP_OVER_CORNER_CHANCE,
  HudSnapshot,
  InputState,
  MatchMode,
  MatchState,
  PenaltyState,
  PITCH,
  PlayerState,
  SetPieceState,
  TeamSide,
} from './constants';
import { DEFAULT_KEYBOARD_SOURCE, getControlPrompts, InputSourceInfo } from './controller';

interface DifficultyTuning {
  reactionDelay: number;
  passAccuracy: number;
  shotAccuracy: number;
  aiSpeedScale: number;
  gkReaction: number;
  tackleRate: number;
}

const GRAVITY = 25;
const MAX_TRAIL_POINTS = 16;
const TRAIL_SAMPLE_DISTANCE = 0.72;

export function rollRandomCurveShot(rng: () => number = Math.random): boolean {
  return rng() < CURVE_SHOT_CHANCE;
}

export function rollGkTipOverCorner(rng: () => number = Math.random): boolean {
  return rng() < GK_TIP_OVER_CORNER_CHANCE;
}

export function rollHeaderSuccess(
  params: { isControlled: boolean; isPressingAction: boolean; isCornerCross: boolean },
  rng: () => number = Math.random,
): boolean {
  const { isControlled, isPressingAction, isCornerCross } = params;
  if (isControlled && isPressingAction) {
    return rng() < (isCornerCross ? 0.62 : 0.54);
  }
  if (isControlled) {
    return rng() < (isCornerCross ? 0.32 : 0.24);
  }
  return rng() < (isCornerCross ? 0.36 : 0.25);
}

export interface CurveShotResult {
  vx: number;
  vy: number;
  vz: number;
  spinY: number;
  curveDirection: number;
}

export function computeCurveShotParameters(params: {
  ballX: number;
  ballY: number;
  ballZ: number;
  team: TeamSide;
  power: number;
  aimDirX: number;
  aimDirZ: number;
}): CurveShotResult {
  const { ballX, ballZ, team, power, aimDirX, aimDirZ } = params;
  const clampedPower = Math.max(0.32, Math.min(1, power));
  const goalSign = team === 'home' ? 1 : -1;
  const goalX = goalSign * PITCH.HALF_LENGTH;

  // Normalize aim vector, biasing toward attacking goal if player aims generally forward
  const aimMag = Math.hypot(aimDirX, aimDirZ) || 1;
  let fx = aimDirX / aimMag;
  let fz = aimDirZ / aimMag;

  // When generally facing opponent goal, aim cleanly toward a corner inside the frame
  if (fx * goalSign > 0.2) {
    const dxToGoal = goalX - ballX;
    const projectedZ = ballZ + (fz / Math.max(0.35, Math.abs(fx))) * Math.abs(dxToGoal);
    const targetZ = Math.max(
      -PITCH.GOAL_HALF_WIDTH * 0.78,
      Math.min(PITCH.GOAL_HALF_WIDTH * 0.78, projectedZ * 0.65),
    );
    const tx = goalX - ballX;
    const tz = targetZ - ballZ;
    const tMag = Math.hypot(tx, tz) || 1;
    fx = tx / tMag;
    fz = tz / tMag;
  }

  // Choose dramatic outward curl direction (matching image: whip wide then bend into goal)
  let curveDirection: number;
  if (Math.abs(aimDirZ) > 0.35) {
    curveDirection = Math.sign(aimDirZ);
  } else {
    curveDirection = ballZ >= -1 ? 1 : -1;
  }

  // Unit perpendicular vector matching Magnus convention: perp = (-vz/speed, vx/speed)
  const px = -fz;
  const pz = fx;

  const baseSpeed = 21 + clampedPower * 14;
  const launchSpeed = baseSpeed * 1.12;
  const distToTarget =
    fx * goalSign > 0.2
      ? Math.max(11, Math.min(28, Math.hypot(goalX - ballX, ballZ)))
      : 18;
  const flightTime = distToTarget / baseSpeed;

  // Outward launch angle (~29 deg) that whips back inward via strong Magnus spin
  const outwardAngle = 0.51;
  const cosA = Math.cos(outwardAngle);
  const sinA = Math.sin(outwardAngle);

  const launchDirX = fx * cosA + curveDirection * px * sinA;
  const launchDirZ = fz * cosA + curveDirection * pz * sinA;

  const vx = launchDirX * launchSpeed;
  const vz = launchDirZ * launchSpeed;

  // Initial lateral speed perpendicular to target line
  const vPerp0 = curveDirection * launchSpeed * sinA;
  // Required lateral Magnus acceleration to bend back to target line by flightTime
  const requiredMagnusAccel = (-2.18 * vPerp0) / Math.max(0.36, flightTime);
  const curveMagnusFactor = 1.45;
  const spinY = Math.max(-52, Math.min(52, requiredMagnusAccel / curveMagnusFactor));

  // Lofted arc rising into top corner before dipping
  const vy = 5.4 + clampedPower * 4.2;

  return { vx, vy, vz, spinY, curveDirection };
}

export function predictBallGoalLineZ(ball: BallState, goalLineX: number): number {
  const vx = ball.vx;
  if (Math.abs(vx) < 1) return ball.z;
  const dx = goalLineX - ball.x;
  if (dx * vx <= 0) return ball.z;

  const t = Math.min(0.95, dx / vx);
  const speed = Math.hypot(ball.vx, ball.vz) || 1;
  const perpZ = ball.vx / speed;
  const magnusFactor = ball.isCurveShot ? 1.45 : 1.15;
  const accelZ = ball.isCurveShot || Math.abs(ball.spinY) > 0.5 ? ball.spinY * magnusFactor * perpZ : 0;
  return ball.z + ball.vz * t + 0.5 * accelZ * t * t;
}

function getSlotWorldPos(slot: FormationSlot, team: TeamSide): { x: number; z: number } {
  const dir = team === 'home' ? 1 : -1;
  return {
    x: slot.relX * PITCH.HALF_LENGTH * dir,
    z: slot.relZ * PITCH.HALF_WIDTH * dir,
  };
}

function getDifficultyTuning(difficulty: Difficulty): DifficultyTuning {
  switch (difficulty) {
    case 'easy':
      return {
        reactionDelay: 0.45,
        passAccuracy: 0.65,
        shotAccuracy: 0.6,
        aiSpeedScale: 0.78,
        gkReaction: 0.52,
        tackleRate: 0.25,
      };
    case 'hard':
      return {
        reactionDelay: 0.1,
        passAccuracy: 0.94,
        shotAccuracy: 0.9,
        aiSpeedScale: 1.04,
        gkReaction: 0.94,
        tackleRate: 0.72,
      };
    case 'medium':
    default:
      return {
        reactionDelay: 0.24,
        passAccuracy: 0.82,
        shotAccuracy: 0.78,
        aiSpeedScale: 0.92,
        gkReaction: 0.76,
        tackleRate: 0.48,
      };
  }
}

function lerpAngle(current: number, target: number, t: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * t;
}

function isTackleFromBehind(
  tacklerX: number,
  tacklerZ: number,
  tacklerDirX: number,
  tacklerDirZ: number,
  victimX: number,
  victimZ: number,
  victimFacing: number,
): boolean {
  const dx = victimX - tacklerX;
  const dz = victimZ - tacklerZ;
  const dist = Math.hypot(dx, dz) || 1;
  const approachDot = (dx / dist) * Math.cos(victimFacing) + (dz / dist) * Math.sin(victimFacing);
  const velDot = tacklerDirX * Math.cos(victimFacing) + tacklerDirZ * Math.sin(victimFacing);
  return approachDot > 0.32 && velDot > 0.2;
}

function choosePassTarget(
  passer: PlayerState,
  teammates: PlayerState[],
  aimX: number,
  aimZ: number,
): PlayerState | null {
  const candidates = teammates.filter((p) => p.id !== passer.id && !p.sentOff);
  if (candidates.length === 0) return null;

  const hasAim = Math.hypot(aimX, aimZ) > 0.2;
  const dirX = hasAim ? aimX / Math.hypot(aimX, aimZ) : Math.cos(passer.facing);
  const dirZ = hasAim ? aimZ / Math.hypot(aimX, aimZ) : Math.sin(passer.facing);

  let best: PlayerState | null = null;
  let bestScore = -Infinity;

  for (const cand of candidates) {
    const dx = cand.x - passer.x;
    const dz = cand.z - passer.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.8) continue;
    const dot = (dx / dist) * dirX + (dz / dist) * dirZ;
    const distPenalty = Math.abs(dist - 14) * 0.018;
    const gkPenalty = cand.role === 'GK' ? 0.35 : 0;
    const score = dot * 2.4 - distPenalty - gkPenalty;
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

function pickNearestOutfieldHome(
  players: PlayerState[],
  team: TeamSide,
  excludeId: string | null,
  ballX: number,
  ballZ: number,
): PlayerState | null {
  const pool = players.filter((p) => p.team === team && !p.sentOff && p.role !== 'GK');
  if (pool.length === 0) return null;
  const sorted = [...pool].sort(
    (a, b) => Math.hypot(a.x - ballX, a.z - ballZ) - Math.hypot(b.x - ballX, b.z - ballZ),
  );
  if (sorted[0].id === excludeId && sorted.length > 1) return sorted[1];
  return sorted[0];
}

function createInitialPenaltyState(inputSource: InputSourceInfo = DEFAULT_KEYBOARD_SOURCE): PenaltyState {
  const prompts = getControlPrompts(inputSource);
  return {
    turn: 'home',
    round: 1,
    homeKicks: [null, null, null, null, null],
    awayKicks: [null, null, null, null, null],
    homeScore: 0,
    awayScore: 0,
    aimX: 0,
    aimY: 0.45,
    power: 0,
    charging: false,
    curveInput: 0,
    keeperDiveDir: 0,
    cpuAimTarget: { x: 0.55, y: 0.45, curve: 0 },
    phaseTimer: 0,
    winner: null,
    bannerText: prompts.penaltyAim,
  };
}

function evaluatePenaltyWinner(
  homeKicks: Array<boolean | null>,
  awayKicks: Array<boolean | null>,
): TeamSide | null {
  const homeTaken = homeKicks.filter((k) => k !== null).length;
  const awayTaken = awayKicks.filter((k) => k !== null).length;
  const homeMade = homeKicks.filter((k) => k === true).length;
  const awayMade = awayKicks.filter((k) => k === true).length;

  if (homeTaken <= 5 && awayTaken <= 5) {
    const homeRemaining = 5 - homeTaken;
    const awayRemaining = 5 - awayTaken;
    if (homeMade > awayMade + awayRemaining) return 'home';
    if (awayMade > homeMade + homeRemaining) return 'away';
    if (homeTaken === 5 && awayTaken === 5) {
      if (homeMade > awayMade) return 'home';
      if (awayMade > homeMade) return 'away';
    }
    return null;
  }
  if (homeTaken === awayTaken && homeTaken > 5) {
    if (homeMade > awayMade) return 'home';
    if (awayMade > homeMade) return 'away';
  }
  return null;
}

export function advancePenaltyKickRecord(
  penalty: PenaltyState,
  scored: boolean,
  inputSource: InputSourceInfo = DEFAULT_KEYBOARD_SOURCE,
): PenaltyState {
  const prompts = getControlPrompts(inputSource);
  const next: PenaltyState = {
    ...penalty,
    homeKicks: [...penalty.homeKicks],
    awayKicks: [...penalty.awayKicks],
  };

  if (next.turn === 'home') {
    const idx = next.homeKicks.findIndex((k) => k === null);
    if (idx !== -1) {
      next.homeKicks[idx] = scored;
    } else {
      next.homeKicks.push(scored);
      next.awayKicks.push(null);
    }
    if (scored) next.homeScore += 1;
  } else {
    const idx = next.awayKicks.findIndex((k) => k === null);
    if (idx !== -1) {
      next.awayKicks[idx] = scored;
    } else {
      next.awayKicks.push(scored);
    }
    if (scored) next.awayScore += 1;
  }

  const winner = evaluatePenaltyWinner(next.homeKicks, next.awayKicks);
  if (winner) {
    next.winner = winner;
    next.bannerText = winner === 'home' ? 'SHOOTOUT VICTORY!' : 'CPU WINS SHOOTOUT';
    return next;
  }

  if (next.turn === 'home') {
    next.turn = 'away';
    next.bannerText = prompts.penaltyDefend;
  } else {
    next.turn = 'home';
    next.round += 1;
    const allRoundSlotsFilled =
      next.homeKicks.every((k) => k !== null) && next.awayKicks.every((k) => k !== null);
    if (allRoundSlotsFilled) {
      next.homeKicks.push(null);
      next.awayKicks.push(null);
    }
    next.bannerText = prompts.penaltyAim;
  }
  next.power = 0;
  next.charging = false;
  next.keeperDiveDir = 0;
  return next;
}

function createPlayers(): PlayerState[] {
  const players: PlayerState[] = [];
  for (const team of ['home', 'away'] as TeamSide[]) {
    FORMATION_7V7.forEach((slot, idx) => {
      const pos = getSlotWorldPos(slot, team);
      players.push({
        id: `${team}-${idx}`,
        team,
        role: slot.role,
        number: slot.number,
        x: pos.x,
        y: 0,
        z: pos.z,
        vx: 0,
        vy: 0,
        vz: 0,
        facing: team === 'home' ? 0 : Math.PI,
        homeX: pos.x,
        homeZ: pos.z,
        stamina: 1,
        leanX: 0,
        leanZ: 0,
        wobbleVX: 0,
        wobbleVZ: 0,
        stridePhase: idx * 0.7,
        slideTimer: 0,
        slideCooldown: 0,
        ragdollTimer: 0,
        tumbleAxisX: 0,
        tumbleAxisZ: 1,
        diveTimer: 0,
        diveDirX: 0,
        diveDirZ: 0,
        kickAnimTimer: 0,
        jumpTimer: 0,
        headerCooldown: 0,
        yellowCards: 0,
        sentOff: false,
        aiDecisionTimer: (idx % 3) * 0.08,
        aiTargetX: pos.x,
        aiTargetZ: pos.z,
      });
    });
  }
  return players;
}

function createInitialBall(): BallState {
  return {
    x: 0,
    y: PITCH.BALL_RADIUS,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    spinX: 0,
    spinY: 0,
    spinZ: 0,
    radius: PITCH.BALL_RADIUS,
    lastTouchTeam: null,
    lastTouchPlayerId: null,
    aftertouchTeam: null,
    aftertouchTimer: 0,
    isPassOrShot: false,
    isCurveShot: false,
    isCornerCross: false,
    curveTimer: 0,
    curveDirection: 1,
    curveTrail: [],
    curveTrailFade: 0,
    lastTrailX: 0,
    lastTrailY: PITCH.BALL_RADIUS,
    lastTrailZ: 0,
  };
}

export function createInitialMatchState(
  mode: MatchMode,
  difficulty: Difficulty,
  initialCorner = false,
  initialThrowIn = false,
): MatchState {
  const players = createPlayers();
  const initialActive = players.find((p) => p.team === 'home' && p.role === 'FWD') ?? players[1];
  const state: MatchState = {
    mode,
    difficulty,
    players,
    ball: createInitialBall(),
    referee: {
      x: 0,
      z: -10,
      vx: 0,
      vz: 0,
      facing: Math.PI / 2,
      state: 'patrol',
      targetPlayerId: null,
      chaseTimer: 0,
      bookingTimer: 0,
      cardToShow: null,
      stridePhase: 0,
      leanX: 0,
      leanZ: 0,
    },
    activePlayerId: initialActive.id,
    homeScore: 0,
    awayScore: 0,
    clockSeconds: 0,
    half: 1,
    phase: mode === 'penalty' ? 'penalty_aim' : 'kickoff',
    phaseTimer: mode === 'penalty' ? 0 : 0.45,
    pendingSetPiece: null,
    shotPower: 0,
    isChargingShot: false,
    banner:
      mode === 'attract' || mode === 'penalty'
        ? null
        : {
            id: 1,
            title: 'KICKOFF',
            subtitle: 'FIRST HALF · 7-A-SIDE',
            tone: 'info',
            timer: 1.2,
          },
    bannerSeq: 1,
    stats: {
      homeShots: 0,
      awayShots: 0,
      homeCurveShots: 0,
      awayCurveShots: 0,
      homeTackles: 0,
      awayTackles: 0,
      homeCards: 0,
      awayCards: 0,
      homePossessionTime: 0,
      awayPossessionTime: 0,
    },
    penalty: mode === 'penalty' ? createInitialPenaltyState(DEFAULT_KEYBOARD_SOURCE) : null,
    corner: null,
    throwIn: null,
    crowdExcitement: 0.25,
    inputSource: { ...DEFAULT_KEYBOARD_SOURCE },
    events: [],
  };

  if (mode === 'penalty') {
    resetForPenaltyKick(state);
  } else if (initialCorner) {
    setupCornerKickSetPiece(state, {
      kind: 'corner',
      team: 'home',
      x: PITCH.HALF_LENGTH - 0.55,
      z: PITCH.HALF_WIDTH - 0.55,
    });
  } else if (initialThrowIn) {
    setupThrowInSetPiece(state, {
      kind: 'throw_in',
      team: 'home',
      x: 6,
      z: PITCH.HALF_WIDTH - 0.5,
    });
  } else {
    resetPositionsForKickoff(state, 'home');
  }
  return state;
}

export function setMatchInputSource(state: MatchState, source: InputSourceInfo): void {
  const unchanged =
    state.inputSource.mode === source.mode &&
    state.inputSource.brand === source.brand &&
    state.inputSource.label === source.label;
  if (unchanged) return;
  state.inputSource = { ...source };
  const prompts = getControlPrompts(source);

  if (state.phase === 'corner_aim' && state.corner?.team === 'home' && state.banner) {
    state.banner.subtitle = prompts.cornerAim;
  } else if (state.phase === 'throw_in_aim' && state.throwIn?.team === 'home' && state.banner) {
    state.banner.subtitle = prompts.throwInAim;
  } else if (state.phase === 'penalty_aim' && state.penalty && !state.penalty.winner) {
    state.penalty.bannerText =
      state.penalty.turn === 'home' ? prompts.penaltyAim : prompts.penaltyDefend;
  }
}

function resetBallMotion(ball: BallState, x: number, y: number, z: number): void {
  ball.x = x;
  ball.y = y;
  ball.z = z;
  ball.vx = 0;
  ball.vy = 0;
  ball.vz = 0;
  ball.spinX = 0;
  ball.spinY = 0;
  ball.spinZ = 0;
  ball.aftertouchTimer = 0;
  ball.isPassOrShot = false;
  ball.isCurveShot = false;
  ball.isCornerCross = false;
  ball.curveTimer = 0;
  ball.curveTrail = [];
  ball.curveTrailFade = 0;
  ball.lastTrailX = x;
  ball.lastTrailY = y;
  ball.lastTrailZ = z;
}

export function resetPositionsForKickoff(state: MatchState, kickoffTeam: TeamSide): void {
  state.players.forEach((p, idx) => {
    const slot = FORMATION_7V7[idx % 7];
    const pos = getSlotWorldPos(slot, p.team);
    p.x = pos.x;
    p.z = pos.z;
    p.y = 0;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.facing = p.team === 'home' ? 0 : Math.PI;
    p.slideTimer = 0;
    p.ragdollTimer = 0;
    p.diveTimer = 0;
    p.jumpTimer = 0;
    p.headerCooldown = 0;
    p.leanX = 0;
    p.leanZ = 0;
    p.wobbleVX = 0;
    p.wobbleVZ = 0;
  });

  const taker = state.players.find((p) => p.team === kickoffTeam && p.role === 'FWD' && !p.sentOff);
  if (taker) {
    taker.x = kickoffTeam === 'home' ? -1.4 : 1.4;
    taker.z = 0;
    if (kickoffTeam === 'home') {
      state.activePlayerId = taker.id;
    }
  }

  resetBallMotion(state.ball, 0, PITCH.BALL_RADIUS, 0);

  state.referee.x = 0;
  state.referee.z = -9;
  state.referee.vx = 0;
  state.referee.vz = 0;
  state.referee.state = 'patrol';
  state.referee.targetPlayerId = null;
  state.referee.cardToShow = null;
}

function resetForPenaltyKick(state: MatchState): void {
  if (!state.penalty) return;
  const spotX = PITCH.HALF_LENGTH - PITCH.PENALTY_SPOT_OFFSET;
  let idx = 0;
  for (const p of state.players) {
    p.vx = 0;
    p.vz = 0;
    p.vy = 0;
    p.y = 0;
    p.ragdollTimer = 0;
    p.slideTimer = 0;
    p.diveTimer = 0;
    p.leanX = 0;
    p.leanZ = 0;
    p.x = -4 - (idx % 4) * 1.4;
    p.z = (idx - 6) * 2.1;
    p.facing = 0;
    idx++;
  }

  const kickerTeam = state.penalty.turn;
  const gkTeam: TeamSide = kickerTeam === 'home' ? 'away' : 'home';
  const kicker = state.players.find((p) => p.team === kickerTeam && p.role === 'FWD') ?? state.players[0];
  const gk = state.players.find((p) => p.team === gkTeam && p.role === 'GK') ?? state.players[7];

  kicker.x = spotX - 2.6;
  kicker.z = 0;
  kicker.facing = 0;

  gk.x = PITCH.HALF_LENGTH - 0.55;
  gk.z = 0;
  gk.facing = Math.PI;

  state.activePlayerId = kickerTeam === 'home' ? kicker.id : gk.id;

  resetBallMotion(state.ball, spotX, PITCH.BALL_RADIUS, 0);

  state.referee.x = spotX - 4.5;
  state.referee.z = -6.5;
  state.referee.facing = Math.PI / 3;
}

function setBanner(
  state: MatchState,
  title: string,
  subtitle: string,
  tone: NonNullable<MatchState['banner']>['tone'],
  timer = 2.0,
): void {
  state.bannerSeq += 1;
  state.banner = { id: state.bannerSeq, title, subtitle, tone, timer };
}

function updatePlayerLiquidLean(player: PlayerState, dt: number, prevVx: number, prevVz: number): void {
  const ax = (player.vx - prevVx) / Math.max(dt, 0.008);
  const az = (player.vz - prevVz) / Math.max(dt, 0.008);
  const stiffness = 62;
  const damping = 7.5;

  const targetLeanX = Math.max(-0.42, Math.min(0.42, player.vx * 0.025 + ax * 0.005));
  const targetLeanZ = Math.max(-0.42, Math.min(0.42, player.vz * 0.025 + az * 0.005));

  const springForceX = (targetLeanX - player.leanX) * stiffness - player.wobbleVX * damping;
  const springForceZ = (targetLeanZ - player.leanZ) * stiffness - player.wobbleVZ * damping;

  player.wobbleVX += springForceX * dt;
  player.wobbleVZ += springForceZ * dt;
  player.leanX += player.wobbleVX * dt;
  player.leanZ += player.wobbleVZ * dt;

  const speed = Math.hypot(player.vx, player.vz);
  player.stridePhase += speed * dt * 1.45;
}

export function stepSimulation(state: MatchState, input: InputState, rawDt: number): void {
  state.events.length = 0;
  const dt = Math.min(rawDt, 0.05);

  if (state.banner) {
    state.banner.timer -= dt;
    if (state.banner.timer <= 0) state.banner.timer = 0;
    if (state.banner.timer <= 0) state.banner = null;
  }

  state.crowdExcitement = Math.max(0.2, state.crowdExcitement - dt * 0.18);

  if (state.ball.curveTrailFade > 0 && !state.ball.isCurveShot) {
    state.ball.curveTrailFade = Math.max(0, state.ball.curveTrailFade - dt * 0.85);
    if (state.ball.curveTrailFade <= 0) {
      state.ball.curveTrail = [];
    }
  }
  for (const pt of state.ball.curveTrail) {
    pt.age += dt;
  }

  if (state.mode === 'penalty') {
    stepPenaltyMode(state, input, dt);
    return;
  }

  if (state.phase === 'kickoff') {
    state.phaseTimer -= dt;
    if (state.phaseTimer <= 0) {
      state.phase = 'live';
      state.events.push({ type: 'whistle', kind: 'kickoff' });
    }
    return;
  }

  if (state.phase === 'goal_celebration') {
    state.phaseTimer -= dt;
    stepBallPhysics(state, input, dt);
    for (const p of state.players) {
      if (p.sentOff) continue;
      const prevVx = p.vx;
      const prevVz = p.vz;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.vx *= Math.exp(-3 * dt);
      p.vz *= Math.exp(-3 * dt);
      updatePlayerLiquidLean(p, dt, prevVx, prevVz);
    }
    if (state.phaseTimer <= 0) {
      const kickoffTeam: TeamSide = state.ball.x > 0 ? 'away' : 'home';
      resetPositionsForKickoff(state, kickoffTeam);
      state.phase = 'kickoff';
      state.phaseTimer = 0.8;
    }
    return;
  }

  if (state.phase === 'set_piece_reset') {
    state.phaseTimer -= dt;
    if (state.phaseTimer <= 0 && state.pendingSetPiece) {
      const sp = state.pendingSetPiece;
      state.pendingSetPiece = null;
      if (sp.kind === 'corner') {
        setupCornerKickSetPiece(state, sp);
        return;
      }
      if (sp.kind === 'throw_in') {
        setupThrowInSetPiece(state, sp);
        return;
      }
      resetBallMotion(state.ball, sp.x, PITCH.BALL_RADIUS, sp.z);
      const teamPlayers = state.players.filter((p) => p.team === sp.team && !p.sentOff && p.role !== 'GK');
      teamPlayers.sort((a, b) => Math.hypot(a.x - sp.x, a.z - sp.z) - Math.hypot(b.x - sp.x, b.z - sp.z));
      const taker = teamPlayers[0];
      if (taker) {
        taker.x = sp.x + (sp.team === 'home' ? -0.9 : 0.9);
        taker.z = Math.max(-PITCH.HALF_WIDTH + 0.5, Math.min(PITCH.HALF_WIDTH - 0.5, sp.z));
        taker.vx = 0;
        taker.vz = 0;
        if (sp.team === 'home' && state.mode !== 'attract') {
          state.activePlayerId = taker.id;
        }
      }
      state.phase = 'live';
    }
    return;
  }

  if (state.phase === 'corner_aim') {
    stepCornerAimMode(state, input, dt);
    return;
  }

  if (state.phase === 'throw_in_aim') {
    stepThrowInAimMode(state, input, dt);
    return;
  }

  if (state.phase === 'halftime') {
    state.phaseTimer -= dt;
    if (state.phaseTimer <= 0) {
      state.half = 2;
      resetPositionsForKickoff(state, 'away');
      state.phase = 'kickoff';
      state.phaseTimer = 0.9;
      setBanner(state, 'SECOND HALF', '45:00 · KEEP PUSHING', 'info', 1.8);
    }
    return;
  }

  if (state.phase === 'fulltime') return;

  if (state.mode !== 'attract') {
    state.clockSeconds += dt;
    if (state.half === 1 && state.clockSeconds >= PITCH.MATCH_DURATION_SECONDS / 2) {
      state.phase = 'halftime';
      state.phaseTimer = 1.6;
      state.events.push({ type: 'whistle', kind: 'fulltime' });
      setBanner(state, 'HALF TIME', `${state.homeScore} - ${state.awayScore}`, 'whistle', 1.6);
      return;
    }
    if (state.half === 2 && state.clockSeconds >= PITCH.MATCH_DURATION_SECONDS) {
      state.clockSeconds = PITCH.MATCH_DURATION_SECONDS;
      state.phase = 'fulltime';
      state.events.push({ type: 'whistle', kind: 'fulltime' });
      setBanner(state, 'FULL TIME', `${state.homeScore} - ${state.awayScore}`, 'whistle', 3.0);
      return;
    }
  }

  if (input.switchJustPressed && state.mode !== 'attract') {
    const next = pickNearestOutfieldHome(state.players, 'home', state.activePlayerId, state.ball.x, state.ball.z);
    if (next) state.activePlayerId = next.id;
  }

  const activePlayer = state.players.find((p) => p.id === state.activePlayerId);
  if (state.mode !== 'attract' && (!activePlayer || activePlayer.sentOff)) {
    const fallback = pickNearestOutfieldHome(state.players, 'home', null, state.ball.x, state.ball.z);
    if (fallback) state.activePlayerId = fallback.id;
  }

  if (state.ball.lastTouchTeam === 'home') {
    state.stats.homePossessionTime += dt;
  } else if (state.ball.lastTouchTeam === 'away') {
    state.stats.awayPossessionTime += dt;
  }

  if (
    Math.abs(state.ball.x) > PITCH.HALF_LENGTH - 11 &&
    Math.abs(state.ball.z) < 10 &&
    Math.hypot(state.ball.vx, state.ball.vz) > 10
  ) {
    state.crowdExcitement = Math.min(1, state.crowdExcitement + dt * 1.4);
  }

  const tuning = getDifficultyTuning(state.difficulty);

  for (const player of state.players) {
    if (player.sentOff) continue;
    if (player.slideCooldown > 0) player.slideCooldown = Math.max(0, player.slideCooldown - dt);
    if (player.kickAnimTimer > 0) player.kickAnimTimer = Math.max(0, player.kickAnimTimer - dt);
    if (player.jumpTimer > 0) player.jumpTimer = Math.max(0, player.jumpTimer - dt);
    if (player.headerCooldown > 0) player.headerCooldown = Math.max(0, player.headerCooldown - dt);

    const prevVx = player.vx;
    const prevVz = player.vz;

    if (player.ragdollTimer > 0) {
      player.ragdollTimer = Math.max(0, player.ragdollTimer - dt);
      player.x += player.vx * dt;
      player.z += player.vz * dt;
      player.vx *= Math.exp(-4.5 * dt);
      player.vz *= Math.exp(-4.5 * dt);
      player.y = Math.max(0, Math.sin((player.ragdollTimer / 0.75) * Math.PI) * 0.45);
      updatePlayerLiquidLean(player, dt, prevVx, prevVz);
      clampPlayerToPitch(player);
      continue;
    }

    player.y = player.jumpTimer > 0 ? Math.sin((player.jumpTimer / 0.42) * Math.PI) * 0.92 : 0;

    if (player.diveTimer > 0) {
      player.diveTimer = Math.max(0, player.diveTimer - dt);
      player.x += player.vx * dt;
      player.z += player.vz * dt;
      player.vx *= Math.exp(-3.2 * dt);
      player.vz *= Math.exp(-3.2 * dt);
      player.y = Math.sin((player.diveTimer / 0.55) * Math.PI) * 0.55;
      updatePlayerLiquidLean(player, dt, prevVx, prevVz);
      clampPlayerToPitch(player);
      continue;
    }

    if (player.slideTimer > 0) {
      player.slideTimer = Math.max(0, player.slideTimer - dt);
      player.x += player.vx * dt;
      player.z += player.vz * dt;
      player.vx *= Math.exp(-2.6 * dt);
      player.vz *= Math.exp(-2.6 * dt);
      updatePlayerLiquidLean(player, dt, prevVx, prevVz);
      clampPlayerToPitch(player);
      continue;
    }

    if (state.mode !== 'attract' && player.id === state.activePlayerId) {
      stepControlledPlayer(state, player, input, dt);
    } else {
      stepAiPlayer(state, player, tuning, dt);
    }

    updatePlayerLiquidLean(player, dt, prevVx, prevVz);
    clampPlayerToPitch(player);
  }

  resolvePlayerCollisionsAndTackles(state);
  stepBallPhysics(state, input, dt);
  stepReferee(state, dt);
}

function clampPlayerToPitch(player: PlayerState): void {
  player.x = Math.max(-PITCH.HALF_LENGTH - 1.8, Math.min(PITCH.HALF_LENGTH + 1.8, player.x));
  player.z = Math.max(-PITCH.HALF_WIDTH - 1.8, Math.min(PITCH.HALF_WIDTH + 1.8, player.z));
}

function stepControlledPlayer(state: MatchState, player: PlayerState, input: InputState, dt: number): void {
  const hasBall = isPlayerNearBall(player, state.ball);
  const moveMag = Math.hypot(input.moveX, input.moveZ);
  const dirX = moveMag > 0.05 ? input.moveX / moveMag : 0;
  const dirZ = moveMag > 0.05 ? input.moveZ / moveMag : 0;

  let speedMult = 1;
  if (input.sprint && player.stamina > 0.05 && moveMag > 0.1) {
    speedMult = 1.38;
    player.stamina = Math.max(0, player.stamina - dt * 0.42);
  } else {
    player.stamina = Math.min(1, player.stamina + dt * 0.25);
  }

  const maxSpeed = (hasBall ? 10.6 : 11.4) * speedMult;
  const accel = 44;
  const desiredVx = dirX * maxSpeed;
  const desiredVz = dirZ * maxSpeed;

  player.vx += (desiredVx - player.vx) * Math.min(1, accel * dt * 0.22);
  player.vz += (desiredVz - player.vz) * Math.min(1, accel * dt * 0.22);
  player.x += player.vx * dt;
  player.z += player.vz * dt;

  if (moveMag > 0.1) {
    const targetFacing = Math.atan2(dirZ, dirX);
    player.facing = lerpAngle(player.facing, targetFacing, 1 - Math.exp(-13 * dt));
  }

  const homeGk = state.players.find((p) => p.team === 'home' && p.role === 'GK');
  const shotThreatHome =
    state.ball.x < -PITCH.HALF_LENGTH + PITCH.BOX_DEPTH && Math.abs(state.ball.z) < PITCH.BOX_HALF_WIDTH;
  if (input.shootJustPressed && !hasBall && homeGk && shotThreatHome && state.ball.vx < -3 && homeGk.diveTimer <= 0) {
    const diveDirZ = Math.abs(dirZ) > 0.1 ? Math.sign(dirZ) : Math.sign(state.ball.z - homeGk.z) || 1;
    homeGk.diveTimer = 0.55;
    homeGk.diveDirX = dirX * 0.3;
    homeGk.diveDirZ = diveDirZ;
    homeGk.vx = dirX * 4;
    homeGk.vz = diveDirZ * 12.5;
    homeGk.facing = Math.atan2(diveDirZ, 0.2);
  }

  const distToBall = Math.hypot(state.ball.x - player.x, state.ball.z - player.z);
  const kickRange = distToBall < 1.85 && state.ball.y < 2.1;
  const isIncomingAerial = (state.ball.isCornerCross || state.ball.y >= 1.1) && distToBall < 6.0;

  if (kickRange && input.shootHeld) {
    state.isChargingShot = true;
    state.shotPower = Math.min(1, state.shotPower + dt * 1.45);
  }

  if (input.shootJustReleased && state.isChargingShot) {
    if (kickRange) {
      shootBall(state, player, Math.max(0.32, state.shotPower), dirX, dirZ);
    }
    state.isChargingShot = false;
    state.shotPower = 0;
  } else if (input.shootJustPressed && isIncomingAerial) {
    state.isChargingShot = false;
    state.shotPower = 0;
    if (player.jumpTimer <= 0 && distToBall < 3.4) {
      player.jumpTimer = 0.34;
    }
  } else if (input.shootJustPressed && !kickRange && player.slideCooldown <= 0) {
    state.isChargingShot = false;
    state.shotPower = 0;
    const tackleDirX = moveMag > 0.1 ? dirX : Math.cos(player.facing);
    const tackleDirZ = moveMag > 0.1 ? dirZ : Math.sin(player.facing);
    player.slideTimer = 0.42;
    player.slideCooldown = 0.85;
    player.vx = tackleDirX * 17.5;
    player.vz = tackleDirZ * 17.5;
    player.facing = Math.atan2(tackleDirZ, tackleDirX);
    state.stats.homeTackles += 1;
    state.events.push({ type: 'tackle', x: player.x, z: player.z });
  }

  if (input.passJustPressed && kickRange) {
    state.isChargingShot = false;
    state.shotPower = 0;
    const teammates = state.players.filter((p) => p.team === 'home');
    const target = choosePassTarget(player, teammates, dirX, dirZ);
    passBall(state, player, target, 'ground', dirX, dirZ);
  }

  if (input.throughJustPressed && kickRange) {
    state.isChargingShot = false;
    state.shotPower = 0;
    const teammates = state.players.filter((p) => p.team === 'home');
    const target = choosePassTarget(player, teammates, dirX, dirZ);
    passBall(state, player, target, 'through', dirX, dirZ);
  }

  if (input.chipJustPressed && kickRange) {
    state.isChargingShot = false;
    state.shotPower = 0;
    const inShootZone = player.x > PITCH.HALF_LENGTH - PITCH.BOX_DEPTH - 3;
    if (state.ball.y > 0.85 && inShootZone) {
      shootBall(state, player, 0.78, 1, dirZ * 0.4);
    } else {
      const teammates = state.players.filter((p) => p.team === 'home');
      const target = choosePassTarget(player, teammates, dirX, dirZ);
      passBall(state, player, target, 'chip', dirX, dirZ);
    }
  }
}

function stepAiPlayer(
  state: MatchState,
  player: PlayerState,
  tuning: DifficultyTuning,
  dt: number,
): void {
  const teamDir = player.team === 'home' ? 1 : -1;
  const teamHasBall = state.ball.lastTouchTeam === player.team;
  const distToBall = Math.hypot(state.ball.x - player.x, state.ball.z - player.z);

  if (player.role === 'GK') {
    const lineX = player.team === 'home' ? -PITCH.HALF_LENGTH + 1.15 : PITCH.HALF_LENGTH - 1.15;
    const incomingShot =
      (player.team === 'home' && state.ball.vx < -9 && state.ball.x < -5) ||
      (player.team === 'away' && state.ball.vx > 9 && state.ball.x > 5);
    const predictedZ = incomingShot ? predictBallGoalLineZ(state.ball, lineX) : state.ball.z * 0.58;
    const rawTargetZ = incomingShot ? predictedZ * 0.88 + state.ball.z * 0.12 : state.ball.z * 0.55;
    const targetZ = Math.max(-PITCH.GOAL_HALF_WIDTH + 0.45, Math.min(PITCH.GOAL_HALF_WIDTH - 0.45, rawTargetZ));
    const dx = lineX - player.x;
    const dz = targetZ - player.z;
    const dist = Math.hypot(dx, dz) || 1;
    const speed = Math.min((incomingShot ? 9.6 : 8.5) * tuning.aiSpeedScale, dist * 6.5);
    player.vx += ((dx / dist) * speed - player.vx) * Math.min(1, 10 * dt);
    player.vz += ((dz / dist) * speed - player.vz) * Math.min(1, 10 * dt);
    player.x += player.vx * dt;
    player.z += player.vz * dt;
    player.facing = player.team === 'home' ? 0 : Math.PI;

    if (
      incomingShot &&
      player.diveTimer <= 0 &&
      Math.abs(predictedZ - player.z) > 0.65 &&
      Math.abs(predictedZ) < PITCH.GOAL_HALF_WIDTH + 1.2 &&
      Math.random() < tuning.gkReaction * dt * 6.8
    ) {
      const diveZ = Math.sign(predictedZ - player.z) || 1;
      player.diveTimer = 0.55;
      player.vx = 0;
      player.vz = diveZ * (9.0 + 3.2 * tuning.gkReaction);
      player.diveDirZ = diveZ;
    }

    if (distToBall < 1.35 && state.ball.y < 1.9 && !incomingShot) {
      const mates = state.players.filter((p) => p.team === player.team && p.id !== player.id && !p.sentOff);
      const target = choosePassTarget(player, mates, teamDir, (Math.random() - 0.5) * 0.8);
      passBall(state, player, target, 'ground', teamDir, 0);
    }
    return;
  }

  player.aiDecisionTimer -= dt;
  const isClosest = isClosestTeammateToBall(state.players, player, state.ball.x, state.ball.z);

  if (player.aiDecisionTimer <= 0) {
    player.aiDecisionTimer = tuning.reactionDelay * (0.8 + Math.random() * 0.4);
    if (state.ball.isCornerCross) {
      const boxGoalSign = state.ball.x >= 0 ? 1 : -1;
      const boxGoalX = boxGoalSign * PITCH.HALF_LENGTH;
      const landX = Math.max(
        -PITCH.HALF_LENGTH + 2,
        Math.min(PITCH.HALF_LENGTH - 2, state.ball.x + state.ball.vx * 0.35),
      );
      const landZ = Math.max(-9, Math.min(9, state.ball.z + state.ball.vz * 0.35));
      if (isClosest || Math.abs(player.x - boxGoalX) < 14) {
        player.aiTargetX = isClosest ? landX : Math.max(-PITCH.HALF_LENGTH + 2, Math.min(PITCH.HALF_LENGTH - 2, landX + (player.homeZ * 0.14)));
        player.aiTargetZ = isClosest ? landZ : Math.max(-7, Math.min(7, landZ + (player.homeZ * 0.18)));
      } else {
        player.aiTargetX = player.x;
        player.aiTargetZ = player.z;
      }
    } else if (isClosest && (!teamHasBall || player.team === 'away' || state.mode === 'attract')) {
      player.aiTargetX = state.ball.x;
      player.aiTargetZ = state.ball.z;
    } else if (teamHasBall) {
      const push = player.role === 'FWD' ? 14 : player.role === 'MID' ? 9 : 4;
      const shiftZ = (state.ball.z - player.homeZ) * 0.28;
      player.aiTargetX = Math.max(
        -PITCH.HALF_LENGTH + 4,
        Math.min(PITCH.HALF_LENGTH - 3, player.homeX + push * teamDir),
      );
      player.aiTargetZ = Math.max(
        -PITCH.HALF_WIDTH + 2.5,
        Math.min(PITCH.HALF_WIDTH - 2.5, player.homeZ + shiftZ),
      );
    } else {
      const retreat = player.role === 'FWD' ? -4 : player.role === 'MID' ? -7 : -8;
      const pullX = (state.ball.x - player.homeX) * 0.25;
      player.aiTargetX = Math.max(
        -PITCH.HALF_LENGTH + 4,
        Math.min(PITCH.HALF_LENGTH - 4, player.homeX + retreat * teamDir + pullX),
      );
      player.aiTargetZ = player.homeZ * 0.8 + state.ball.z * 0.22;
    }
  }

  const dx = player.aiTargetX - player.x;
  const dz = player.aiTargetZ - player.z;
  const dist = Math.hypot(dx, dz);
  const maxSpeed = player.team === 'away' ? 10.6 * tuning.aiSpeedScale : 10.4;
  const moveSpeed = dist > 0.6 ? Math.min(maxSpeed, dist * 4) : 0;
  const desiredVx = dist > 0.05 ? (dx / dist) * moveSpeed : 0;
  const desiredVz = dist > 0.05 ? (dz / dist) * moveSpeed : 0;

  player.vx += (desiredVx - player.vx) * Math.min(1, 9 * dt);
  player.vz += (desiredVz - player.vz) * Math.min(1, 9 * dt);
  player.x += player.vx * dt;
  player.z += player.vz * dt;

  if (Math.hypot(player.vx, player.vz) > 0.4) {
    player.facing = lerpAngle(player.facing, Math.atan2(player.vz, player.vx), 1 - Math.exp(-10 * dt));
  }

  if ((player.team === 'away' || state.mode === 'attract') && distToBall < 1.35 && state.ball.y < 1.6 && player.kickAnimTimer <= 0) {
    const oppGoalX = player.team === 'home' ? PITCH.HALF_LENGTH : -PITCH.HALF_LENGTH;
    const distToGoal = Math.hypot(oppGoalX - player.x, -player.z);
    if (distToGoal < 19) {
      const aimOffsetZ = (Math.random() - 0.5) * (1 - tuning.shotAccuracy * 0.5) * 4.2;
      const sx = oppGoalX - player.x;
      const sz = aimOffsetZ - player.z;
      const sMag = Math.hypot(sx, sz) || 1;
      shootBall(state, player, 0.68 + Math.random() * 0.28, sx / sMag, sz / sMag);
    } else if (Math.random() < 0.06) {
      const mates = state.players.filter((p) => p.team === player.team && p.id !== player.id && !p.sentOff);
      const target = choosePassTarget(player, mates, teamDir, (Math.random() - 0.5) * 0.9);
      passBall(state, player, target, Math.random() < 0.35 ? 'through' : 'ground', teamDir, 0);
    } else {
      const dribbleAngle = Math.atan2(-player.z * 0.3, oppGoalX - player.x);
      state.ball.vx = Math.cos(dribbleAngle) * 11.5;
      state.ball.vz = Math.sin(dribbleAngle) * 11.5;
      state.ball.lastTouchTeam = player.team;
      state.ball.lastTouchPlayerId = player.id;
      player.kickAnimTimer = 0.18;
    }
  }

  if (
    player.team === 'away' &&
    !teamHasBall &&
    distToBall < 2.4 &&
    player.slideCooldown <= 0 &&
    Math.random() < tuning.tackleRate * dt * 1.4
  ) {
    const tx = state.ball.x - player.x;
    const tz = state.ball.z - player.z;
    const mag = Math.hypot(tx, tz) || 1;
    player.slideTimer = 0.4;
    player.slideCooldown = 1.6;
    player.vx = (tx / mag) * 15.8;
    player.vz = (tz / mag) * 15.8;
    player.facing = Math.atan2(player.vz, player.vx);
    state.stats.awayTackles += 1;
    state.events.push({ type: 'tackle', x: player.x, z: player.z });
  }
}

function isClosestTeammateToBall(players: PlayerState[], player: PlayerState, ballX: number, ballZ: number): boolean {
  const myDist = Math.hypot(player.x - ballX, player.z - ballZ);
  for (const other of players) {
    if (other.team !== player.team || other.sentOff || other.role === 'GK' || other.id === player.id) continue;
    if (Math.hypot(other.x - ballX, other.z - ballZ) < myDist - 0.35) return false;
  }
  return true;
}

function isPlayerNearBall(player: PlayerState, ball: BallState): boolean {
  return Math.hypot(ball.x - player.x, ball.z - player.z) < 1.35 && ball.y < 1.2;
}

export function shootBall(
  state: MatchState,
  shooter: PlayerState,
  power: number,
  aimDirX: number,
  aimDirZ: number,
  rng: () => number = Math.random,
): boolean {
  const dirX = Math.hypot(aimDirX, aimDirZ) > 0.15 ? aimDirX : Math.cos(shooter.facing);
  const dirZ = Math.hypot(aimDirX, aimDirZ) > 0.15 ? aimDirZ : Math.sin(shooter.facing);
  const mag = Math.hypot(dirX, dirZ) || 1;

  if (shooter.team === 'home') {
    state.stats.homeShots += 1;
  } else {
    state.stats.awayShots += 1;
  }

  const isCurve = rollRandomCurveShot(rng);

  if (isCurve) {
    const curveParams = computeCurveShotParameters({
      ballX: state.ball.x,
      ballY: state.ball.y,
      ballZ: state.ball.z,
      team: shooter.team,
      power,
      aimDirX: dirX / mag,
      aimDirZ: dirZ / mag,
    });

    state.ball.vx = curveParams.vx;
    state.ball.vy = curveParams.vy;
    state.ball.vz = curveParams.vz;
    state.ball.spinY = curveParams.spinY;
    state.ball.isCurveShot = true;
    state.ball.curveTimer = 1.25;
    state.ball.curveDirection = curveParams.curveDirection;
    state.ball.curveTrail = [
      { x: state.ball.x, y: state.ball.y, z: state.ball.z, age: 0 },
    ];
    state.ball.curveTrailFade = 1.2;
    state.ball.lastTrailX = state.ball.x;
    state.ball.lastTrailY = state.ball.y;
    state.ball.lastTrailZ = state.ball.z;
    state.ball.aftertouchTeam = null;
    state.ball.aftertouchTimer = 0;

    if (shooter.team === 'home') {
      state.stats.homeCurveShots += 1;
    } else {
      state.stats.awayCurveShots += 1;
    }

    if (state.mode !== 'attract') {
      setBanner(
        state,
        'CURVE SHOT!',
        shooter.team === 'home' ? 'LUCKY STRIKE · WHIPPED BANANA CURVE!' : 'CPU WHIPS A CURVE STRIKE!',
        'curve',
        1.55,
      );
    }
  } else {
    const speed = 19 + power * 18;
    const loft = 2.6 + power * 5.2;
    state.ball.vx = (dirX / mag) * speed;
    state.ball.vz = (dirZ / mag) * speed;
    state.ball.vy = loft;
    state.ball.spinY = 0;
    state.ball.isCurveShot = false;
    state.ball.curveTimer = 0;
    state.ball.aftertouchTeam = shooter.team;
    state.ball.aftertouchTimer = 0.85;
  }

  state.ball.isPassOrShot = true;
  state.ball.lastTouchTeam = shooter.team;
  state.ball.lastTouchPlayerId = shooter.id;
  shooter.kickAnimTimer = 0.25;
  state.crowdExcitement = Math.min(1, state.crowdExcitement + (isCurve ? 0.65 : 0.45));
  state.events.push({
    type: 'kick',
    power,
    isPass: false,
    isCurveShot: isCurve,
    x: state.ball.x,
    y: state.ball.y,
    z: state.ball.z,
  });

  return isCurve;
}

function passBall(
  state: MatchState,
  passer: PlayerState,
  target: PlayerState | null,
  kind: 'ground' | 'through' | 'chip',
  aimX: number,
  aimZ: number,
): void {
  let targetX = passer.x + (Math.hypot(aimX, aimZ) > 0.1 ? aimX : Math.cos(passer.facing)) * 12;
  let targetZ = passer.z + (Math.hypot(aimX, aimZ) > 0.1 ? aimZ : Math.sin(passer.facing)) * 12;

  if (target) {
    const lead = kind === 'through' ? 0.65 : 0.22;
    targetX = target.x + target.vx * lead + (kind === 'through' ? (passer.team === 'home' ? 4.2 : -4.2) : 0);
    targetZ = target.z + target.vz * lead;
  }

  const dx = targetX - state.ball.x;
  const dz = targetZ - state.ball.z;
  const dist = Math.hypot(dx, dz) || 1;
  const speed = kind === 'chip' ? Math.min(22, 10 + dist * 0.55) : Math.min(25, 12 + dist * 0.65);

  state.ball.vx = (dx / dist) * speed;
  state.ball.vz = (dz / dist) * speed;
  state.ball.vy = kind === 'chip' ? 8.8 : 1.1;
  state.ball.spinY = 0;
  state.ball.isCurveShot = false;
  state.ball.curveTimer = 0;
  state.ball.aftertouchTeam = passer.team;
  state.ball.aftertouchTimer = 0.55;
  state.ball.isPassOrShot = true;
  state.ball.lastTouchTeam = passer.team;
  state.ball.lastTouchPlayerId = passer.id;
  passer.kickAnimTimer = 0.2;

  if (passer.team === 'home' && target && target.role !== 'GK' && state.mode !== 'attract') {
    state.activePlayerId = target.id;
  }

  state.events.push({
    type: 'kick',
    power: 0.45,
    isPass: true,
    isCurveShot: false,
    x: state.ball.x,
    y: state.ball.y,
    z: state.ball.z,
  });
}

function resolvePlayerCollisionsAndTackles(state: MatchState): void {
  const minDist = PITCH.PLAYER_RADIUS * 2;
  for (let i = 0; i < state.players.length; i++) {
    const a = state.players[i];
    if (a.sentOff) continue;
    for (let j = i + 1; j < state.players.length; j++) {
      const b = state.players[j];
      if (b.sentOff) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= minDist || dist === 0) continue;

      const nx = dx / dist;
      const nz = dz / dist;
      const overlap = minDist - dist;
      a.x -= nx * overlap * 0.5;
      a.z -= nz * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.z += nz * overlap * 0.5;

      if (a.team !== b.team) {
        if (a.slideTimer > 0 && b.ragdollTimer <= 0) {
          applyTackleImpact(state, a, b, nx, nz);
        } else if (b.slideTimer > 0 && a.ragdollTimer <= 0) {
          applyTackleImpact(state, b, a, -nx, -nz);
        } else {
          const rvx = a.vx - b.vx;
          const rvz = a.vz - b.vz;
          const impact = rvx * nx + rvz * nz;
          if (impact > 4.5) {
            a.vx -= nx * impact * 0.45;
            a.vz -= nz * impact * 0.45;
            b.vx += nx * impact * 0.45;
            b.vz += nz * impact * 0.45;
            a.wobbleVX -= nx * 2.4;
            b.wobbleVX += nx * 2.4;
          }
        }
      }
    }
  }
}

function applyTackleImpact(
  state: MatchState,
  tackler: PlayerState,
  victim: PlayerState,
  dirX: number,
  dirZ: number,
): void {
  victim.ragdollTimer = 0.78;
  victim.vx = dirX * 13.5 + tackler.vx * 0.35;
  victim.vz = dirZ * 13.5 + tackler.vz * 0.35;
  victim.tumbleAxisX = -dirZ;
  victim.tumbleAxisZ = dirX;
  victim.wobbleVX += dirX * 7;
  victim.wobbleVZ += dirZ * 7;

  const tSpeed = Math.hypot(tackler.vx, tackler.vz) || 1;
  const fromBehind = isTackleFromBehind(
    tackler.x,
    tackler.z,
    tackler.vx / tSpeed,
    tackler.vz / tSpeed,
    victim.x,
    victim.z,
    victim.facing,
  );

  if (fromBehind && state.referee.state === 'patrol' && state.mode !== 'attract') {
    state.referee.state = 'chasing';
    state.referee.targetPlayerId = tackler.id;
    state.referee.chaseTimer = 6.5;
    state.events.push({ type: 'whistle', kind: 'foul' });
    setBanner(
      state,
      'FOUL! REF IN PURSUIT!',
      `OUTRUN THE REFEREE TO DELAY THE BOOKING (#${tackler.number})`,
      'whistle',
      2.8,
    );
  }
}

function stepReferee(state: MatchState, dt: number): void {
  const ref = state.referee;
  const prevVx = ref.vx;
  const prevVz = ref.vz;

  if (ref.state === 'chasing') {
    ref.chaseTimer -= dt;
    const culprit = state.players.find((p) => p.id === ref.targetPlayerId);
    if (!culprit || culprit.sentOff || ref.chaseTimer <= 0) {
      if (culprit && !culprit.sentOff) {
        issueBooking(state, culprit);
      } else {
        ref.state = 'patrol';
        ref.targetPlayerId = null;
      }
      return;
    }

    const dx = culprit.x - ref.x;
    const dz = culprit.z - ref.z;
    const dist = Math.hypot(dx, dz) || 1;
    if (dist < 1.35) {
      issueBooking(state, culprit);
      return;
    }

    const chaseSpeed = 11.1;
    ref.vx += ((dx / dist) * chaseSpeed - ref.vx) * Math.min(1, 8 * dt);
    ref.vz += ((dz / dist) * chaseSpeed - ref.vz) * Math.min(1, 8 * dt);
    ref.x += ref.vx * dt;
    ref.z += ref.vz * dt;
    ref.facing = lerpAngle(ref.facing, Math.atan2(ref.vz, ref.vx), 1 - Math.exp(-12 * dt));
  } else if (ref.state === 'booking') {
    ref.bookingTimer -= dt;
    ref.vx *= Math.exp(-8 * dt);
    ref.vz *= Math.exp(-8 * dt);
    if (ref.bookingTimer <= 0) {
      ref.state = 'cooldown';
      ref.bookingTimer = 1.5;
      ref.cardToShow = null;
      ref.targetPlayerId = null;
    }
  } else {
    if (ref.state === 'cooldown') {
      ref.bookingTimer -= dt;
      if (ref.bookingTimer <= 0) ref.state = 'patrol';
    }
    const targetX = Math.max(-20, Math.min(20, state.ball.x * 0.55));
    const targetZ = state.ball.z > 0 ? state.ball.z - 8 : state.ball.z + 8;
    const dx = targetX - ref.x;
    const dz = targetZ - ref.z;
    const dist = Math.hypot(dx, dz) || 1;
    const speed = dist > 1.5 ? Math.min(7.5, dist * 2.2) : 0;
    ref.vx += ((dx / dist) * speed - ref.vx) * Math.min(1, 6 * dt);
    ref.vz += ((dz / dist) * speed - ref.vz) * Math.min(1, 6 * dt);
    ref.x += ref.vx * dt;
    ref.z += ref.vz * dt;
    ref.facing = lerpAngle(ref.facing, Math.atan2(state.ball.z - ref.z, state.ball.x - ref.x), 1 - Math.exp(-8 * dt));
  }

  ref.stridePhase += Math.hypot(ref.vx, ref.vz) * dt * 1.4;
  ref.leanX += (Math.max(-0.3, Math.min(0.3, (ref.vx - prevVx) * 0.05)) - ref.leanX) * Math.min(1, 10 * dt);
  ref.leanZ += (Math.max(-0.3, Math.min(0.3, (ref.vz - prevVz) * 0.05)) - ref.leanZ) * Math.min(1, 10 * dt);
}

function issueBooking(state: MatchState, culprit: PlayerState): void {
  culprit.yellowCards += 1;
  const isRed = culprit.yellowCards >= 2;
  if (isRed) culprit.sentOff = true;
  if (culprit.team === 'home') state.stats.homeCards += 1;
  else state.stats.awayCards += 1;

  state.referee.state = 'booking';
  state.referee.bookingTimer = 1.6;
  state.referee.cardToShow = isRed ? 'red' : 'yellow';
  state.events.push({ type: 'card', card: isRed ? 'red' : 'yellow' });
  setBanner(
    state,
    isRed ? 'RED CARD! SENT OFF!' : 'YELLOW CARD!',
    `#${culprit.number} (${culprit.team.toUpperCase()}) BOOKED FOR RECKLESS TACKLE`,
    isRed ? 'red' : 'yellow',
    2.4,
  );
}

export function stepBallPhysics(
  state: MatchState,
  input: InputState,
  dt: number,
  rng: () => number = Math.random,
): void {
  const ball = state.ball;

  if (ball.isCurveShot && ball.curveTimer > 0) {
    ball.curveTimer = Math.max(0, ball.curveTimer - dt);
    // Gentle decay so the whip sustains through the full arc
    ball.spinY *= Math.exp(-0.22 * dt);
  } else if (ball.aftertouchTimer > 0) {
    ball.aftertouchTimer = Math.max(0, ball.aftertouchTimer - dt);
    if (ball.aftertouchTeam === 'home' && state.mode !== 'attract' && Math.hypot(ball.vx, ball.vz) > 4) {
      const steer = Math.abs(input.moveZ) > 0.15 ? input.moveZ : input.moveX * 0.35;
      ball.spinY = Math.max(-12, Math.min(12, ball.spinY + steer * 26 * dt));
    }
  } else {
    ball.spinY *= Math.exp(-2.2 * dt);
    if (ball.isCurveShot && Math.abs(ball.spinY) < 1.5) {
      ball.isCurveShot = false;
    }
  }

  const speed = Math.hypot(ball.vx, ball.vz);
  if (speed > 1.5 && Math.abs(ball.spinY) > 0.1) {
    const perpX = -ball.vz / speed;
    const perpZ = ball.vx / speed;
    const magnusFactor = ball.isCurveShot ? 1.45 : 1.15;
    const magnusAccel = ball.spinY * magnusFactor;
    ball.vx += perpX * magnusAccel * dt;
    ball.vz += perpZ * magnusAccel * dt;
  }

  ball.vy -= GRAVITY * dt;
  const airDrag = Math.exp(-0.32 * dt);
  ball.vx *= airDrag;
  ball.vz *= airDrag;

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;

  ball.spinX = ball.vz / ball.radius;
  ball.spinZ = -ball.vx / ball.radius;

  if (ball.isCurveShot) {
    const distFromLast = Math.hypot(
      ball.x - ball.lastTrailX,
      ball.y - ball.lastTrailY,
      ball.z - ball.lastTrailZ,
    );
    if (distFromLast >= TRAIL_SAMPLE_DISTANCE) {
      ball.curveTrail.push({ x: ball.x, y: ball.y, z: ball.z, age: 0 });
      if (ball.curveTrail.length > MAX_TRAIL_POINTS) {
        ball.curveTrail.shift();
      }
      ball.lastTrailX = ball.x;
      ball.lastTrailY = ball.y;
      ball.lastTrailZ = ball.z;
    }
  }

  if (ball.y <= ball.radius) {
    ball.y = ball.radius;
    if (ball.vy < -2.2) {
      ball.vy = -ball.vy * 0.64;
      ball.isCornerCross = false;
    } else {
      ball.vy = 0;
      if (Math.hypot(ball.vx, ball.vz) < 8) {
        ball.isCornerCross = false;
      }
    }
    const groundDrag = Math.exp(-2.15 * dt);
    ball.vx *= groundDrag;
    ball.vz *= groundDrag;
    if (ball.isCurveShot && ball.curveTimer < 0.75) {
      ball.isCurveShot = false;
    }
  }

  // Player ball touches (dribble / GK save / slide intercept / aerial header)
  for (const player of state.players) {
    if (player.sentOff || player.ragdollTimer > 0) continue;
    const isGk = player.role === 'GK';
    const isAerial = ball.y >= 0.92 && ball.y <= 2.65;
    const dx = ball.x - player.x;
    const dz = ball.z - player.z;
    const dist = Math.hypot(dx, dz);

    // Outfield aerial header contest (controlled player has a real chance, not guaranteed every time)
    if (!isGk && isAerial && dist < 1.44 && player.slideTimer <= 0 && player.kickAnimTimer <= 0 && player.headerCooldown <= 0) {
      player.headerCooldown = 0.48;
      const isControlled = state.mode !== 'attract' && player.id === state.activePlayerId;
      const isPressingAction =
        isControlled &&
        (input.shootHeld ||
          input.shootJustPressed ||
          input.shootJustReleased ||
          input.chipJustPressed ||
          input.passJustPressed);

      if (rollHeaderSuccess({ isControlled, isPressingAction, isCornerCross: ball.isCornerCross })) {
        player.jumpTimer = 0.42;
        player.kickAnimTimer = 0.28;
        const attackingGoalX = player.team === 'home' ? PITCH.HALF_LENGTH : -PITCH.HALF_LENGTH;
        const distToGoal = Math.hypot(attackingGoalX - player.x, player.z);
        const isAttackingHeader =
          (ball.isCornerCross && player.team === ball.lastTouchTeam) || distToGoal < 21;

        if (isAttackingHeader) {
          const aimZ = isControlled
            ? Math.max(-PITCH.GOAL_HALF_WIDTH * 0.85, Math.min(PITCH.GOAL_HALF_WIDTH * 0.85, input.moveZ * 3.1))
            : (Math.random() - 0.5) * 4.4;
          const hx = attackingGoalX - player.x;
          const hz = aimZ - player.z;
          const hMag = Math.hypot(hx, hz) || 1;
          const speed = isControlled ? 22.5 : 19.5;
          ball.vx = (hx / hMag) * speed;
          ball.vz = (hz / hMag) * speed;
          ball.vy = 1.6 + Math.random() * 1.9;
          ball.spinY = 0;
          ball.isPassOrShot = true;
          ball.isCurveShot = false;
          ball.isCornerCross = false;
          ball.lastTouchTeam = player.team;
          ball.lastTouchPlayerId = player.id;
          if (player.team === 'home') state.stats.homeShots += 1;
          else state.stats.awayShots += 1;
          state.events.push({
            type: 'kick',
            power: 0.85,
            isPass: false,
            isCurveShot: false,
            x: ball.x,
            y: ball.y,
            z: ball.z,
          });
          if (state.mode !== 'attract') {
            setBanner(
              state,
              'HEADER!',
              isControlled ? 'POWERFUL AERIAL HEADER ON GOAL!' : 'CONTESTED BOX HEADER!',
              'info',
              1.1,
            );
          }
          continue;
        } else {
          const clearDirX = player.team === 'home' ? 1 : -1;
          ball.vx = clearDirX * 15.5;
          ball.vz = (Math.random() - 0.5) * 11;
          ball.vy = 5.4;
          ball.spinY = 0;
          ball.isPassOrShot = true;
          ball.isCurveShot = false;
          ball.isCornerCross = false;
          ball.lastTouchTeam = player.team;
          ball.lastTouchPlayerId = player.id;
          state.events.push({
            type: 'kick',
            power: 0.7,
            isPass: true,
            isCurveShot: false,
            x: ball.x,
            y: ball.y,
            z: ball.z,
          });
          continue;
        }
      } else {
        player.jumpTimer = 0.26;
        continue;
      }
    }

    const touchRadius = player.diveTimer > 0 ? 1.65 : isGk ? 1.24 : player.slideTimer > 0 ? 1.25 : 0.96;
    const maxTouchY = player.diveTimer > 0 ? 2.58 : isGk ? 2.28 : 1.7;
    if (dist < touchRadius && ball.y < maxTouchY) {
      if (isGk && player.kickAnimTimer > 0) continue;
      const incomingShotForGk =
        isGk &&
        ball.isPassOrShot &&
        ball.lastTouchTeam !== player.team &&
        (state.mode === 'penalty'
          ? ball.vx > 4
          : (player.team === 'home' && ball.vx < -5) || (player.team === 'away' && ball.vx > 5));
      if (player.diveTimer > 0 || incomingShotForGk) {
        const wasCurve = ball.isCurveShot;
        const tipOverBar = state.mode !== 'penalty' && incomingShotForGk && rollGkTipOverCorner(rng);
        player.kickAnimTimer = 0.35;

        if (tipOverBar) {
          const endDir = player.team === 'away' ? 1 : -1;
          const goalLineX = endDir * PITCH.HALF_LENGTH;
          const dxToEnd = Math.max(0.65, Math.abs(goalLineX - ball.x));
          const vxMag = Math.max(4.6, Math.min(10.5, dxToEnd / 0.22));
          const tCross = dxToEnd / vxMag;
          const targetCrossY = PITCH.GOAL_HEIGHT + 0.95;

          ball.vx = endDir * vxMag;
          ball.vy = Math.max(9.0, (targetCrossY - ball.y + 0.5 * GRAVITY * tCross * tCross) / tCross);
          ball.vz = Math.max(-3.0, Math.min(3.0, ball.vz * 0.25 + (dz / (dist || 1)) * 2.0));
        } else {
          const deflectX = state.mode === 'penalty' ? -1 : player.team === 'home' ? 1 : -1;
          ball.vx = deflectX * (9.5 + rng() * 4.5);
          ball.vz = (dz / (dist || 1)) * 9.5 + (rng() - 0.5) * 2.5;
          ball.vy = 4.2 + rng() * 1.4;
        }

        ball.spinY = 0;
        ball.isPassOrShot = false;
        ball.isCornerCross = false;
        ball.lastTouchTeam = player.team;
        ball.lastTouchPlayerId = player.id;
        ball.isCurveShot = false;
        state.events.push({ type: 'save', x: ball.x, z: ball.z });
        if (state.mode !== 'attract' && state.mode !== 'penalty' && incomingShotForGk) {
          setBanner(
            state,
            tipOverBar ? 'TIPPED OVER!' : wasCurve ? 'CURVE BLOCKED!' : 'GREAT SAVE!',
            tipOverBar ? 'OVER THE KEEPER — CORNER KICK!' : 'GOALKEEPER DENIES THE STRIKE!',
            'whistle',
            1.2,
          );
        }
        continue;
      }
      if (player.kickAnimTimer > 0) continue;
      if (player.slideTimer > 0) {
        ball.vx = player.vx * 1.25;
        ball.vz = player.vz * 1.25;
        ball.vy = 1.6;
        ball.lastTouchTeam = player.team;
        ball.lastTouchPlayerId = player.id;
        ball.isCurveShot = false;
        ball.isCornerCross = false;
        continue;
      }
      const pSpeed = Math.hypot(player.vx, player.vz);
      const dirX = pSpeed > 0.8 ? player.vx / pSpeed : Math.cos(player.facing);
      const dirZ = pSpeed > 0.8 ? player.vz / pSpeed : Math.sin(player.facing);
      const dribbleSpeed = Math.max(pSpeed * 1.18, 4.2);
      ball.vx = dirX * dribbleSpeed;
      ball.vz = dirZ * dribbleSpeed;
      ball.x = player.x + dirX * 0.82;
      ball.z = player.z + dirZ * 0.82;
      ball.lastTouchTeam = player.team;
      ball.lastTouchPlayerId = player.id;
      ball.isPassOrShot = false;
      ball.isCurveShot = false;
      ball.isCornerCross = false;
    }
  }

  // Goalpost & crossbar collisions
  for (const side of [-1, 1]) {
    const goalX = side * PITCH.HALF_LENGTH;
    for (const postZ of [-PITCH.GOAL_HALF_WIDTH, PITCH.GOAL_HALF_WIDTH]) {
      const dx = ball.x - goalX;
      const dz = ball.z - postZ;
      const dist = Math.hypot(dx, dz);
      if (dist < ball.radius + 0.14 && ball.y < PITCH.GOAL_HEIGHT + 0.1) {
        const nx = dx / (dist || 1);
        const nz = dz / (dist || 1);
        ball.x = goalX + nx * (ball.radius + 0.15);
        ball.z = postZ + nz * (ball.radius + 0.15);
        const vn = ball.vx * nx + ball.vz * nz;
        if (vn < 0) {
          ball.vx -= 1.85 * vn * nx;
          ball.vz -= 1.85 * vn * nz;
          ball.isCurveShot = false;
          state.events.push({ type: 'postHit', x: goalX, z: postZ });
        }
      }
    }
    if (
      Math.abs(ball.x - goalX) < ball.radius + 0.14 &&
      Math.abs(ball.y - PITCH.GOAL_HEIGHT) < ball.radius + 0.14 &&
      Math.abs(ball.z) <= PITCH.GOAL_HALF_WIDTH + 0.15
    ) {
      ball.vx = -ball.vx * 0.85;
      ball.vy = Math.abs(ball.vy) * 0.7;
      ball.x = goalX - side * (ball.radius + 0.16);
      ball.isCurveShot = false;
      state.events.push({ type: 'postHit', x: goalX, z: ball.z });
    }
  }

  if (state.phase !== 'live') {
    if (Math.abs(ball.x) > PITCH.HALF_LENGTH + PITCH.GOAL_DEPTH - ball.radius) {
      ball.x = Math.sign(ball.x) * (PITCH.HALF_LENGTH + PITCH.GOAL_DEPTH - ball.radius);
      ball.vx = -ball.vx * 0.25;
      state.events.push({
        type: 'netHit',
        side: ball.x > 0 ? 'right' : 'left',
        x: ball.x,
        y: ball.y,
        z: ball.z,
        vx: ball.vx,
      });
    }
    return;
  }

  const inGoalMouthZ = Math.abs(ball.z) < PITCH.GOAL_HALF_WIDTH - ball.radius * 0.3;
  const underCrossbar = ball.y < PITCH.GOAL_HEIGHT;

  if (ball.x > PITCH.HALF_LENGTH + ball.radius * 0.4 && inGoalMouthZ && underCrossbar) {
    const wasCurve = ball.isCurveShot;
    const wasHeader = state.banner?.title === 'HEADER!';
    ball.isCurveShot = false;
    ball.isCornerCross = false;
    state.homeScore += 1;
    state.phase = 'goal_celebration';
    state.phaseTimer = 2.1;
    state.crowdExcitement = 1;
    state.events.push({
      type: 'netHit',
      side: 'right',
      x: ball.x,
      y: ball.y,
      z: ball.z,
      vx: ball.vx,
    });
    state.events.push({ type: 'goal', scoringTeam: 'home' });
    setBanner(
      state,
      wasCurve ? 'BEND IT GOAL!' : wasHeader ? 'HEADER GOAL!' : 'GOAL!',
      wasCurve
        ? 'UNSTOPPABLE CURVE STRIKE!'
        : wasHeader
          ? 'TOWERING CORNER HEADER FINISH!'
          : 'WHAT A STRIKE!',
      'goal',
      2.1,
    );
    return;
  }

  if (ball.x < -PITCH.HALF_LENGTH - ball.radius * 0.4 && inGoalMouthZ && underCrossbar) {
    const wasHeader = state.banner?.title === 'HEADER!';
    ball.isCurveShot = false;
    ball.isCornerCross = false;
    state.awayScore += 1;
    state.phase = 'goal_celebration';
    state.phaseTimer = 2.1;
    state.crowdExcitement = 1;
    state.events.push({
      type: 'netHit',
      side: 'left',
      x: ball.x,
      y: ball.y,
      z: ball.z,
      vx: ball.vx,
    });
    state.events.push({ type: 'goal', scoringTeam: 'away' });
    setBanner(
      state,
      wasHeader ? 'HEADER GOAL!' : 'GOAL!',
      wasHeader ? 'POWERFUL AERIAL HEADER!' : 'OPPONENT SCORES!',
      'goal',
      2.1,
    );
    return;
  }

  if (Math.abs(ball.z) > PITCH.HALF_WIDTH + ball.radius) {
    const takerTeam: TeamSide = ball.lastTouchTeam === 'home' ? 'away' : 'home';
    ball.isCurveShot = false;
    state.phase = 'set_piece_reset';
    state.phaseTimer = 0.55;
    state.pendingSetPiece = {
      kind: 'throw_in',
      team: takerTeam,
      x: Math.max(-PITCH.HALF_LENGTH + 2, Math.min(PITCH.HALF_LENGTH - 2, ball.x)),
      z: Math.sign(ball.z) * (PITCH.HALF_WIDTH - 0.5),
    };
    setBanner(state, 'THROW-IN', `${takerTeam.toUpperCase()} BALL`, 'setpiece', 1.1);
    return;
  }

  if (Math.abs(ball.x) > PITCH.HALF_LENGTH + ball.radius) {
    const rightEnd = ball.x > 0;
    const defendingTeam: TeamSide = rightEnd ? 'away' : 'home';
    const attackingTeam: TeamSide = rightEnd ? 'home' : 'away';
    ball.isCurveShot = false;
    if (ball.lastTouchTeam === defendingTeam) {
      state.phase = 'set_piece_reset';
      state.phaseTimer = 0.55;
      state.pendingSetPiece = {
        kind: 'corner',
        team: attackingTeam,
        x: (rightEnd ? 1 : -1) * (PITCH.HALF_LENGTH - 0.55),
        z: (ball.z >= 0 ? 1 : -1) * (PITCH.HALF_WIDTH - 0.55),
      };
      setBanner(state, 'CORNER KICK', `${attackingTeam.toUpperCase()} CORNER · PACK THE BOX!`, 'setpiece', 1.2);
    } else {
      state.phase = 'set_piece_reset';
      state.phaseTimer = 0.6;
      state.pendingSetPiece = {
        kind: 'goal_kick',
        team: defendingTeam,
        x: (rightEnd ? 1 : -1) * (PITCH.HALF_LENGTH - 4.5),
        z: 0,
      };
      setBanner(state, 'GOAL KICK', `${defendingTeam.toUpperCase()} RESTART`, 'setpiece', 1.1);
    }
  }
}

function stepPenaltyMode(state: MatchState, input: InputState, dt: number): void {
  const pen = state.penalty;
  if (!pen) return;

  const teamTurn = pen.turn;
  const gkTeam: TeamSide = teamTurn === 'home' ? 'away' : 'home';
  const kicker = state.players.find((p) => p.team === teamTurn && p.role === 'FWD') ?? state.players[0];
  const gk = state.players.find((p) => p.team === gkTeam && p.role === 'GK') ?? state.players[7];

  if (state.phase === 'penalty_aim') {
    if (pen.turn === 'home') {
      pen.aimX = Math.max(-1.05, Math.min(1.05, pen.aimX + input.moveZ * dt * 1.45));
      pen.aimY = Math.max(0.15, Math.min(1.0, pen.aimY - input.moveX * dt * 0.9));

      if (input.shootHeld) {
        pen.charging = true;
        pen.power = Math.min(1, pen.power + dt * 1.35);
      }

      if (input.shootJustReleased && pen.charging) {
        pen.charging = false;
        const pwr = Math.max(0.35, pen.power);
        state.phase = 'penalty_flight';
        pen.phaseTimer = 2.0;

        state.stats.homeShots += 1;
        const isCurve = rollRandomCurveShot();

        const targetZ = pen.aimX * (PITCH.GOAL_HALF_WIDTH - 0.2);
        const targetY = 0.35 + pen.aimY * (PITCH.GOAL_HEIGHT - 0.3);
        const speed = 22 + pwr * 14;
        const dx = PITCH.HALF_LENGTH - state.ball.x;
        const dz = targetZ - state.ball.z;
        const dist = Math.hypot(dx, dz) || 1;
        const flightTime = dist / speed;

        if (isCurve) {
          state.stats.homeCurveShots += 1;
          const curveDir = targetZ >= 0 ? 1 : -1;
          const outwardAngle = 0.48;
          const cosA = Math.cos(outwardAngle);
          const sinA = Math.sin(outwardAngle);
          const fx = dx / dist;
          const fz = dz / dist;
          const px = -fz;
          const pz = fx;
          const launchSpeed = (19 + pwr * 9.5) * 1.1;
          const curveFlightTime = dist / (19 + pwr * 9.5);

          state.ball.vx = (fx * cosA + curveDir * px * sinA) * launchSpeed;
          state.ball.vz = (fz * cosA + curveDir * pz * sinA) * launchSpeed;
          const vPerp0 = curveDir * launchSpeed * sinA;
          state.ball.spinY = Math.max(-52, Math.min(52, (-2.18 * vPerp0) / Math.max(0.32, curveFlightTime) / 1.45));
          state.ball.vy =
            (targetY - state.ball.y + 0.5 * GRAVITY * curveFlightTime * curveFlightTime) / curveFlightTime;
          state.ball.isCurveShot = true;
          state.ball.curveTimer = 1.25;
          state.ball.curveDirection = curveDir;
          state.ball.curveTrail = [{ x: state.ball.x, y: state.ball.y, z: state.ball.z, age: 0 }];
          state.ball.curveTrailFade = 1.35;
          state.ball.lastTrailX = state.ball.x;
          state.ball.lastTrailY = state.ball.y;
          state.ball.lastTrailZ = state.ball.z;
          setBanner(state, 'CURVE PENALTY!', 'LUCKY STRIKE · WHIPPED PENALTY!', 'curve', 1.4);
        } else {
          state.ball.vx = (dx / dist) * speed;
          state.ball.vz = (dz / dist) * speed;
          state.ball.vy = (targetY - state.ball.y + 0.5 * GRAVITY * flightTime * flightTime) / flightTime;
          state.ball.aftertouchTeam = 'home';
          state.ball.aftertouchTimer = 0.85;
          state.ball.isCurveShot = false;
        }

        kicker.kickAnimTimer = 0.3;
        state.events.push({
          type: 'kick',
          power: pwr,
          isPass: false,
          isCurveShot: isCurve,
          x: state.ball.x,
          y: state.ball.y,
          z: state.ball.z,
        });

        const tuning = getDifficultyTuning(state.difficulty);
        const guessRightSide = Math.random() < tuning.gkReaction * (isCurve ? 0.5 : 0.64);
        const stayCenter = Math.abs(targetZ) < 0.7 && Math.random() < 0.35;
        if (!stayCenter) {
          const targetSign = Math.sign(targetZ) || (Math.random() < 0.5 ? -1 : 1);
          const cpuGuessDir = guessRightSide ? targetSign : -targetSign;
          const activeFlightTime = isCurve ? dist / (19 + pwr * 9.5) : flightTime;
          const reachDist = Math.min(PITCH.GOAL_HALF_WIDTH - 0.35, Math.max(1.15, Math.abs(targetZ) * 0.94));
          const diveSpeed = Math.max(6.2, Math.min(11.6, reachDist / Math.max(0.28, activeFlightTime)));
          gk.diveTimer = 0.65;
          gk.vz = cpuGuessDir * diveSpeed;
          gk.diveDirZ = cpuGuessDir;
        }
      }
    } else {
      pen.phaseTimer += dt;
      if ((input.shootJustPressed || Math.abs(input.moveZ) > 0.25) && Math.abs(input.moveZ) > 0.2) {
        pen.keeperDiveDir = input.moveZ > 0 ? 1 : -1;
      }
      if (pen.phaseTimer >= 1.3) {
        state.phase = 'penalty_flight';
        pen.phaseTimer = 2.0;

        const aimZ = (Math.random() * 2 - 1) * (PITCH.GOAL_HALF_WIDTH - 0.35);
        const aimY = 0.4 + Math.random() * 1.5;
        const speed = 25 + Math.random() * 7;
        const dx = PITCH.HALF_LENGTH - state.ball.x;
        const dz = aimZ - state.ball.z;
        const dist = Math.hypot(dx, dz) || 1;
        const flightTime = dist / speed;

        state.ball.vx = (dx / dist) * speed;
        state.ball.vz = (dz / dist) * speed;
        state.ball.vy = (aimY - state.ball.y + 0.5 * GRAVITY * flightTime * flightTime) / flightTime;
        state.ball.spinY = (Math.random() - 0.5) * 6;
        kicker.kickAnimTimer = 0.3;
        state.events.push({
          type: 'kick',
          power: 0.85,
          isPass: false,
          isCurveShot: false,
          x: state.ball.x,
          y: state.ball.y,
          z: state.ball.z,
        });

        const dive = Math.abs(input.moveZ) > 0.15 ? Math.sign(input.moveZ) : pen.keeperDiveDir;
        if (dive !== 0) {
          gk.diveTimer = 0.65;
          gk.vz = dive * 12.2;
          gk.diveDirZ = dive;
        }
      }
    }
    return;
  }

  if (state.phase === 'penalty_flight') {
    pen.phaseTimer -= dt;
    if (pen.turn === 'away' && gk.diveTimer <= 0 && (input.shootJustPressed || Math.abs(input.moveZ) > 0.2)) {
      const dive = Math.sign(input.moveZ) || pen.keeperDiveDir || 1;
      gk.diveTimer = 0.65;
      gk.vz = dive * 12.5;
      gk.diveDirZ = dive;
    }

    if (gk.diveTimer > 0) {
      gk.diveTimer = Math.max(0, gk.diveTimer - dt);
      gk.z = Math.max(
        -PITCH.GOAL_HALF_WIDTH - 0.15,
        Math.min(PITCH.GOAL_HALF_WIDTH + 0.15, gk.z + gk.vz * dt),
      );
      gk.vz *= Math.exp(-2.6 * dt);
      gk.y = Math.sin((gk.diveTimer / 0.65) * Math.PI) * 0.55;
    }

    stepBallPhysics(state, input, dt);

    if (Math.hypot(state.ball.x - gk.x, state.ball.z - gk.z) < 1.55 && state.ball.y < 2.55 && state.ball.vx > 0) {
      state.ball.vx = -8.5;
      state.ball.vz = (Math.random() - 0.5) * 6;
      state.ball.vy = 3.6;
      state.ball.spinY = 0;
      state.ball.isCurveShot = false;
      state.events.push({ type: 'save', x: state.ball.x, z: state.ball.z });
    }

    if (
      state.ball.x > PITCH.HALF_LENGTH + 0.3 &&
      Math.abs(state.ball.z) < PITCH.GOAL_HALF_WIDTH &&
      state.ball.y < PITCH.GOAL_HEIGHT
    ) {
      const wasCurve = state.ball.isCurveShot;
      state.ball.isCurveShot = false;
      state.events.push({
        type: 'netHit',
        side: 'right',
        x: state.ball.x,
        y: state.ball.y,
        z: state.ball.z,
        vx: state.ball.vx,
      });
      state.events.push({ type: 'goal', scoringTeam: pen.turn });
      state.penalty = advancePenaltyKickRecord(pen, true, state.inputSource);
      state.homeScore = state.penalty.homeScore;
      state.awayScore = state.penalty.awayScore;
      state.phase = 'penalty_result';
      state.penalty.phaseTimer = 1.65;
      setBanner(
        state,
        wasCurve ? 'CURVE GOAL!' : 'SCORED!',
        wasCurve
          ? `LUCKY CURVE · ${state.penalty.homeScore} - ${state.penalty.awayScore}`
          : `${state.penalty.homeScore} - ${state.penalty.awayScore} · CLINICAL FINISH`,
        'goal',
        1.6,
      );
      return;
    }

    if (pen.phaseTimer <= 0 || state.ball.vx < -1 || Math.abs(state.ball.x) > PITCH.HALF_LENGTH + 3) {
      state.ball.isCurveShot = false;
      state.penalty = advancePenaltyKickRecord(pen, false, state.inputSource);
      state.homeScore = state.penalty.homeScore;
      state.awayScore = state.penalty.awayScore;
      state.phase = 'penalty_result';
      state.penalty.phaseTimer = 1.65;
      setBanner(
        state,
        'SAVED / MISSED!',
        `${state.penalty.homeScore} - ${state.penalty.awayScore} · KEEPER WINS THE DUEL`,
        'whistle',
        1.6,
      );
    }
    return;
  }

  if (state.phase === 'penalty_result') {
    pen.phaseTimer -= dt;
    stepBallPhysics(state, input, dt);
    if (pen.phaseTimer <= 0) {
      if (pen.winner) {
        state.phase = 'fulltime';
        state.events.push({ type: 'whistle', kind: 'fulltime' });
        setBanner(
          state,
          pen.winner === 'home' ? 'SHOOTOUT WIN!' : 'SHOOTOUT LOSS',
          `${pen.homeScore} - ${pen.awayScore}`,
          'whistle',
          3.0,
        );
      } else {
        pen.phaseTimer = 0;
        resetForPenaltyKick(state);
        state.phase = 'penalty_aim';
      }
    }
  }
}

export function setupCornerKickSetPiece(state: MatchState, sp: SetPieceState): void {
  const goalSign = sp.x >= 0 ? 1 : -1;
  const cornerSign = sp.z >= 0 ? 1 : -1;
  const cornerX = goalSign * (PITCH.HALF_LENGTH - 0.55);
  const cornerZ = cornerSign * (PITCH.HALF_WIDTH - 0.55);
  const goalX = goalSign * PITCH.HALF_LENGTH;
  const targetX = goalX - goalSign * 4.4;
  const targetZ = -cornerSign * 0.8;

  resetBallMotion(state.ball, cornerX, PITCH.BALL_RADIUS, cornerZ);

  const attackingOutfield = state.players.filter(
    (p) => p.team === sp.team && !p.sentOff && p.role !== 'GK',
  );
  const defendingTeam: TeamSide = sp.team === 'home' ? 'away' : 'home';
  const defendingOutfield = state.players.filter(
    (p) => p.team === defendingTeam && !p.sentOff && p.role !== 'GK',
  );

  // Pick corner taker (prefer MID or FWD closest to corner)
  attackingOutfield.sort(
    (a, b) => Math.hypot(a.x - cornerX, a.z - cornerZ) - Math.hypot(b.x - cornerX, b.z - cornerZ),
  );
  const taker = attackingOutfield[0];
  if (taker) {
    taker.x = cornerX + goalSign * 0.45;
    taker.z = cornerZ + cornerSign * 0.45;
    taker.vx = 0;
    taker.vz = 0;
    taker.facing = Math.atan2(targetZ - taker.z, targetX - taker.x);
  }

  // Pack remaining attacking players across the 6-yard box & penalty spot like reference image
  const boxAttackSlots: Array<[number, number]> = [
    [3.8, -2.5],
    [4.4, 0.2],
    [5.0, 3.0],
    [7.2, -1.2],
    [13.8, -cornerSign * 3.6],
  ];
  attackingOutfield.slice(1).forEach((p, idx) => {
    const slot = boxAttackSlots[idx % boxAttackSlots.length];
    p.x = goalX - goalSign * slot[0];
    p.z = slot[1];
    p.vx = 0;
    p.vz = 0;
    p.facing = Math.atan2(-p.z * 0.2, goalX - p.x);
  });

  // Pack defending players tightly inside the 6-yard box around the attackers
  const boxDefendSlots: Array<[number, number]> = [
    [2.3, -2.8],
    [2.5, -0.2],
    [3.0, 2.4],
    [5.8, -2.1],
    [6.1, 1.8],
    [12.0, cornerSign * 2.8],
  ];
  defendingOutfield.forEach((p, idx) => {
    const slot = boxDefendSlots[idx % boxDefendSlots.length];
    p.x = goalX - goalSign * slot[0];
    p.z = slot[1];
    p.vx = 0;
    p.vz = 0;
    p.facing = Math.atan2(cornerZ - p.z, cornerX - p.x);
  });

  // Position both goalkeepers
  for (const gk of state.players.filter((p) => p.role === 'GK' && !p.sentOff)) {
    gk.vx = 0;
    gk.vz = 0;
    if (gk.team === defendingTeam) {
      gk.x = goalX - goalSign * 0.85;
      gk.z = cornerSign * 0.35;
      gk.facing = goalSign === 1 ? Math.PI : 0;
    } else {
      gk.x = -goalX + goalSign * 1.4;
      gk.z = 0;
      gk.facing = goalSign === 1 ? 0 : Math.PI;
    }
  }

  state.corner = {
    team: sp.team,
    cornerX,
    cornerZ,
    targetX,
    targetZ,
    power: 0.65,
    charging: false,
    aiTimer: 0.85,
    takerId: taker ? taker.id : '',
  };
  state.shotPower = 0;
  state.isChargingShot = false;
  state.phase = 'corner_aim';

  if (sp.team === 'home' && state.mode !== 'attract') {
    if (taker) state.activePlayerId = taker.id;
    const prompts = getControlPrompts(state.inputSource);
    setBanner(state, 'CORNER KICK', prompts.cornerAim, 'setpiece', 2.6);
  } else {
    setBanner(state, 'CORNER KICK', 'DEFEND THE 6-YARD BOX!', 'setpiece', 1.2);
  }
}

export function launchCornerCross(state: MatchState): void {
  const corner = state.corner;
  if (!corner) return;

  const taker = state.players.find((p) => p.id === corner.takerId);
  const goalSign = corner.cornerX >= 0 ? 1 : -1;
  const dx = corner.targetX - corner.cornerX;
  const dz = corner.targetZ - corner.cornerZ;
  const dist = Math.hypot(dx, dz) || 1;
  const fx = dx / dist;
  const fz = dz / dist;
  const px = -fz;
  const pz = fx;

  // Swing outward away from goal line into the box, then whip back inward toward the 6-yard box
  const curveDir = Math.sign(-goalSign * px) || 1;
  const outwardAngle = 0.42;
  const cosA = Math.cos(outwardAngle);
  const sinA = Math.sin(outwardAngle);
  const pwr = Math.max(0.45, Math.min(1, corner.power));
  const baseSpeed = 16.5 + pwr * 5.0;
  const launchSpeed = baseSpeed * 1.08;
  const flightTime = Math.max(0.75, Math.min(1.25, dist / baseSpeed));

  const launchDirX = fx * cosA + curveDir * px * sinA;
  const launchDirZ = fz * cosA + curveDir * pz * sinA;

  state.ball.vx = launchDirX * launchSpeed;
  state.ball.vz = launchDirZ * launchSpeed;
  const vPerp0 = curveDir * launchSpeed * sinA;
  state.ball.spinY = Math.max(-44, Math.min(44, (-2.15 * vPerp0) / flightTime / 1.45));
  state.ball.vy = (1.75 - state.ball.y + 0.5 * GRAVITY * flightTime * flightTime) / flightTime;

  state.ball.isPassOrShot = true;
  state.ball.isCurveShot = true;
  state.ball.isCornerCross = true;
  state.ball.curveTimer = flightTime + 0.25;
  state.ball.curveDirection = curveDir;
  state.ball.curveTrail = [{ x: state.ball.x, y: state.ball.y, z: state.ball.z, age: 0 }];
  state.ball.curveTrailFade = 1.15;
  state.ball.lastTrailX = state.ball.x;
  state.ball.lastTrailY = state.ball.y;
  state.ball.lastTrailZ = state.ball.z;
  state.ball.lastTouchTeam = corner.team;
  state.ball.lastTouchPlayerId = taker ? taker.id : null;
  if (taker) taker.kickAnimTimer = 0.3;

  state.events.push({
    type: 'kick',
    power: pwr,
    isPass: false,
    isCurveShot: true,
    x: state.ball.x,
    y: state.ball.y,
    z: state.ball.z,
  });

  // Switch active player into the 6-yard box so the user can contest the header!
  if (corner.team === 'home' && state.mode !== 'attract') {
    const candidates = state.players.filter(
      (p) => p.team === 'home' && !p.sentOff && p.role !== 'GK' && p.id !== corner.takerId,
    );
    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - corner.targetX, a.z - corner.targetZ) -
        Math.hypot(b.x - corner.targetX, b.z - corner.targetZ),
    );
    if (candidates[0]) {
      state.activePlayerId = candidates[0].id;
    }
    const prompts = getControlPrompts(state.inputSource);
    setBanner(state, 'CROSS IN!', prompts.cornerHeader, 'curve', 1.25);
  }

  state.corner = null;
  state.shotPower = 0;
  state.isChargingShot = false;
  state.phase = 'live';
}

function stepCornerAimMode(state: MatchState, input: InputState, dt: number): void {
  const corner = state.corner;
  if (!corner) {
    state.phase = 'live';
    return;
  }

  const goalSign = corner.cornerX >= 0 ? 1 : -1;
  const goalX = goalSign * PITCH.HALF_LENGTH;

  if (corner.team === 'home' && state.mode !== 'attract') {
    const minX = goalSign === 1 ? goalX - 11.5 : goalX + 1.8;
    const maxX = goalSign === 1 ? goalX - 1.8 : goalX + 11.5;
    corner.targetX = Math.max(minX, Math.min(maxX, corner.targetX + input.moveX * dt * 8.5));
    corner.targetZ = Math.max(-7.5, Math.min(7.5, corner.targetZ + input.moveZ * dt * 9.5));

    const taker = state.players.find((p) => p.id === corner.takerId);
    if (taker) {
      taker.facing = Math.atan2(corner.targetZ - taker.z, corner.targetX - taker.x);
    }

    if (input.shootHeld) {
      if (!corner.charging) {
        corner.charging = true;
        corner.power = 0.45;
      } else {
        corner.power = Math.min(1, corner.power + dt * 0.9);
      }
      state.isChargingShot = true;
      state.shotPower = corner.power;
    }

    if ((input.shootJustReleased && corner.charging) || input.chipJustPressed || input.passJustPressed) {
      corner.charging = false;
      launchCornerCross(state);
    }
  } else {
    corner.aiTimer -= dt;
    if (corner.aiTimer <= 0) {
      corner.power = 0.68;
      launchCornerCross(state);
    }
  }
}

function getThrowInPassCandidates(state: MatchState, team: TeamSide, takerId: string): PlayerState[] {
  const candidates = state.players.filter(
    (p) => p.team === team && !p.sentOff && p.id !== takerId && p.role !== 'GK',
  );
  if (candidates.length > 0) return candidates;
  return state.players.filter((p) => p.team === team && !p.sentOff && p.id !== takerId);
}

function positionOverheadThrowBall(state: MatchState, taker: PlayerState): void {
  state.ball.x = taker.x - Math.cos(taker.facing) * 0.18;
  state.ball.y = 2.22;
  state.ball.z = taker.z - Math.sin(taker.facing) * 0.18;
}

export function setupThrowInSetPiece(state: MatchState, sp: SetPieceState): void {
  const sideSign = sp.z >= 0 ? 1 : -1;
  const teamDir = sp.team === 'home' ? 1 : -1;
  const throwX = Math.max(-PITCH.HALF_LENGTH + 3, Math.min(PITCH.HALF_LENGTH - 3, sp.x));
  const sidelineZ = sideSign * (PITCH.HALF_WIDTH + 0.35);

  const teamOutfield = state.players.filter(
    (p) => p.team === sp.team && !p.sentOff && p.role !== 'GK',
  );
  teamOutfield.sort(
    (a, b) => Math.hypot(a.x - throwX, a.z - sidelineZ) - Math.hypot(b.x - throwX, b.z - sidelineZ),
  );
  const taker = teamOutfield[0] ?? state.players.find((p) => p.team === sp.team && !p.sentOff)!;

  taker.x = throwX;
  taker.z = sidelineZ;
  taker.y = 0;
  taker.vx = 0;
  taker.vz = 0;
  taker.slideTimer = 0;
  taker.ragdollTimer = 0;
  taker.diveTimer = 0;
  taker.jumpTimer = 0;
  taker.leanX = 0;
  taker.leanZ = 0;

  // Place teammates in clear passing options across the pitch ahead of the thrower
  const teammateOffsets: Array<[number, number]> = [
    [teamDir * 3.8, -sideSign * 7.2],
    [teamDir * 10.5, -sideSign * 6.5],
    [-teamDir * 3.2, -sideSign * 13.0],
    [teamDir * 7.5, -sideSign * 14.5],
    [-teamDir * 10.5, -sideSign * 9.5],
  ];
  const teammates = teamOutfield.filter((p) => p.id !== taker.id);
  teammates.forEach((p, idx) => {
    const off = teammateOffsets[idx % teammateOffsets.length];
    p.x = Math.max(-PITCH.HALF_LENGTH + 3.5, Math.min(PITCH.HALF_LENGTH - 3.5, throwX + off[0]));
    p.z = Math.max(-PITCH.HALF_WIDTH + 2.5, Math.min(PITCH.HALF_WIDTH - 2.5, sidelineZ + off[1]));
    p.y = 0;
    p.vx = 0;
    p.vz = 0;
    p.slideTimer = 0;
    p.ragdollTimer = 0;
    p.facing = Math.atan2(sidelineZ - p.z, throwX - p.x);
  });

  // Place opponents nearby in realistic marking positions without blocking immediate lane
  const oppTeam: TeamSide = sp.team === 'home' ? 'away' : 'home';
  const oppOffsets: Array<[number, number]> = [
    [teamDir * 5.8, -sideSign * 10.5],
    [teamDir * 12.8, -sideSign * 8.2],
    [-teamDir * 1.5, -sideSign * 9.5],
    [teamDir * 9.5, -sideSign * 16.5],
    [-teamDir * 8.0, -sideSign * 12.0],
    [teamDir * 15.0, -sideSign * 13.5],
  ];
  const oppOutfield = state.players.filter((p) => p.team === oppTeam && !p.sentOff && p.role !== 'GK');
  oppOutfield.forEach((p, idx) => {
    const off = oppOffsets[idx % oppOffsets.length];
    p.x = Math.max(-PITCH.HALF_LENGTH + 3, Math.min(PITCH.HALF_LENGTH - 3, throwX + off[0]));
    p.z = Math.max(-PITCH.HALF_WIDTH + 2.5, Math.min(PITCH.HALF_WIDTH - 2.5, sidelineZ + off[1]));
    p.y = 0;
    p.vx = 0;
    p.vz = 0;
    p.facing = Math.atan2(sidelineZ - p.z, throwX - p.x);
  });

  state.referee.x = Math.max(-22, Math.min(22, throwX - teamDir * 5.5));
  state.referee.z = -sideSign * 4.5;
  state.referee.vx = 0;
  state.referee.vz = 0;
  state.referee.facing = Math.atan2(sidelineZ - state.referee.z, throwX - state.referee.x);

  const defaultTarget = teammates[0] ?? getThrowInPassCandidates(state, sp.team, taker.id)[0] ?? null;
  if (defaultTarget) {
    taker.facing = Math.atan2(defaultTarget.z - taker.z, defaultTarget.x - taker.x);
  } else {
    taker.facing = sideSign > 0 ? -Math.PI / 2 : Math.PI / 2;
  }

  resetBallMotion(state.ball, taker.x, 2.06, taker.z);
  positionOverheadThrowBall(state, taker);

  state.throwIn = {
    team: sp.team,
    takerId: taker.id,
    targetPlayerId: defaultTarget ? defaultTarget.id : null,
    x: throwX,
    z: sidelineZ,
    aiTimer: 0.85,
  };
  state.shotPower = 0;
  state.isChargingShot = false;
  state.phase = 'throw_in_aim';

  if (sp.team === 'home' && state.mode !== 'attract') {
    state.activePlayerId = taker.id;
    const prompts = getControlPrompts(state.inputSource);
    setBanner(
      state,
      'THROW-IN',
      prompts.throwInAim,
      'setpiece',
      2.8,
    );
  } else {
    setBanner(state, 'THROW-IN', `${sp.team.toUpperCase()} THROW-IN`, 'setpiece', 1.2);
  }
}

export function launchThrowInPass(state: MatchState): void {
  const throwIn = state.throwIn;
  if (!throwIn) return;

  const taker = state.players.find((p) => p.id === throwIn.takerId);
  const candidates = getThrowInPassCandidates(state, throwIn.team, throwIn.takerId);
  const target =
    candidates.find((p) => p.id === throwIn.targetPlayerId) ??
    candidates[0] ??
    null;

  if (taker) {
    const fallbackZ = throwIn.z >= 0 ? throwIn.z - 10 : throwIn.z + 10;
    const destX = target ? target.x : throwIn.x + (throwIn.team === 'home' ? 6 : -6);
    const destZ = target ? target.z : fallbackZ;
    const dx = destX - state.ball.x;
    const dz = destZ - state.ball.z;
    const dist = Math.hypot(dx, dz) || 1;
    const flightTime = Math.max(0.45, Math.min(0.95, dist / 15.5));

    taker.facing = Math.atan2(destZ - taker.z, destX - taker.x);
    taker.kickAnimTimer = 0.28;

    state.ball.vx = dx / flightTime;
    state.ball.vz = dz / flightTime;
    state.ball.vy = (0.65 - state.ball.y + 0.5 * GRAVITY * flightTime * flightTime) / flightTime;
    state.ball.spinY = 0;
    state.ball.isPassOrShot = true;
    state.ball.isCurveShot = false;
    state.ball.isCornerCross = false;
    state.ball.aftertouchTeam = throwIn.team;
    state.ball.aftertouchTimer = 0.4;
    state.ball.lastTouchTeam = throwIn.team;
    state.ball.lastTouchPlayerId = taker.id;

    state.events.push({
      type: 'kick',
      power: 0.55,
      isPass: true,
      isCurveShot: false,
      x: state.ball.x,
      y: state.ball.y,
      z: state.ball.z,
    });
  }

  if (throwIn.team === 'home' && target && state.mode !== 'attract') {
    state.activePlayerId = target.id;
  }

  state.throwIn = null;
  state.shotPower = 0;
  state.isChargingShot = false;
  state.phase = 'live';
}

function stepThrowInAimMode(state: MatchState, input: InputState, dt: number): void {
  const throwIn = state.throwIn;
  if (!throwIn) {
    state.phase = 'live';
    return;
  }

  const taker = state.players.find((p) => p.id === throwIn.takerId);
  const candidates = getThrowInPassCandidates(state, throwIn.team, throwIn.takerId);

  if (throwIn.team === 'home' && state.mode !== 'attract' && taker && candidates.length > 0) {
    if (input.switchJustPressed) {
      const sorted = [...candidates].sort((a, b) => a.x - b.x || a.z - b.z);
      const curIdx = sorted.findIndex((p) => p.id === throwIn.targetPlayerId);
      const next = sorted[(curIdx + 1) % sorted.length];
      throwIn.targetPlayerId = next.id;
    } else if (Math.hypot(input.moveX, input.moveZ) > 0.25) {
      const target = choosePassTarget(taker, candidates, input.moveX, input.moveZ);
      if (target) throwIn.targetPlayerId = target.id;
    }

    const activeTarget =
      candidates.find((p) => p.id === throwIn.targetPlayerId) ?? candidates[0];
    if (activeTarget) {
      throwIn.targetPlayerId = activeTarget.id;
      const desiredFacing = Math.atan2(activeTarget.z - taker.z, activeTarget.x - taker.x);
      taker.facing = lerpAngle(taker.facing, desiredFacing, 1 - Math.exp(-14 * dt));
    }
    positionOverheadThrowBall(state, taker);

    if (
      input.passJustPressed ||
      input.throughJustPressed ||
      input.chipJustPressed ||
      input.shootJustPressed ||
      input.shootJustReleased
    ) {
      launchThrowInPass(state);
    }
  } else {
    if (taker) positionOverheadThrowBall(state, taker);
    throwIn.aiTimer -= dt;
    if (throwIn.aiTimer <= 0) {
      launchThrowInPass(state);
    }
  }
}

export function getHudSnapshot(state: MatchState): HudSnapshot {
  const active = state.players.find((p) => p.id === state.activePlayerId);
  return {
    homeScore: state.homeScore,
    awayScore: state.awayScore,
    clockSeconds: Math.round(state.clockSeconds),
    half: state.half,
    phase: state.phase,
    activeStamina: active ? active.stamina : 1,
    activeNumber: active ? active.number : 10,
    shotPower: state.shotPower,
    isChargingShot: state.isChargingShot,
    banner: state.banner ? { ...state.banner } : null,
    refereeChasing: state.referee.state === 'chasing',
    stats: { ...state.stats },
    penalty: state.penalty ? { ...state.penalty } : null,
    crowdExcitement: state.crowdExcitement,
    isBallCurving: state.ball.isCurveShot,
  };
}
