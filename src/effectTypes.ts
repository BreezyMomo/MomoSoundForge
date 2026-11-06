export type EffectGroup = "toneEnabled" | "delayEnabled" | "spaceEnabled";
export type EffectParameter =
  | "low"
  | "mid"
  | "high"
  | "delayTime"
  | "delayFeedback"
  | "delayWet"
  | "reverb"
  | "ceiling";
export type Effects = Partial<Record<EffectGroup, boolean>> & {
  low: number;
  mid: number;
  high: number;
  delayTime: number;
  delayFeedback: number;
  delayWet: number;
  reverb: number;
  ceiling: number;
};
export const DEFAULT_EFFECTS: Effects = {
  low: 0,
  mid: 0,
  high: 0,
  delayTime: 0.18,
  delayFeedback: 0.25,
  delayWet: 0,
  reverb: 0,
  ceiling: -0.18,
};
