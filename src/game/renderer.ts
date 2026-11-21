import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MatchState, PITCH, TeamConfig } from './constants';

interface PlayerRig {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  torso: THREE.Mesh;
  chestStripe: THREE.Mesh;
  shorts: THREE.Mesh;
  head: THREE.Mesh;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  shadow: THREE.Mesh;
  cardIndicator: THREE.Mesh;
}

interface GoalNetRig {
  geometry: THREE.PlaneGeometry;
  restPos: Float32Array;
  impulseTime: number;
  hitY: number;
  hitZ: number;
  strength: number;
}

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
  color: THREE.Color;
}

const MAX_CURVE_TRAIL = 16;
const MAX_CORNER_ARC_DOTS = 24;
const MAX_CORNER_GOAL_DASHES = 6;

const dummyObj = new THREE.Object3D();
const desiredCamPos = new THREE.Vector3();
const desiredCamTarget = new THREE.Vector3();
const currentCamTarget = new THREE.Vector3();
const tmpColor = new THREE.Color();

export class PitchRenderer {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private resizeObserver: ResizeObserver;

  private playerRigs = new Map<string, PlayerRig>();
  private refRig!: PlayerRig;
  private refCardMesh!: THREE.Mesh;
  private ballMesh!: THREE.Mesh;
  private normalBallMat!: THREE.MeshStandardMaterial;
  private curveBallMat!: THREE.MeshStandardMaterial;
  private ballShadow!: THREE.Mesh;
  private activeRing!: THREE.Mesh;
  private aimArrow!: THREE.Group;
  private aimArrowShaft!: THREE.Mesh;
  private penaltyReticle!: THREE.Mesh;

  private leftNet!: GoalNetRig;
  private rightNet!: GoalNetRig;

  private crowdInstanced!: THREE.InstancedMesh;
  private crowdBasePositions: Array<{ x: number; y: number; z: number; phase: number }> = [];

  private particleInstanced!: THREE.InstancedMesh;
  private particles: ParticleSlot[] = [];
  private particleCursor = 0;

  private curveTrailInstanced!: THREE.InstancedMesh;
  private curveTrailBallMat!: THREE.MeshStandardMaterial;

  private cornerArcInstanced!: THREE.InstancedMesh;
  private cornerArcArrowHead!: THREE.Mesh;
  private cornerGoalArrowInstanced!: THREE.InstancedMesh;
  private cornerGoalArrowHead!: THREE.Mesh;
  private cornerTargetRing!: THREE.Mesh;

  private homePrimaryMat!: THREE.MeshStandardMaterial;
  private homeSecondaryMat!: THREE.MeshStandardMaterial;
  private homeGkMat!: THREE.MeshStandardMaterial;
  private awayPrimaryMat!: THREE.MeshStandardMaterial;
  private awaySecondaryMat!: THREE.MeshStandardMaterial;
  private awayGkMat!: THREE.MeshStandardMaterial;

  private trauma = 0;
  private elapsed = 0;
  private frameId = 0;
  private disposed = false;
  private onFrameCallback: ((dt: number) => void) | null = null;
  private lastTimestamp = performance.now();

