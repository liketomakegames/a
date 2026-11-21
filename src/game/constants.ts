import type { InputSourceInfo } from './controller';

export const PITCH = {
  HALF_LENGTH: 34,
  HALF_WIDTH: 22,
  GOAL_HALF_WIDTH: 3.6,
  GOAL_HEIGHT: 2.6,
  GOAL_DEPTH: 2.2,
  BOX_DEPTH: 10.5,
  BOX_HALF_WIDTH: 8.8,
  SIX_YARD_DEPTH: 4,
  SIX_YARD_HALF_WIDTH: 4.8,
  PENALTY_SPOT_OFFSET: 8.2,
  CENTER_CIRCLE_RADIUS: 5.5,
  BALL_RADIUS: 0.34,
  PLAYER_RADIUS: 0.56,
  MATCH_DURATION_SECONDS: 180,
} as const;

export const CURVE_SHOT_CHANCE = 1 / 3;
export const GK_TIP_OVER_CORNER_CHANCE = 0.15;

export type Difficulty = 'easy' | 'medium' | 'hard';
export type MatchMode = 'attract' | 'quick' | 'tournament' | 'penalty';
export type TeamSide = 'home' | 'away';
export type PlayerRole = 'GK' | 'DEF' | 'MID' | 'FWD';
export type MatchPhase =
  | 'kickoff'
  | 'live'
  | 'goal_celebration'
  | 'set_piece_reset'
  | 'corner_aim'
  | 'throw_in_aim'
  | 'halftime'
  | 'fulltime'
  | 'penalty_aim'
  | 'penalty_flight'
  | 'penalty_result';

export type BannerTone = 'info' | 'goal' | 'whistle' | 'yellow' | 'red' | 'setpiece' | 'curve';

export interface FormationSlot {
  role: PlayerRole;
  number: number;
  relX: number;
  relZ: number;
}

export const FORMATION_7V7: FormationSlot[] = [
  { role: 'GK', number: 1, relX: -0.94, relZ: 0 },
  { role: 'DEF', number: 4, relX: -0.6, relZ: -0.4 },
  { role: 'DEF', number: 5, relX: -0.6, relZ: 0.4 },
  { role: 'MID', number: 6, relX: -0.32, relZ: -0.45 },
  { role: 'MID', number: 8, relX: -0.32, relZ: 0.45 },
  { role: 'FWD', number: 9, relX: -0.1, relZ: -0.25 },
  { role: 'FWD', number: 10, relX: -0.1, relZ: 0.25 },
];

export interface TeamConfig {
  id: string;
  name: string;
  code: string;
  flag: string;
  primaryColor: string;
  secondaryColor: string;
  gkColor: string;
  rating: number;
}

export interface PlayerState {
  id: string;
  team: TeamSide;
  role: PlayerRole;
  number: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  facing: number;
  homeX: number;
  homeZ: number;
  stamina: number;
  leanX: number;
  leanZ: number;
  wobbleVX: number;
  wobbleVZ: number;
  stridePhase: number;
  slideTimer: number;
  slideCooldown: number;
  ragdollTimer: number;
  tumbleAxisX: number;
  tumbleAxisZ: number;
  diveTimer: number;
  diveDirX: number;
  diveDirZ: number;
  kickAnimTimer: number;
  jumpTimer: number;
  headerCooldown: number;
  yellowCards: number;
  sentOff: boolean;
  aiDecisionTimer: number;
  aiTargetX: number;
  aiTargetZ: number;
}

export interface CurveTrailPoint {
  x: number;
  y: number;
  z: number;
  age: number;
}

export interface BallState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spinX: number;
  spinY: number;
  spinZ: number;
  radius: number;
  lastTouchTeam: TeamSide | null;
  lastTouchPlayerId: string | null;
  aftertouchTeam: TeamSide | null;
  aftertouchTimer: number;
  isPassOrShot: boolean;
  isCurveShot: boolean;
  isCornerCross: boolean;
  curveTimer: number;
  curveDirection: number;
  curveTrail: CurveTrailPoint[];
  curveTrailFade: number;
  lastTrailX: number;
  lastTrailY: number;
  lastTrailZ: number;
}

