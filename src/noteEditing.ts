import { clamp, type Layer } from "./model";
import { beatsToSeconds, secondsToBeats, type NoteEvent } from "./instruments";

export const pitchName = (midi: number) =>
  `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`;

/** Edit in source beats; the clip's stretch, trim and reverse stay independent. */
export function editNote(note: NoteEvent, mode: "move" | "resize", beats: number,
  semitones: number, bpm: number, snap: number): NoteEvent {
  const quantize = (v: number) => snap ? Math.round(v / snap) * snap : Math.round(v * 1000) / 1000;
  const next = mode === "resize"
    ? { ...note, duration: Math.max(0.005, quantize(note.duration + beats)) }
    : { ...note, start: Math.max(0, quantize(note.start + beats)),
        midi: clamp(note.midi + Math.round(semitones), 0, 127) };
  return Number.isFinite(beatsToSeconds(next.start + next.duration, bpm)) && Number.isFinite(next.midi) ? next : note;
}

export function noteGridTicks(totalBeats: number) {
  const step = Math.max(1, Math.ceil(totalBeats / 32));
  return Array.from({ length: Math.min(33, Math.ceil(totalBeats / step)) }, (_, i) => i * step);
}

/** Normalized positions inside the rendered clip, including playback transforms. */
export function noteSpan(layer: Layer, note: NoteEvent) {
  const source = layer.sourceDuration ?? layer.duration;
  const rate = layer.frequency / 440;
  const start = beatsToSeconds(note.start, layer.score!.bpm);
  const end = beatsToSeconds(note.start + note.duration, layer.score!.bpm);
  return {
    start: ((layer.reverse ? source - end : start) - layer.trim) / rate / source,
    width: (end - start) / rate / source,
  };
}

/** Map the shared project clock to the untransformed score and back. */
export function scoreBeatAtTime(layer: Layer, time: number, offset = 0) {
  const source = layer.sourceDuration ?? layer.duration;
  const position = layer.trim + (time - offset - layer.start) * source / layer.duration * (layer.frequency / 440);
  return secondsToBeats(layer.reverse ? source - position : position, layer.score!.bpm);
}
export function scoreTimeAtBeat(layer: Layer, beat: number, offset = 0) {
  const source = layer.sourceDuration ?? layer.duration;
  const position = beatsToSeconds(beat, layer.score!.bpm);
  return offset + layer.start + ((layer.reverse ? source - position : position) - layer.trim) / (layer.frequency / 440) * layer.duration / source;
}
