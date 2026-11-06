import type { PlayerInput, Player, Project } from "./model";
import { effectTail } from "./nodeEffects";

export const mixTail = (mix: Project) => effectTail(mix.effects) +
  (mix.echo > 0 ? 0.135 * Math.ceil(Math.log(0.0001) / Math.log(mix.echo)) : 0);

/** Finite output contract, including this player's own effects. */
export function playerDuration(player: Player): number {
  const body = player.type === "composition" && player.mix
    ? Math.max(player.mix.duration, ...player.mix.inputs.map(input => input.start + input.duration)) + mixTail(player.mix)
    : player.duration;
  return body + effectTail(player.effects);
}

/** Time is relative to this use, never shared with another instance. */
export function sourceTime(input: PlayerInput, time: number): number | null {
  if (time < 0 || time >= input.duration) return null;
  const width = input.sourceEnd - input.sourceStart;
  if (!(width > 0) || !(input.speed > 0)) return null;
  let offset = time * input.speed;
  if (input.loop) {
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(offset)) * 8;
    offset %= width;
    if (width - offset <= tolerance || offset <= tolerance) offset = 0;
  }
  else if (offset >= width) return null;
  return input.reverse ? input.sourceEnd - offset : input.sourceStart + offset;
}

export function hasReadOverflow(input: PlayerInput): boolean {
  return input.sourceEnd > playerDuration(input.player) + 1e-6;
}

/** Explicit user action. Retain speed, placement and loop occupation; never time-stretch implicitly. */
export function fitPlayerRange(input: PlayerInput): PlayerInput {
  const end = playerDuration(input.player);
  const start = input.sourceStart < end ? input.sourceStart : 0;
  const sourceEnd = Math.min(input.sourceEnd, end);
  return { ...input, sourceStart: start, sourceEnd,
    duration: input.loop ? input.duration : Math.max(0.01, (sourceEnd - start) / input.speed) };
}

export function resetPlayerRange(input: PlayerInput): PlayerInput {
  const sourceEnd = playerDuration(input.player);
  return { ...input, sourceStart: 0, sourceEnd,
    duration: input.loop ? input.duration : sourceEnd / input.speed };
}

/** A transformed group is edited on its own source timeline, not a misleading flattened row. */
export function hasTimeTransform(input: PlayerInput): boolean {
  return input.loop || input.reverse || input.speed !== 1 || input.sourceStart !== 0 ||
    Math.abs(input.sourceEnd - playerDuration(input.player)) > 1e-6 ||
    Math.abs(input.duration - input.sourceEnd) > 1e-6;
}

export function timeAtPath(root: Project, path: readonly string[], time: number): number | null {
  let mix = root;
  for (const id of path) {
    const input = mix.inputs.find(input => input.id === id);
    if (!input?.player.mix) return null;
    const local = sourceTime(input, time - input.start);
    if (local === null) return null;
    time = local;
    mix = input.player.mix;
  }
  return time;
}

/** Seeking chooses the current loop iteration when possible. */
export function timeFromPath(root: Project, path: readonly string[], local: number, anchor = 0): number {
  const chain: { input: PlayerInput; anchor: number }[] = [];
  let mix = root;
  for (const id of path) {
    const input = mix.inputs.find(input => input.id === id);
    if (!input?.player.mix) return anchor;
    chain.push({ input, anchor });
    anchor = sourceTime(input, anchor - input.start) ?? 0;
    mix = input.player.mix;
  }
  for (const { input, anchor: parentAnchor } of chain.reverse()) {
    const width = input.sourceEnd - input.sourceStart;
    const cycle = input.loop ? Math.max(0, Math.floor(((parentAnchor - input.start) * input.speed + 1e-10) / width)) : 0;
    const offset = input.reverse ? input.sourceEnd - local : local - input.sourceStart;
    local = input.start + Math.max(0, Math.min(input.duration, (offset + cycle * width) / input.speed));
  }
  return local;
}
