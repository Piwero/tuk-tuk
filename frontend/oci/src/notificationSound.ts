/** Audible cue when a Focus run ends, so a backgrounded tab still gets
 * noticed — a background tab keeps ticking (see focusRunContext.tsx) but its
 * UI updates are silent otherwise. Synthesized via Web Audio rather than a
 * shipped asset: no license/asset-pipeline concerns, and it's a couple of
 * short tones either way.
 */
import type { FocusPhase } from "./focusRun";

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") {
    return null;
  }
  // Safari (still, as of writing) only exposes the webkit-prefixed name.
  const ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  return ctor ?? null;
}

function playTones(frequencies: number[]): void {
  const Ctor = getAudioContextCtor();
  if (Ctor === null) {
    return;
  }
  try {
    const ctx = new Ctor();
    const toneMs = 150;
    const gapMs = 60;
    frequencies.forEach((frequency, index) => {
      const startAt = ctx.currentTime + (index * (toneMs + gapMs)) / 1000;
      const endAt = startAt + toneMs / 1000;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.2, startAt);
      gain.gain.exponentialRampToValueAtTime(0.001, endAt);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(startAt);
      oscillator.stop(endAt);
    });
    const totalMs = frequencies.length * (toneMs + gapMs);
    setTimeout(() => void ctx.close(), totalMs + 100);
  } catch {
    // Autoplay restrictions or an unsupported environment: staying silent
    // beats throwing out of a timer-completion path.
  }
}

// A focus session ending gets a brighter two-note rise; a break ending gets
// a single, calmer tone — distinguishable without looking at the screen.
const FOCUS_END_TONES = [880, 1108.73];
const BREAK_END_TONES = [660];

export function playFocusRunEndSound(phase: FocusPhase): void {
  playTones(phase === "break" ? BREAK_END_TONES : FOCUS_END_TONES);
}
