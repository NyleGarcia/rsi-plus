/**
 * Offscreen document (MV3 service workers have no audio): plays the party-mode ding on request.
 * Synthesised with WebAudio — two short sine notes with a quick decay — so there's no sound file to ship.
 */
import { OFFSCREEN_DING } from '@/lib/sound';

let ctx: AudioContext | null = null;

function ding() {
  ctx ??= new AudioContext();
  const t0 = ctx.currentTime;
  const notes: [number, number][] = [
    [880, 0], // A5
    [1318.5, 0.12], // E6
  ];
  for (const [freq, at] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.5);
  }
}

browser.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg?.type === OFFSCREEN_DING) ding();
});
