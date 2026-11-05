// Factory clip defaults only: the embedded recording is never cropped or scaled.
// Analyze each channel separately so a quiet left channel cannot hide the right.
export function instrumentPlaybackRange(
  channels: readonly Float32Array[],
  sampleRate: number,
  instrument: string,
) {
  const length = channels[0].length;
  const originalDuration = length / sampleRate;
  const maximumDuration = Math.min(10, Math.max(.1, originalDuration));
  const windowFrames = Math.max(1, Math.round(sampleRate * .02));
  const envelope: number[] = [];
  let peak = 0, peakIndex = 0;
  for (let start = 0; start < length; start += windowFrames) {
    const end = Math.min(length, start + windowFrames);
    let rms = 0;
    for (const channel of channels) {
      let squares = 0;
      for (let i = start; i < end; i++) squares += channel[i] * channel[i];
      rms = Math.max(rms, Math.sqrt(squares / (end - start)));
    }
    envelope.push(rms);
    if (rms > peak) { peak = rms; peakIndex = envelope.length - 1; }
  }
  if (peak === 0) return { duration: .1, release: .08 };

  const step = windowFrames / sampleRate;
  const padding = .18;
  let end = originalDuration;
  if (instrument === "upright-piano") {
    // Piano recordings can include pedal/room noise long after the note decays.
    // Estimate that bed robustly; exclude the terminal recording fade. Limit the
    // gate to 12 dB below the attack even for particularly noisy recordings.
    const sorted = envelope.slice(peakIndex + 1, -5).sort((a, b) => a - b);
    const tail = envelope.slice(Math.max(peakIndex + 1, envelope.length - 55), -5).sort((a, b) => a - b);
    const noise = Math.max(sorted[Math.floor(sorted.length * .15)] ?? 0, tail[Math.floor(tail.length / 2)] ?? 0);
    const threshold = Math.max(peak * 10 ** (-42 / 20), Math.min(noise * 10 ** (9 / 20), peak * 10 ** (-12 / 20)));
    let quiet = 0;
    // Require 400 ms of continuous quiet so beating/resonance briefly dipping
    // below the gate does not end a note. Later isolated recording clicks stay out.
    for (let i = Math.max(peakIndex + 1, Math.ceil(.12 / step)); i < envelope.length; i++) {
      quiet = envelope[i] < threshold ? quiet + 1 : 0;
      if (quiet * step >= .4) { end = (i - quiet + 1) * step + padding; break; }
    }
  } else {
    // Keep all audible activity, including long sustains and ringing percussion.
    // A relative threshold also preserves very quiet takes without normalization.
    const threshold = peak * 10 ** (-45 / 20);
    for (let i = envelope.length - 1; i >= 0; i--) {
      if (envelope[i] >= threshold) { end = (i + 1) * step + padding; break; }
    }
  }
  const duration = Math.min(maximumDuration, Math.max(.1, Math.ceil(end * sampleRate) / sampleRate));
  return { duration, release: duration < maximumDuration ? Math.min(padding, duration / 2) : .08 };
}