export interface RefereeState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  state: 'patrol' | 'chasing' | 'booking' | 'cooldown';
  targetPlayerId: string | null;
  chaseTimer: number;
  bookingTimer: number;
  cardToShow: 'yellow' | 'red' | null;
  stridePhase: number;
  leanX: number;
  leanZ: number;
}

export interface SetPieceState {
  kind: 'throw_in' | 'corner' | 'goal_kick';
  team: TeamSide;
  x: number;
  z: number;
}

export interface CornerKickState {
  team: TeamSide;
  cornerX: number;
  cornerZ: number;
  targetX: number;
  targetZ: number;
  power: number;
  charging: boolean;
  aiTimer: number;
  takerId: string;
}

export interface ThrowInState {
  team: TeamSide;
  takerId: string;
  targetPlayerId: string | null;
  x: number;
  z: number;
  aiTimer: number;
}

export interface MatchBanner {
  id: number;
  title: string;
  subtitle: string;
  tone: BannerTone;
  timer: number;
}

export interface MatchStats {
  homeShots: number;
  awayShots: number;
  homeCurveShots: number;
  awayCurveShots: number;
  homeTackles: number;
  awayTackles: number;
  homeCards: number;
  awayCards: number;
  homePossessionTime: number;
  awayPossessionTime: number;
}

export interface PenaltyState {
  turn: TeamSide;
  round: number;
  homeKicks: Array<boolean | null>;
  awayKicks: Array<boolean | null>;
  homeScore: number;
  awayScore: number;
  aimX: number;
  aimY: number;
  power: number;
  charging: boolean;
  curveInput: number;
  keeperDiveDir: number;
  cpuAimTarget: { x: number; y: number; curve: number };
  phaseTimer: number;
  winner: TeamSide | null;
  bannerText: string;
}

export type MatchEvent =
  | { type: 'kick'; power: number; isPass: boolean; isCurveShot: boolean; x: number; y: number; z: number }
  | { type: 'postHit'; x: number; z: number }
  | { type: 'netHit'; side: 'left' | 'right'; x: number; y: number; z: number; vx: number }
  | { type: 'goal'; scoringTeam: TeamSide }
  | { type: 'whistle'; kind: 'kickoff' | 'foul' | 'fulltime' }
  | { type: 'tackle'; x: number; z: number }
  | { type: 'save'; x: number; z: number }
  | { type: 'card'; card: 'yellow' | 'red' };

export interface InputState {
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

export interface MatchState {
  mode: MatchMode;
  difficulty: Difficulty;
  players: PlayerState[];
  ball: BallState;
  referee: RefereeState;
  activePlayerId: string;
  homeScore: number;
  awayScore: number;
  clockSeconds: number;
  half: 1 | 2;
  phase: MatchPhase;
  phaseTimer: number;
  pendingSetPiece: SetPieceState | null;
  shotPower: number;
  isChargingShot: boolean;
  banner: MatchBanner | null;
  bannerSeq: number;
  stats: MatchStats;
  penalty: PenaltyState | null;
  corner: CornerKickState | null;
  throwIn: ThrowInState | null;
  crowdExcitement: number;
  inputSource: InputSourceInfo;
  events: MatchEvent[];
}

export interface HudSnapshot {
  homeScore: number;
  awayScore: number;
  clockSeconds: number;
  half: 1 | 2;
  phase: MatchPhase;
  activeStamina: number;
  activeNumber: number;
  shotPower: number;
  isChargingShot: boolean;
  banner: MatchBanner | null;
  refereeChasing: boolean;
  stats: MatchStats;
  penalty: PenaltyState | null;
  crowdExcitement: number;
  isBallCurving: boolean;
}
