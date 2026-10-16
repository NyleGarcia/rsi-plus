/**
 * The party-mode ding, synthesised with WebAudio (two short sine notes, quick decay) so there's no sound file to
 * ship. Runs wherever a window exists: the offscreen document on Chromium (MV3 service workers have no audio), the
 * background page itself on Firefox (MV2).
 */
let ctx: AudioContext | null = null;

export function playDing() {
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
