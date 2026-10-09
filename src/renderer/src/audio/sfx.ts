// Tiny synthesized sound effects (no audio assets to ship or license).

export type Sfx = 'click' | 'flip' | 'correct' | 'neutral' | 'opponent' | 'assassin' | 'clue' | 'turn' | 'win' | 'lose' | 'error';

let ctx: AudioContext | null = null;
let volume = 0.7;
let muted = false;

export function configureSfx(v: number, m: boolean): void {
  volume = Math.max(0, Math.min(1, v));
  muted = m;
}

function audio(): AudioContext | null {
  if (muted || volume <= 0) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.2, slideTo?: number): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain * volume, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(start: number, dur: number, gain = 0.12, freq = 1800): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const buffer = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(freq, t0);
  filter.frequency.exponentialRampToValueAtTime(freq * 3, t0 + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(gain * volume, t0);
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t0);
}

export function play(s: Sfx): void {
  switch (s) {
    case 'click':
      tone(880, 0, 0.05, 'triangle', 0.08);
      break;
    case 'flip':
      noise(0, 0.18, 0.1, 1200);
      break;
    case 'correct':
      tone(660, 0.05, 0.14, 'triangle', 0.18);
      tone(990, 0.15, 0.22, 'triangle', 0.16);
      break;
    case 'neutral':
      tone(330, 0.05, 0.25, 'sine', 0.14, 300);
      break;
    case 'opponent':
      tone(440, 0.05, 0.16, 'sawtooth', 0.07);
      tone(311, 0.18, 0.3, 'sawtooth', 0.07);
      break;
    case 'assassin':
      tone(110, 0.02, 0.9, 'sawtooth', 0.22, 40);
      tone(116, 0.02, 0.9, 'square', 0.08, 45);
      noise(0, 0.6, 0.2, 300);
      break;
    case 'clue':
      tone(784, 0, 0.12, 'sine', 0.14);
      tone(1175, 0.08, 0.25, 'sine', 0.1);
      break;
    case 'turn':
      noise(0, 0.25, 0.05, 600);
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.35, 'triangle', 0.16));
      break;
    case 'lose':
      [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.14, 0.4, 'sine', 0.14));
      break;
    case 'error':
      tone(220, 0, 0.18, 'square', 0.06);
      break;
  }
}
