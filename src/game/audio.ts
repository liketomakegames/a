class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private crowdGain: GainNode | null = null;
  private crowdStarted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (!this.crowdStarted && this.ctx) {
      this.initCrowdAmbience(this.ctx);
    }
    return this.ctx;
  }

  private initCrowdAmbience(ctx: AudioContext): void {
    this.crowdStarted = true;
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.04 * white) / 1.04;
      data[i] = last * 2.5;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.65;

    const gain = ctx.createGain();
    gain.gain.value = 0.015;
    this.crowdGain = gain;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  }

  public unlock(): void {
    this.ensureContext();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.crowdGain && this.ctx) {
      this.crowdGain.gain.setTargetAtTime(muted ? 0 : 0.018, this.ctx.currentTime, 0.08);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setCrowdExcitement(excitement: number): void {
    if (!this.crowdGain || !this.ctx || this.muted) return;
    const level = 0.012 + Math.max(0, Math.min(1, excitement)) * 0.085;
    this.crowdGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.14);
  }

  public playKick(power = 0.6, isPass = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isPass ? 'triangle' : 'sine';
    const startFreq = isPass ? 165 : 135 + power * 45;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.11);

    gain.gain.setValueAtTime(0.18 + power * 0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  public playCurveKick(power = 0.7): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // Crisp booted strike
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = 'triangle';
    thump.frequency.setValueAtTime(195 + power * 55, now);
    thump.frequency.exponentialRampToValueAtTime(42, now + 0.14);
    thumpGain.gain.setValueAtTime(0.24 + power * 0.14, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    thump.connect(thumpGain);
    thumpGain.connect(ctx.destination);
    thump.start(now);
    thump.stop(now + 0.16);

    // Whipping spin whoosh
    const noiseLen = Math.floor(ctx.sampleRate * 0.42);
    const buffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.Q.value = 3.2;
    bandpass.frequency.setValueAtTime(650, now);
    bandpass.frequency.exponentialRampToValueAtTime(2200, now + 0.24);
    bandpass.frequency.exponentialRampToValueAtTime(900, now + 0.4);

    const whooshGain = ctx.createGain();
    whooshGain.gain.setValueAtTime(0.01, now);
    whooshGain.gain.linearRampToValueAtTime(0.18, now + 0.08);
    whooshGain.gain.exponentialRampToValueAtTime(0.001, now + 0.41);

    noise.connect(bandpass);
    bandpass.connect(whooshGain);
    whooshGain.connect(ctx.destination);
    noise.start(now);
  }

  public playPostHit(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(540, now);
    osc1.frequency.exponentialRampToValueAtTime(480, now + 0.35);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1090, now);
    osc2.frequency.exponentialRampToValueAtTime(980, now + 0.25);

    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.4);
    osc2.stop(now + 0.4);
  }

  public playWhistle(kind: 'kickoff' | 'foul' | 'fulltime' = 'foul'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const triggerBlast = (offset: number, duration: number) => {
      const carrier = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const gain = ctx.createGain();

      carrier.type = 'sine';
      carrier.frequency.setValueAtTime(2850, now + offset);
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(42, now + offset);
      lfoGain.gain.setValueAtTime(140, now + offset);

      lfo.connect(lfoGain);
      lfoGain.connect(carrier.frequency);

      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.linearRampToValueAtTime(0.14, now + offset + 0.02);
      gain.gain.setValueAtTime(0.14, now + offset + duration - 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + duration);

      carrier.connect(gain);
      gain.connect(ctx.destination);
      carrier.start(now + offset);
      lfo.start(now + offset);
      carrier.stop(now + offset + duration + 0.02);
      lfo.stop(now + offset + duration + 0.02);
    };

    if (kind === 'fulltime') {
      triggerBlast(0, 0.22);
      triggerBlast(0.32, 0.22);
      triggerBlast(0.64, 0.45);
    } else if (kind === 'foul') {
      triggerBlast(0, 0.38);
    } else {
      triggerBlast(0, 0.28);
    }
  }

  public playNetSwoosh(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * 0.26);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(600, now + 0.25);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
  }

  public playTackle(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * 0.18);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
  }

  public playGoalCelebration(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [261.63, 329.63, 392.0, 523.25];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.08, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.42);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.44);
    });
    this.setCrowdExcitement(1);
  }

  public playCardSting(card: 'yellow' | 'red'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(card === 'red' ? 190 : 320, now);
    osc.frequency.setValueAtTime(card === 'red' ? 140 : 280, now + 0.12);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }
}

export const soundEngine = new SoundEngine();
