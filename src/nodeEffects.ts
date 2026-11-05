import { DEFAULT_EFFECTS, type Effects } from "./advanced";
// Finite tail and allocation bounds also apply to imported projects.
export const MAX_EFFECT_TAIL = 4;
export const MAX_RENDER_SECONDS = 40;
export function effectTail(e?: Effects) {
  if (!e) return 0;
  let seconds = 0;
  if (e.delayEnabled !== false && e.delayWet > 0) {
    const repeats =
      e.delayFeedback > 0
        ? Math.ceil(
            Math.log(0.0001 / Math.max(0.0001, e.delayWet)) /
              Math.log(e.delayFeedback),
          )
        : 0;
    seconds += e.delayTime * (1 + Math.max(0, repeats));
  }
  if (e.spaceEnabled !== false && e.reverb > 0)
    seconds +=
      0.0437 *
      Math.ceil(Math.log(0.0001 / Math.max(0.0001, e.reverb)) / Math.log(0.72));
  if (e.toneEnabled !== false && (e.low || e.mid || e.high)) seconds += 0.015;
  return Math.min(MAX_EFFECT_TAIL, seconds);
}
export const bypassEffects = (effects?: Effects): Effects => ({
  ...DEFAULT_EFFECTS,
  ...effects,
  toneEnabled: false,
  delayEnabled: false,
  spaceEnabled: false,
});