  constructor(container: HTMLElement, homeTeam: TeamConfig, awayTeam: TeamConfig) {
    this.container = container;
    this.isSoftwareGl = detectSoftwareWebGL();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 240);
    this.renderer.setSize(width, height);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const skyColor = new THREE.Color(0x0b1628);
    this.scene.background = skyColor;
    this.scene.fog = new THREE.Fog(skyColor, 68, 155);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(roomEnv, 0.04).texture;
    roomEnv.dispose();
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.5, 220);
    this.camera.position.set(0, 29, 27);
    currentCamTarget.set(0, 0, 1);
    this.camera.lookAt(currentCamTarget);

    this.setupLighting();
    this.buildPitchAndStadium();
    this.buildGoalsAndNets();
    this.buildCrowdBorder();
    this.buildMaterials(homeTeam, awayTeam);
    this.buildActors();
    this.buildParticles();
    this.buildCurveTrail();
    this.buildCornerGuide();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
  }

  private setupLighting(): void {
    const hemi = new THREE.HemisphereLight(0xa5d8ff, 0x164e2a, 0.85);
    hemi.position.set(0, 40, 0);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff0d6, 1.85);
    key.position.set(22, 42, 24);
    key.castShadow = !this.isSoftwareGl;
    key.shadow.mapSize.width = 1024;
    key.shadow.mapSize.height = 1024;
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 110;
    const d = 42;
    key.shadow.camera.left = -d;
    key.shadow.camera.right = d;
    key.shadow.camera.top = d;
    key.shadow.camera.bottom = -d;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x7dd3fc, 0.55);
    rim.position.set(-28, 26, -30);
    this.scene.add(rim);
  }

  private buildPitchAndStadium(): void {
    const apronGeo = new THREE.PlaneGeometry(130, 96);
    const apronMat = new THREE.MeshStandardMaterial({ color: 0x0f3d21, roughness: 0.92, metalness: 0 });
    const apron = new THREE.Mesh(apronGeo, apronMat);
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.02;
    apron.receiveShadow = true;
    this.scene.add(apron);

    const trackGeo = new THREE.PlaneGeometry(PITCH.HALF_LENGTH * 2 + 10, PITCH.HALF_WIDTH * 2 + 10);
    const trackMat = new THREE.MeshStandardMaterial({ color: 0x1a3829, roughness: 0.85, metalness: 0.05 });
    const track = new THREE.Mesh(trackGeo, trackMat);
    track.rotation.x = -Math.PI / 2;
    track.position.y = -0.01;
    track.receiveShadow = true;
    this.scene.add(track);

    const pitchTex = createPitchTexture();
    pitchTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const turfGeo = new THREE.PlaneGeometry(PITCH.HALF_LENGTH * 2 + 4, PITCH.HALF_WIDTH * 2 + 4);
    const turfMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: pitchTex,
      roughness: 0.82,
      metalness: 0,
    });
    const turf = new THREE.Mesh(turfGeo, turfMat);
    turf.rotation.x = -Math.PI / 2;
    turf.position.y = 0;
    turf.receiveShadow = true;
    this.scene.add(turf);

    const boardMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.2 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4, metalness: 0.1 });
    const boardLen = PITCH.HALF_LENGTH * 2 + 6;
    for (const side of [-1, 1]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(boardLen, 1.1, 0.4), boardMat);
      board.position.set(0, 0.55, side * (PITCH.HALF_WIDTH + 3.2));
      this.scene.add(board);

      const stripe = new THREE.Mesh(new THREE.BoxGeometry(boardLen * 0.45, 0.35, 0.44), accentMat);
      stripe.position.set(0, 0.6, side * (PITCH.HALF_WIDTH + 3.2));
      this.scene.add(stripe);
    }

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.6 });
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfffbeb,
      emissive: 0xfef08a,
      emissiveIntensity: 1.5,
      roughness: 0.2,
    });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const tower = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 22, 8), poleMat);
        pole.position.y = 11;
        tower.add(pole);

        const head = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.8, 1.1), poleMat);
        head.position.set(0, 22, 0);
        head.lookAt(0, 0, 0);
        tower.add(head);

        const face = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.3), lampMat);
        face.position.set(0, 0, 0.58);
        head.add(face);

        tower.position.set(sx * (PITCH.HALF_LENGTH + 11), 0, sz * (PITCH.HALF_WIDTH + 10));
        this.scene.add(tower);
      }
    }
  }

  private buildGoalsAndNets(): void {
    const postMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25, metalness: 0.55 });
    const netMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      wireframe: true,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
    });

    const createGoal = (side: 'left' | 'right'): GoalNetRig => {
      const sign = side === 'right' ? 1 : -1;
      const gx = sign * PITCH.HALF_LENGTH;
      const hw = PITCH.GOAL_HALF_WIDTH;
      const gh = PITCH.GOAL_HEIGHT;
      const gd = PITCH.GOAL_DEPTH;

      const group = new THREE.Group();
      const postGeo = new THREE.CylinderGeometry(0.11, 0.11, gh, 12);
      for (const zOff of [-hw, hw]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(gx, gh / 2, zOff);
        post.castShadow = !this.isSoftwareGl;
        group.add(post);
      }

      const barGeo = new THREE.CylinderGeometry(0.11, 0.11, hw * 2 + 0.22, 12);
      const crossbar = new THREE.Mesh(barGeo, postMat);
      crossbar.rotation.x = Math.PI / 2;
      crossbar.position.set(gx, gh, 0);
      crossbar.castShadow = !this.isSoftwareGl;
      group.add(crossbar);

      const supportGeo = new THREE.CylinderGeometry(0.07, 0.07, gd, 8);
      for (const zOff of [-hw, hw]) {
        const topSupport = new THREE.Mesh(supportGeo, postMat);
        topSupport.rotation.z = Math.PI / 2;
        topSupport.position.set(gx + sign * (gd / 2), gh, zOff);
        group.add(topSupport);

        const backPost = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, gh, 8), postMat);
        backPost.position.set(gx + sign * gd, gh / 2, zOff);
        group.add(backPost);
      }
      this.scene.add(group);

      const backNetGeo = new THREE.PlaneGeometry(hw * 2, gh, 14, 8);
      const posAttr = backNetGeo.attributes.position as THREE.BufferAttribute;
      const restPos = new Float32Array(posAttr.array.length);
      restPos.set(posAttr.array as Float32Array);

      const backNet = new THREE.Mesh(backNetGeo, netMat);
      backNet.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
      backNet.position.set(gx + sign * gd, gh / 2, 0);
      this.scene.add(backNet);

      const sideNetGeo = new THREE.PlaneGeometry(gd, gh, 6, 6);
      for (const zOff of [-hw, hw]) {
        const sideNet = new THREE.Mesh(sideNetGeo, netMat);
        sideNet.position.set(gx + sign * (gd / 2), gh / 2, zOff);
        this.scene.add(sideNet);
      }

      const roofNetGeo = new THREE.PlaneGeometry(gd, hw * 2, 6, 10);
      const roofNet = new THREE.Mesh(roofNetGeo, netMat);
      roofNet.rotation.x = Math.PI / 2;
      roofNet.position.set(gx + sign * (gd / 2), gh, 0);
      this.scene.add(roofNet);

      return {
        geometry: backNetGeo,
        restPos,
        impulseTime: -10,
        hitY: gh / 2,
        hitZ: 0,
        strength: 0,
      };
    };

    this.leftNet = createGoal('left');
    this.rightNet = createGoal('right');
  }

  private buildCrowdBorder(): void {
    const tierMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85, metalness: 0.1 });
    for (let t = 0; t < 3; t++) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(84, 1.4 + t * 1.0, 1.7), tierMat);
      stand.position.set(0, (1.4 + t * 1.0) / 2, -(PITCH.HALF_WIDTH + 4.4 + t * 1.6));
      this.scene.add(stand);
    }

    const nearStand = new THREE.Mesh(new THREE.BoxGeometry(84, 3.2, 6.5), tierMat);
    nearStand.position.set(0, 1.6, PITCH.HALF_WIDTH + 8);
    this.scene.add(nearStand);

    for (const sx of [-1, 1]) {
      const endStand = new THREE.Mesh(new THREE.BoxGeometry(8, 2.2, 56), tierMat);
      endStand.position.set(sx * (PITCH.HALF_LENGTH + 9.5), 1.1, 0);
      this.scene.add(endStand);
    }

    const fanGeo = new THREE.BoxGeometry(0.68, 1.1, 0.58);
    const fanMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0 });
    const fanSpecs: Array<{ x: number; y: number; z: number; phase: number; color: number }> = [];
    const palette = [0xef4444, 0x3b82f6, 0xfacc15, 0x10b981, 0xf97316, 0xf8fafc, 0xec4899];

    for (let t = 0; t < 3; t++) {
      for (let x = -36; x <= 36; x += 1.35) {
        fanSpecs.push({
          x: x + (t % 2) * 0.45,
          y: 2.0 + t * 1.0,
          z: -(PITCH.HALF_WIDTH + 4.4 + t * 1.6),
          phase: (x * 0.35 + t) % (Math.PI * 2),
          color: palette[Math.abs(Math.round(x * 3 + t)) % palette.length],
        });
      }
    }

    for (const sx of [-1, 1]) {
      for (let tier = 0; tier < 2; tier++) {
        for (let z = -22; z <= 22; z += 1.6) {
          fanSpecs.push({
            x: sx * (PITCH.HALF_LENGTH + 6.8 + tier * 1.8),
            y: 3.1 + tier * 1.2,
            z: z + (tier % 2) * 0.4,
            phase: (z * 0.4 + tier) % (Math.PI * 2),
            color: palette[Math.abs(Math.round(z * 5 + tier)) % palette.length],
          });
        }
      }
    }

    this.crowdInstanced = new THREE.InstancedMesh(fanGeo, fanMat, fanSpecs.length);
    this.crowdInstanced.frustumCulled = false;

    fanSpecs.forEach((spec, idx) => {
      this.crowdBasePositions.push({ x: spec.x, y: spec.y, z: spec.z, phase: spec.phase });
      dummyObj.position.set(spec.x, spec.y, spec.z);
      dummyObj.rotation.set(0, 0, 0);
      dummyObj.scale.set(1, 1, 1);
      dummyObj.updateMatrix();
      this.crowdInstanced.setMatrixAt(idx, dummyObj.matrix);
      tmpColor.setHex(spec.color);
      this.crowdInstanced.setColorAt(idx, tmpColor);
    });
    this.crowdInstanced.instanceMatrix.needsUpdate = true;
    if (this.crowdInstanced.instanceColor) this.crowdInstanced.instanceColor.needsUpdate = true;
    this.scene.add(this.crowdInstanced);
  }

  private buildMaterials(home: TeamConfig, away: TeamConfig): void {
    this.homePrimaryMat = new THREE.MeshStandardMaterial({ color: home.primaryColor, roughness: 0.65, metalness: 0.05 });
    this.homeSecondaryMat = new THREE.MeshStandardMaterial({ color: home.secondaryColor, roughness: 0.72, metalness: 0.05 });
    this.homeGkMat = new THREE.MeshStandardMaterial({ color: home.gkColor, roughness: 0.55, metalness: 0.1 });

    this.awayPrimaryMat = new THREE.MeshStandardMaterial({ color: away.primaryColor, roughness: 0.65, metalness: 0.05 });
    this.awaySecondaryMat = new THREE.MeshStandardMaterial({ color: away.secondaryColor, roughness: 0.72, metalness: 0.05 });
    this.awayGkMat = new THREE.MeshStandardMaterial({ color: away.gkColor, roughness: 0.55, metalness: 0.1 });
  }

  public updateTeamColors(home: TeamConfig, away: TeamConfig): void {
    this.homePrimaryMat.color.set(home.primaryColor);
    this.homeSecondaryMat.color.set(home.secondaryColor);
    this.homeGkMat.color.set(home.gkColor);
    this.awayPrimaryMat.color.set(away.primaryColor);
    this.awaySecondaryMat.color.set(away.secondaryColor);
    this.awayGkMat.color.set(away.gkColor);
  }

  private createCompositePlayerRig(
    jerseyMat: THREE.MeshStandardMaterial,
    trimMat: THREE.MeshStandardMaterial,
    skinHex: number,
    hairHex: number,
  ): PlayerRig {
    const root = new THREE.Group();

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    root.add(shadow);

    const bodyPivot = new THREE.Group();
    bodyPivot.position.y = 0.72;
    root.add(bodyPivot);

    const shorts = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.28, 0.42), trimMat);
    shorts.position.y = 0.05;
    shorts.castShadow = !this.isSoftwareGl;
    bodyPivot.add(shorts);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.62, 0.44), jerseyMat);
    torso.position.y = 0.48;
    torso.castShadow = !this.isSoftwareGl;
    bodyPivot.add(torso);

    const chestStripe = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.46), trimMat);
    chestStripe.position.y = 0.54;
    bodyPivot.add(chestStripe);

    const skinMat = new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.6, metalness: 0 });
    const hairMat = new THREE.MeshStandardMaterial({ color: hairHex, roughness: 0.85, metalness: 0 });

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), skinMat);
    head.position.y = 1.04;
    head.castShadow = !this.isSoftwareGl;
    bodyPivot.add(head);

    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.16, 0.47), hairMat);
    hair.position.y = 0.18;
    head.add(hair);

    const makeArm = (side: number): THREE.Group => {
      const armPivot = new THREE.Group();
      armPivot.position.set(0, 0.72, side * 0.32);
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.2), jerseyMat);
      sleeve.position.y = -0.1;
      const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.16), skinMat);
      forearm.position.y = -0.34;
      armPivot.add(sleeve, forearm);
      bodyPivot.add(armPivot);
      return armPivot;
    };

    const leftArm = makeArm(-1);
    const rightArm = makeArm(1);

    const bootMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.2 });
    const makeLeg = (side: number): THREE.Group => {
      const legPivot = new THREE.Group();
      legPivot.position.set(0, 0.72, side * 0.16);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.54, 0.22), skinMat);
      shin.position.y = -0.3;
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.24), bootMat);
      boot.position.set(0.05, -0.64, 0);
      legPivot.add(shin, boot);
      root.add(legPivot);
      return legPivot;
    };

    const leftLeg = makeLeg(-1);
    const rightLeg = makeLeg(1);

    const cardIndicator = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.22, 0.04),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 }),
    );
    cardIndicator.position.set(0, 1.48, 0);
    cardIndicator.visible = false;
    bodyPivot.add(cardIndicator);

    this.scene.add(root);

    return {
      root,
      bodyPivot,
      torso,
      chestStripe,
      shorts,
      head,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      shadow,
      cardIndicator,
    };
  }

  private buildActors(): void {
    const skinTones = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
    const hairTones = [0x1e1b18, 0x4a3728, 0xd4a373, 0x111827];

    for (const team of ['home', 'away'] as const) {
      for (let i = 0; i < 7; i++) {
        const isGk = i === 0;
        const jerseyMat =
          team === 'home'
            ? isGk
              ? this.homeGkMat
              : this.homePrimaryMat
            : isGk
              ? this.awayGkMat
              : this.awayPrimaryMat;
        const trimMat = team === 'home' ? this.homeSecondaryMat : this.awaySecondaryMat;
        const rig = this.createCompositePlayerRig(
          jerseyMat,
          trimMat,
          skinTones[(i + (team === 'away' ? 2 : 0)) % skinTones.length],
          hairTones[(i * 3) % hairTones.length],
        );
        this.playerRigs.set(`${team}-${i}`, rig);
      }
    }

    const refShirtMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.55 });
    const refShortMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });
    this.refRig = this.createCompositePlayerRig(refShirtMat, refShortMat, 0xe0ac69, 0x111827);
    this.refCardMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.34, 0.04),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 }),
    );
    this.refCardMesh.position.set(0.2, 0.42, 0.12);
    this.refCardMesh.visible = false;
    this.refRig.rightArm.add(this.refCardMesh);

    const ballTex = createBallTexture();
    const curveBallTex = createCurveBallTexture();
    const ballGeo = new THREE.SphereGeometry(PITCH.BALL_RADIUS, 20, 16);
    this.normalBallMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: ballTex,
      roughness: 0.38,
      metalness: 0.05,
    });
    this.curveBallMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: curveBallTex,
      emissive: 0x6b21a8,
      emissiveIntensity: 0.25,
      roughness: 0.3,
      metalness: 0.1,
    });

    this.ballMesh = new THREE.Mesh(ballGeo, this.normalBallMat);
    this.ballMesh.castShadow = !this.isSoftwareGl;
    this.scene.add(this.ballMesh);

    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(PITCH.BALL_RADIUS * 1.15, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false }),
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.y = 0.015;
    this.scene.add(this.ballShadow);

    this.activeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.68, 0.92, 24),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.activeRing.rotation.x = -Math.PI / 2;
    this.activeRing.position.y = 0.025;
    this.scene.add(this.activeRing);

    this.aimArrow = new THREE.Group();
    this.aimArrowShaft = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.06, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xef4444 }),
    );
    this.aimArrowShaft.position.set(1.2, 0.04, 0);
    this.aimArrow.add(this.aimArrowShaft);
    this.aimArrow.visible = false;
    this.scene.add(this.aimArrow);

    this.penaltyReticle = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.42, 20),
      new THREE.MeshBasicMaterial({ color: 0xfef08a, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }),
    );
    this.penaltyReticle.rotation.y = Math.PI / 2;
    this.penaltyReticle.visible = false;
    this.scene.add(this.penaltyReticle);
  }

  private buildParticles(): void {
    const count = 120;
    const geo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleInstanced = new THREE.InstancedMesh(geo, mat, count);
    this.particleInstanced.frustumCulled = false;

    for (let i = 0; i < count; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -10,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        scale: 0,
        color: new THREE.Color(0xffffff),
      });
      dummyObj.position.set(0, -10, 0);
      dummyObj.scale.set(0, 0, 0);
      dummyObj.updateMatrix();
      this.particleInstanced.setMatrixAt(i, dummyObj.matrix);
      this.particleInstanced.setColorAt(i, tmpColor.setHex(0xffffff));
    }
    this.particleInstanced.instanceMatrix.needsUpdate = true;
    this.scene.add(this.particleInstanced);
  }

  private buildCurveTrail(): void {
    const geo = new THREE.SphereGeometry(PITCH.BALL_RADIUS * 0.92, 16, 12);
    this.curveTrailBallMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: createCurveBallTexture(),
      emissive: 0x7e22ce,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.85,
      roughness: 0.3,
      metalness: 0.08,
    });
    this.curveTrailInstanced = new THREE.InstancedMesh(geo, this.curveTrailBallMat, MAX_CURVE_TRAIL);
    this.curveTrailInstanced.frustumCulled = false;

    for (let i = 0; i < MAX_CURVE_TRAIL; i++) {
      dummyObj.position.set(0, -10, 0);
      dummyObj.scale.set(0, 0, 0);
      dummyObj.updateMatrix();
      this.curveTrailInstanced.setMatrixAt(i, dummyObj.matrix);
    }
    this.curveTrailInstanced.instanceMatrix.needsUpdate = true;
    this.scene.add(this.curveTrailInstanced);
  }

  private buildCornerGuide(): void {
    const dotGeo = new THREE.SphereGeometry(0.16, 8, 8);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.96 });
    this.cornerArcInstanced = new THREE.InstancedMesh(dotGeo, dotMat, MAX_CORNER_ARC_DOTS);
    this.cornerArcInstanced.frustumCulled = false;
    this.cornerArcInstanced.visible = false;
    this.scene.add(this.cornerArcInstanced);

    const arrowConeGeo = new THREE.ConeGeometry(0.42, 0.9, 12);
    arrowConeGeo.rotateZ(-Math.PI / 2);
    const arrowConeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.cornerArcArrowHead = new THREE.Mesh(arrowConeGeo, arrowConeMat);
    this.cornerArcArrowHead.visible = false;
    this.scene.add(this.cornerArcArrowHead);

    const dashGeo = new THREE.BoxGeometry(0.72, 0.12, 0.22);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.98 });
    this.cornerGoalArrowInstanced = new THREE.InstancedMesh(dashGeo, dashMat, MAX_CORNER_GOAL_DASHES);
    this.cornerGoalArrowInstanced.frustumCulled = false;
    this.cornerGoalArrowInstanced.visible = false;
    this.scene.add(this.cornerGoalArrowInstanced);

    this.cornerGoalArrowHead = new THREE.Mesh(arrowConeGeo.clone(), arrowConeMat);
    this.cornerGoalArrowHead.visible = false;
    this.scene.add(this.cornerGoalArrowHead);

    this.cornerTargetRing = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.42, 28),
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
      }),
    );
    this.cornerTargetRing.rotation.x = -Math.PI / 2;
    this.cornerTargetRing.position.y = 0.06;
    this.cornerTargetRing.visible = false;
    this.scene.add(this.cornerTargetRing);
  }

  private spawnParticles(x: number, y: number, z: number, count: number, colorHex: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const slot = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % this.particles.length;
      slot.active = true;
      slot.x = x;
      slot.y = y;
      slot.z = z;
      slot.vx = (Math.random() - 0.5) * speed;
      slot.vy = 2.5 + Math.random() * speed * 0.7;
      slot.vz = (Math.random() - 0.5) * speed;
      slot.life = 0;
      slot.maxLife = 0.4 + Math.random() * 0.45;
      slot.scale = 0.7 + Math.random() * 0.8;
      slot.color.setHex(colorHex);
    }
  }

  public syncFromSimulation(state: MatchState, dt: number): void {
    this.elapsed += dt;

    for (const ev of state.events) {
      if (ev.type === 'postHit') {
        this.trauma = Math.min(1, this.trauma + 0.65);
        this.spawnParticles(ev.x, 1.5, ev.z, 10, 0xfef08a, 8);
      } else if (ev.type === 'netHit') {
        const rig = ev.side === 'right' ? this.rightNet : this.leftNet;
        rig.impulseTime = this.elapsed;
        rig.hitY = ev.y;
        rig.hitZ = ev.z;
        rig.strength = Math.min(1.4, Math.max(0.45, Math.abs(ev.vx) * 0.045));
      } else if (ev.type === 'goal') {
        this.trauma = Math.min(1, this.trauma + 0.85);
        const gx = ev.scoringTeam === 'home' ? PITCH.HALF_LENGTH : -PITCH.HALF_LENGTH;
        this.spawnParticles(gx, 2.2, 0, 26, 0xfacc15, 13);
        this.spawnParticles(gx, 2.2, 0, 18, 0x38bdf8, 12);
      } else if (ev.type === 'tackle') {
        this.spawnParticles(ev.x, 0.15, ev.z, 7, 0x22c55e, 6);
      } else if (ev.type === 'kick' && !ev.isPass) {
        if (ev.isCurveShot) {
          this.trauma = Math.min(1, this.trauma + 0.35);
          this.spawnParticles(ev.x, Math.max(0.3, ev.y), ev.z, 14, 0xfacc15, 8);
          this.spawnParticles(ev.x, Math.max(0.3, ev.y), ev.z, 10, 0x9333ea, 7);
        } else {
          this.spawnParticles(state.ball.x, 0.25, state.ball.z, 6, 0xf8fafc, 5);
        }
      }
    }

    for (const p of state.players) {
      const rig = this.playerRigs.get(p.id);
      if (!rig) continue;
      rig.root.visible = !p.sentOff;
      if (p.sentOff) continue;

      rig.root.position.set(p.x, p.y, p.z);
      rig.root.rotation.set(0, -p.facing, 0);

      const isThrowInTaker = state.phase === 'throw_in_aim' && state.throwIn?.takerId === p.id;
      const speed = Math.hypot(p.vx, p.vz);
      const swing = Math.min(0.85, speed * 0.075) * Math.sin(p.stridePhase);

      if (p.ragdollTimer > 0) {
        const t = 1 - p.ragdollTimer / 0.78;
        rig.bodyPivot.rotation.set(Math.sin(t * Math.PI) * 1.45, t * 5.2, -1.25);
      } else if (p.diveTimer > 0) {
        rig.bodyPivot.rotation.set(p.diveDirZ * 1.32, 0, -0.35);
      } else if (p.slideTimer > 0) {
        rig.bodyPivot.rotation.set(0, 0, 0.88);
      } else if (isThrowInTaker) {
        rig.bodyPivot.rotation.set(0, 0, 0.22);
      } else if (p.jumpTimer > 0) {
        const jumpTilt = Math.sin((p.jumpTimer / 0.42) * Math.PI) * 0.42;
        rig.bodyPivot.rotation.set(0, 0, -jumpTilt);
      } else {
        const liquidBob = Math.sin(this.elapsed * 14 + p.stridePhase) * 0.04;
        rig.bodyPivot.rotation.set(p.leanZ * 1.3 + liquidBob, 0, -p.leanX * 1.3);
      }

      if (isThrowInTaker) {
        // Wide planted stance along touchline + both arms raised holding ball overhead
        rig.leftLeg.rotation.set(0.52, 0, 0);
        rig.rightLeg.rotation.set(-0.52, 0, 0);
        rig.leftArm.rotation.set(0.35, 0, -2.85);
        rig.rightArm.rotation.set(-0.35, 0, -2.85);
      } else {
        rig.leftLeg.rotation.x = 0;
        rig.rightLeg.rotation.x = 0;
        rig.leftArm.rotation.x = 0;
        rig.rightArm.rotation.x = 0;
        if (p.slideTimer > 0) {
          rig.leftLeg.rotation.z = 1.25;
          rig.rightLeg.rotation.z = 0.7;
        } else {
          rig.leftLeg.rotation.z = swing;
          rig.rightLeg.rotation.z = -swing;
        }
        rig.leftArm.rotation.z = -swing * 0.85;
        rig.rightArm.rotation.z = swing * 0.85 + (p.kickAnimTimer > 0 ? 0.5 : 0);
      }
      rig.cardIndicator.visible = p.yellowCards > 0;
    }

    const ref = state.referee;
    this.refRig.root.position.set(ref.x, 0, ref.z);
    this.refRig.root.rotation.set(0, -ref.facing, 0);
    const refSwing = Math.min(0.8, Math.hypot(ref.vx, ref.vz) * 0.07) * Math.sin(ref.stridePhase);
    this.refRig.leftLeg.rotation.z = refSwing;
    this.refRig.rightLeg.rotation.z = -refSwing;
    this.refRig.bodyPivot.rotation.set(ref.leanZ, 0, -ref.leanX);

    if (ref.state === 'booking' && ref.cardToShow) {
      this.refRig.rightArm.rotation.z = 2.8;
      this.refCardMesh.visible = true;
      (this.refCardMesh.material as THREE.MeshBasicMaterial).color.setHex(
        ref.cardToShow === 'red' ? 0xef4444 : 0xfacc15,
      );
    } else {
      this.refRig.rightArm.rotation.z = refSwing * 0.8;
      this.refCardMesh.visible = false;
    }

    // Ball & Curve Shot material swap
    const targetBallMat = state.ball.isCurveShot ? this.curveBallMat : this.normalBallMat;
    if (this.ballMesh.material !== targetBallMat) {
      this.ballMesh.material = targetBallMat;
    }
    this.ballMesh.position.set(state.ball.x, state.ball.y, state.ball.z);
    this.ballMesh.rotation.x += state.ball.spinX * dt;
    this.ballMesh.rotation.z += state.ball.spinZ * dt;
    this.ballMesh.rotation.y += state.ball.spinY * dt;

    this.ballShadow.position.set(state.ball.x, 0.015, state.ball.z);
    const shadowScale = Math.max(0.45, 1 - state.ball.y * 0.08);
    this.ballShadow.scale.set(shadowScale, shadowScale, 1);

    // Update stroboscopic multi-ball curve trail (inspired by reference image)
    this.updateCurveTrail(state);

    const active = state.players.find((p) => p.id === state.activePlayerId);
    if (active && state.mode !== 'attract' && !active.sentOff) {
      this.activeRing.visible = true;
      this.activeRing.position.set(active.x, 0.025, active.z);
      (this.activeRing.material as THREE.MeshBasicMaterial).color.setHex(
        state.referee.state === 'chasing' ? 0xef4444 : 0xfacc15,
      );

      if (state.isChargingShot && state.phase !== 'corner_aim') {
        this.aimArrow.visible = true;
        this.aimArrow.position.set(active.x, 0.04, active.z);
        this.aimArrow.rotation.y = -active.facing;
        const len = 0.6 + state.shotPower * 2.2;
        this.aimArrowShaft.scale.set(len, 1, 1);
        this.aimArrowShaft.position.x = 0.7 + len * 0.5;
      } else {
        this.aimArrow.visible = false;
      }
    } else {
      this.activeRing.visible = false;
      this.aimArrow.visible = false;
    }

    if (state.mode === 'penalty' && state.phase === 'penalty_aim' && state.penalty?.turn === 'home') {
      this.penaltyReticle.visible = true;
      this.penaltyReticle.position.set(
        PITCH.HALF_LENGTH - 0.1,
        0.35 + state.penalty.aimY * (PITCH.GOAL_HEIGHT - 0.3),
        state.penalty.aimX * (PITCH.GOAL_HALF_WIDTH - 0.2),
      );
      const pulse = 1 + (state.penalty.charging ? state.penalty.power * 0.5 : 0);
      this.penaltyReticle.scale.set(pulse, pulse, 1);
    } else {
      this.penaltyReticle.visible = false;
    }

    this.updateCornerGuide(state);
    this.updateNetRipple(this.leftNet);
    this.updateNetRipple(this.rightNet);
    this.updateCrowdAnimation(state.crowdExcitement);
    this.updateParticles(dt);
    this.updateBroadcastCamera(state, dt);
  }

  private updateCornerGuide(state: MatchState): void {
    if (state.phase === 'throw_in_aim' && state.throwIn) {
      const target = state.players.find((p) => p.id === state.throwIn!.targetPlayerId);
      this.cornerGoalArrowInstanced.visible = false;
      this.cornerGoalArrowHead.visible = false;

      if (target && state.throwIn.team === 'home' && state.mode !== 'attract') {
        this.cornerArcInstanced.visible = true;
        this.cornerArcArrowHead.visible = false;
        this.cornerTargetRing.visible = true;

        this.cornerTargetRing.position.set(target.x, 0.06, target.z);
        const pulse = 1 + Math.sin(this.elapsed * 6) * 0.08;
        this.cornerTargetRing.scale.set(pulse, pulse, 1);

        const sx = state.ball.x;
        const sy = state.ball.y;
        const sz = state.ball.z;
        const tx = target.x;
        const tz = target.z;
        const throwDots = 10;
        for (let i = 0; i < MAX_CORNER_ARC_DOTS; i++) {
          if (i < throwDots) {
            const t = 0.14 + (i / (throwDots - 1)) * 0.78;
            const x = sx + (tx - sx) * t;
            const z = sz + (tz - sz) * t;
            const y = sy * (1 - t) + 0.65 * t + Math.sin(t * Math.PI) * 1.1;
            dummyObj.position.set(x, y, z);
            dummyObj.rotation.set(0, 0, 0);
            dummyObj.scale.set(0.42, 0.42, 0.42);
          } else {
            dummyObj.position.set(0, -10, 0);
            dummyObj.scale.set(0, 0, 0);
          }
          dummyObj.updateMatrix();
          this.cornerArcInstanced.setMatrixAt(i, dummyObj.matrix);
        }
        this.cornerArcInstanced.instanceMatrix.needsUpdate = true;
      } else {
        this.cornerArcInstanced.visible = false;
        this.cornerArcArrowHead.visible = false;
        this.cornerTargetRing.visible = false;
      }
      return;
    }

    const corner = state.corner;
    if (state.phase !== 'corner_aim' || !corner) {
      this.cornerArcInstanced.visible = false;
      this.cornerArcArrowHead.visible = false;
      this.cornerGoalArrowInstanced.visible = false;
      this.cornerGoalArrowHead.visible = false;
      this.cornerTargetRing.visible = false;
      return;
    }

    this.cornerArcInstanced.visible = true;
    this.cornerArcArrowHead.visible = true;
    this.cornerGoalArrowInstanced.visible = true;
    this.cornerGoalArrowHead.visible = true;
    this.cornerTargetRing.visible = true;

    this.cornerTargetRing.position.set(corner.targetX, 0.06, corner.targetZ);
    const pulse = 1 + Math.sin(this.elapsed * 6) * 0.08;
    this.cornerTargetRing.scale.set(pulse, pulse, 1);

    const goalSign = corner.cornerX >= 0 ? 1 : -1;
    const goalX = goalSign * PITCH.HALF_LENGTH;
    // Sweeping outward bow into the box before curving back into the 6-yard box (matches reference image)
    const ctrlX = (corner.cornerX + corner.targetX) * 0.5 - goalSign * 9.5;
    const ctrlZ = (corner.cornerZ + corner.targetZ) * 0.5;

    for (let i = 0; i < MAX_CORNER_ARC_DOTS; i++) {
      const t = (i + 0.5) / (MAX_CORNER_ARC_DOTS + 0.6);
      const omt = 1 - t;
      const x = omt * omt * corner.cornerX + 2 * omt * t * ctrlX + t * t * corner.targetX;
      const z = omt * omt * corner.cornerZ + 2 * omt * t * ctrlZ + t * t * corner.targetZ;
      const y = 0.22 + Math.sin(t * Math.PI) * 1.9;
      const s = 0.8 + 0.35 * Math.sin(t * Math.PI);
      dummyObj.position.set(x, y, z);
      dummyObj.rotation.set(0, 0, 0);
      dummyObj.scale.set(s, s, s);
      dummyObj.updateMatrix();
      this.cornerArcInstanced.setMatrixAt(i, dummyObj.matrix);
    }
    this.cornerArcInstanced.instanceMatrix.needsUpdate = true;

    const endTangentX = corner.targetX - ctrlX;
    const endTangentZ = corner.targetZ - ctrlZ;
    this.cornerArcArrowHead.position.set(corner.targetX, 2.35, corner.targetZ);
    this.cornerArcArrowHead.rotation.set(0, -Math.atan2(endTangentZ, endTangentX), 0);

    const arrowEndX = goalX - goalSign * 0.2;
    const arrowEndZ = 0;
    const adx = arrowEndX - corner.targetX;
    const adz = arrowEndZ - corner.targetZ;
    const arrowYaw = -Math.atan2(adz, adx);
    for (let i = 0; i < MAX_CORNER_GOAL_DASHES; i++) {
      const t = (i + 0.45) / (MAX_CORNER_GOAL_DASHES + 0.35);
      const x = corner.targetX + adx * t;
      const z = corner.targetZ + adz * t;
      dummyObj.position.set(x, 2.45, z);
      dummyObj.rotation.set(0, arrowYaw, 0);
      dummyObj.scale.set(1, 1, 1);
      dummyObj.updateMatrix();
      this.cornerGoalArrowInstanced.setMatrixAt(i, dummyObj.matrix);
    }
    this.cornerGoalArrowInstanced.instanceMatrix.needsUpdate = true;
    this.cornerGoalArrowHead.position.set(arrowEndX, 2.45, arrowEndZ);
    this.cornerGoalArrowHead.rotation.set(0, arrowYaw, 0);
  }

  private updateCurveTrail(state: MatchState): void {
    const trail = state.ball.curveTrail;
    const count = Math.min(MAX_CURVE_TRAIL, trail.length);
    const fade = state.ball.isCurveShot ? 1 : Math.min(1, state.ball.curveTrailFade);

    this.curveTrailBallMat.opacity = 0.88 * fade;

    for (let i = 0; i < MAX_CURVE_TRAIL; i++) {
      if (i < count && fade > 0.02) {
        const pt = trail[i];
        const ratio = (i + 1) / count;
        const scale = (0.62 + ratio * 0.48) * (0.45 + 0.55 * fade);
        dummyObj.position.set(pt.x, pt.y, pt.z);
        dummyObj.rotation.set(this.elapsed * 6 + i * 0.4, this.elapsed * 9 + i * 0.6, 0);
        dummyObj.scale.set(scale, scale, scale);
      } else {
        dummyObj.position.set(0, -10, 0);
        dummyObj.scale.set(0, 0, 0);
      }
      dummyObj.updateMatrix();
      this.curveTrailInstanced.setMatrixAt(i, dummyObj.matrix);
    }
    this.curveTrailInstanced.instanceMatrix.needsUpdate = true;
  }

  private updateNetRipple(net: GoalNetRig): void {
    const t = this.elapsed - net.impulseTime;
    const pos = net.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;

    if (t < 0 || t > 1.4 || net.strength <= 0.01) {
      if (t >= 1.4 && t < 1.55) {
        arr.set(net.restPos);
        pos.needsUpdate = true;
      }
      return;
    }

    const decay = Math.exp(-3.2 * t);
    for (let i = 0; i < arr.length; i += 3) {
      const vx = net.restPos[i];
      const vy = net.restPos[i + 1];
      const dist = Math.hypot(vx - net.hitZ, vy - (net.hitY - PITCH.GOAL_HEIGHT / 2));
      const wave = Math.sin(t * 22 - dist * 2.1) * decay * net.strength;
      const falloff = Math.max(0, 1 - dist / 4.2);
      arr[i + 2] = net.restPos[i + 2] + wave * falloff * 0.65;
    }
    pos.needsUpdate = true;
  }

  private updateCrowdAnimation(excitement: number): void {
    const amp = 0.08 + excitement * 0.32;
    const speed = 4.5 + excitement * 8.5;
    for (let i = 0; i < this.crowdBasePositions.length; i++) {
      const base = this.crowdBasePositions[i];
      const hop = Math.abs(Math.sin(this.elapsed * speed + base.phase)) * amp;
      dummyObj.position.set(base.x, base.y + hop, base.z);
      dummyObj.rotation.set(0, 0, Math.sin(this.elapsed * speed + base.phase) * excitement * 0.14);
      dummyObj.scale.set(1, 1, 1);
      dummyObj.updateMatrix();
      this.crowdInstanced.setMatrixAt(i, dummyObj.matrix);
    }
    this.crowdInstanced.instanceMatrix.needsUpdate = true;
  }

  private updateParticles(dt: number): void {
    let anyChanged = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyChanged = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        dummyObj.position.set(0, -10, 0);
        dummyObj.scale.set(0, 0, 0);
        dummyObj.updateMatrix();
        this.particleInstanced.setMatrixAt(i, dummyObj.matrix);
        continue;
      }
      p.vy -= 18 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.08) {
        p.y = 0.08;
        p.vy *= -0.4;
      }
      const s = p.scale * (1 - p.life / p.maxLife);
      dummyObj.position.set(p.x, p.y, p.z);
      dummyObj.rotation.set(p.life * 4, p.life * 4, 0);
      dummyObj.scale.set(s, s, s);
      dummyObj.updateMatrix();
      this.particleInstanced.setMatrixAt(i, dummyObj.matrix);
      this.particleInstanced.setColorAt(i, p.color);
    }
    if (anyChanged) {
      this.particleInstanced.instanceMatrix.needsUpdate = true;
      if (this.particleInstanced.instanceColor) this.particleInstanced.instanceColor.needsUpdate = true;
    }
  }

  private updateBroadcastCamera(state: MatchState, dt: number): void {
    this.trauma = Math.max(0, this.trauma - dt * 1.45);
    const shake = this.trauma * this.trauma;
    const shakeX = (Math.random() * 2 - 1) * shake * 0.65;
    const shakeY = (Math.random() * 2 - 1) * shake * 0.45;

    if (state.mode === 'attract') {
      const t = this.elapsed * 0.22;
      desiredCamPos.set(Math.sin(t) * 14, 24, 26 + Math.cos(t) * 4);
      desiredCamTarget.set(state.ball.x * 0.35, 0, state.ball.z * 0.35);
    } else if (state.mode === 'penalty') {
      desiredCamPos.set(14.5, 6.2, 0);
      desiredCamTarget.set(PITCH.HALF_LENGTH + 1, 1.2, state.ball.z * 0.35);
    } else if (state.phase === 'corner_aim' && state.corner) {
      const goalSign = state.corner.cornerX >= 0 ? 1 : -1;
      const cornerSign = state.corner.cornerZ >= 0 ? 1 : -1;
      desiredCamPos.set(goalSign * 6, 23.5, cornerSign * 30);
      desiredCamTarget.set(goalSign * 28.5, 0.4, cornerSign * 7.5);
    } else if (state.phase === 'throw_in_aim' && state.throwIn) {
      const taker = state.players.find((p) => p.id === state.throwIn!.takerId);
      const target = state.players.find((p) => p.id === state.throwIn!.targetPlayerId);
      const sideSign = state.throwIn.z >= 0 ? 1 : -1;
      const tx = taker ? taker.x : state.throwIn.x;
      const tz = taker ? taker.z : state.throwIn.z;
      const destX = target ? target.x : tx;
      const destZ = target ? target.z : tz - sideSign * 12;
      const dx = destX - tx;
      const dz = destZ - tz;
      const dist = Math.hypot(dx, dz) || 1;
      const ux = dx / dist;
      const uz = dz / dist;
      // Camera positioned behind and slightly left of thrower's shoulder so full wide stance, touchline, overhead ball, and target teammate are clearly framed
      const offX = -ux * 4.4 - uz * 1.4;
      desiredCamPos.set(tx + offX, 1.78, tz + sideSign * 3.55);
      desiredCamTarget.set(
        tx * 0.42 + destX * 0.58,
        1.18,
        tz * 0.42 + destZ * 0.58,
      );
    } else {
      const ballSpeed = Math.hypot(state.ball.vx, state.ball.vz);
      const speedPull = Math.min(3.5, ballSpeed * 0.11);
      const targetX = Math.max(-20, Math.min(20, state.ball.x * 0.66));
      const targetZ = Math.max(-9, Math.min(9, state.ball.z * 0.46)) + 27.5 - speedPull * 0.5;
      const height = 25.5 - speedPull * 0.55;
      desiredCamPos.set(targetX + shakeX, height + shakeY, targetZ);
      desiredCamTarget.set(
        Math.max(-24, Math.min(24, state.ball.x * 0.72)),
        0,
        Math.max(-10, Math.min(10, state.ball.z * 0.45)) - 1.2,
      );
    }

    const lerpRate = state.phase === 'throw_in_aim' ? 9.5 : 5.2;
    const alpha = 1 - Math.exp(-lerpRate * dt);
    this.camera.position.lerp(desiredCamPos, alpha);
    currentCamTarget.lerp(desiredCamTarget, alpha);
    this.camera.lookAt(currentCamTarget);
  }

  public startLoop(onFrame: (dt: number) => void): void {
    this.onFrameCallback = onFrame;
    this.lastTimestamp = performance.now();

    const tick = () => {
      if (this.disposed) return;
      const now = performance.now();
      const rawDt = (now - this.lastTimestamp) / 1000;
      this.lastTimestamp = now;

      if (this.isSoftwareGl) {
        let remaining = Math.min(Math.max(rawDt, 0.04), 0.16);
        while (remaining > 0.001) {
          const step = Math.min(0.04, remaining);
          this.onFrameCallback?.(step);
          remaining -= step;
        }
      } else {
        this.onFrameCallback?.(Math.min(rawDt, 0.05));
      }

      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    tick();
  }

  private afterDraw(next: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      if (sync && gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
        return;
      }
      if (sync) gl.deleteSync(sync);
      this.frameId = window.setTimeout(next, 80);
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  public handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth, 320);
    const height = Math.max(this.container.clientHeight, 240);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

function detectSoftwareWebGL(): boolean {
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) return true;
  const ext = probe.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
  const rendererName = String(probe.getParameter(param));
  probe.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererName);
}

function createPitchTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 640;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#1b7f3a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const stripes = 14;
  const stripeW = canvas.width / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#1d8a3f' : '#249c49';
    ctx.fillRect(i * stripeW, 0, stripeW, canvas.height);
  }

  const padX = (2 / 72) * canvas.width;
  const padY = (2 / 48) * canvas.height;
  const innerW = canvas.width - padX * 2;
  const innerH = canvas.height - padY * 2;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
  ctx.lineWidth = 4;
  ctx.strokeRect(padX, padY, innerW, innerH);

  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, padY);
  ctx.lineTo(canvas.width / 2, padY + innerH);
  ctx.stroke();

  const centerR = (PITCH.CENTER_CIRCLE_RADIUS / 68) * innerW;
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, centerR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, 5, 0, Math.PI * 2);
  ctx.fill();

  const boxW = (PITCH.BOX_DEPTH / 68) * innerW;
  const boxH = ((PITCH.BOX_HALF_WIDTH * 2) / 44) * innerH;
  const sixW = (PITCH.SIX_YARD_DEPTH / 68) * innerW;
  const sixH = ((PITCH.SIX_YARD_HALF_WIDTH * 2) / 44) * innerH;
  const spotOff = (PITCH.PENALTY_SPOT_OFFSET / 68) * innerW;

  ctx.strokeRect(padX, canvas.height / 2 - boxH / 2, boxW, boxH);
  ctx.strokeRect(padX, canvas.height / 2 - sixH / 2, sixW, sixH);
  ctx.beginPath();
  ctx.arc(padX + spotOff, canvas.height / 2, 4.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeRect(padX + innerW - boxW, canvas.height / 2 - boxH / 2, boxW, boxH);
  ctx.strokeRect(padX + innerW - sixW, canvas.height / 2 - sixH / 2, sixW, sixH);
  ctx.beginPath();
  ctx.arc(padX + innerW - spotOff, canvas.height / 2, 4.5, 0, Math.PI * 2);
  ctx.fill();

  const cornerR = 18;
  const corners: Array<[number, number, number, number]> = [
    [padX, padY, 0, Math.PI / 2],
    [padX + innerW, padY, Math.PI / 2, Math.PI],
    [padX + innerW, padY + innerH, Math.PI, Math.PI * 1.5],
    [padX, padY + innerH, Math.PI * 1.5, Math.PI * 2],
  ];
  for (const [cx, cy, sa, ea] of corners) {
    ctx.beginPath();
    ctx.arc(cx, cy, cornerR, sa, ea);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#0f172a';
  const centers: Array<[number, number]> = [
    [32, 32],
    [96, 32],
    [160, 32],
    [224, 32],
    [64, 96],
    [128, 96],
    [192, 96],
  ];
  for (const [cx, cy] of centers) {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const px = cx + Math.cos(a) * 16;
      const py = cy + Math.sin(a) * 16;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCurveBallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  // High-contrast vibrant yellow base with deep purple curved bands (matching reference image)
  ctx.fillStyle = '#facc15';
  ctx.fillRect(0, 0, 256, 128);

  ctx.strokeStyle = '#7e22ce';
  ctx.lineWidth = 14;
  for (let x = -32; x < 288; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 36, 42, x - 36, 86, x + 18, 128);
    ctx.stroke();
  }

  ctx.fillStyle = '#581c87';
  const accents: Array<[number, number]> = [
    [48, 32],
    [128, 32],
    [208, 32],
    [88, 96],
    [168, 96],
  ];
  for (const [cx, cy] of accents) {
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
