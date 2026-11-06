import type { LayerInit } from "./model";
import { makeLayer, type PlayerInput, type Project } from "./model";
type Preset = {
  id: string;
  category: "interface" | "magic" | "motion";
  duration: number;
  echo: number;
  inputs: LayerInit[];
};
export const PRESETS: Preset[] = [
  {
    id: "ice",
    category: "magic",
    duration: 1.6,
    echo: 0.14,
    inputs: [
      {
        name: "body",
        duration: 0.28,
        gain: 0.95,
        player: {
          wave: "sine",
          frequency: 190,
          endFrequency: 42,
          decay: 5,
        },
      },
      {
        name: "fracture",
        start: 0.025,
        duration: 0.45,
        gain: 0.65,
        player: {
          wave: "noise",
          cutoff: 8000,
          decay: 4,
          drive: 0.8,
        },
      },
      {
        name: "crystal",
        start: 0.04,
        duration: 0.8,
        gain: 0.27,
        pan: -0.25,
        player: {
          wave: "triangle",
          frequency: 3200,
          endFrequency: 1800,
          decay: 3,
        },
      },
      {
        name: "tail",
        start: 0.12,
        duration: 1.2,
        gain: 0.14,
        pan: 0.2,
        player: {
          wave: "noise",
          cutoff: 3400,
          attack: 0.08,
          release: 0.6,
          decay: 3,
        },
      },
    ],
  },
  {
    id: "confirm",
    category: "interface",
    duration: 0.55,
    echo: 0,
    inputs: [
      {
        name: "tone",
        duration: 0.14,
        gain: 0.65,
        player: {
          wave: "sine",
          frequency: 660,
          endFrequency: 660,
          decay: 1,
        },
      },
      {
        name: "spark",
        start: 0.09,
        duration: 0.26,
        gain: 0.6,
        player: {
          wave: "sine",
          frequency: 990,
          endFrequency: 990,
          decay: 2,
        },
      },
    ],
  },
  {
    id: "deny",
    category: "interface",
    duration: 0.5,
    echo: 0,
    inputs: [
      {
        name: "tone",
        duration: 0.24,
        gain: 0.55,
        player: {
          wave: "triangle",
          frequency: 180,
          endFrequency: 95,
          decay: 2,
          cutoff: 1800,
        },
      },
      {
        name: "body",
        start: 0.12,
        duration: 0.2,
        gain: 0.7,
        player: {
          wave: "sine",
          frequency: 90,
          endFrequency: 65,
          decay: 2,
        },
      },
    ],
  },
  {
    id: "pickup",
    category: "interface",
    duration: 0.9,
    echo: 0.18,
    inputs: [
      {
        name: "tone",
        duration: 0.16,
        gain: 0.6,
        player: {
          wave: "sine",
          frequency: 980,
          endFrequency: 1960,
          decay: 1,
        },
      },
      {
        name: "spark",
        start: 0.1,
        duration: 0.42,
        gain: 0.24,
        player: {
          wave: "triangle",
          frequency: 1960,
          endFrequency: 2400,
          decay: 4,
        },
      },
    ],
  },
  {
    id: "laser",
    category: "magic",
    duration: 0.85,
    echo: 0.12,
    inputs: [
      {
        name: "body",
        duration: 0.42,
        gain: 0.5,
        player: {
          wave: "saw",
          frequency: 1800,
          endFrequency: 70,
          cutoff: 4200,
          decay: 3,
          drive: 0.4,
        },
      },
      {
        name: "attack",
        duration: 0.06,
        gain: 0.42,
        player: {
          wave: "noise",
          cutoff: 8500,
          decay: 5,
        },
      },
    ],
  },
  {
    id: "charge",
    category: "magic",
    duration: 2.5,
    echo: 0.12,
    inputs: [
      {
        name: "body",
        duration: 2,
        gain: 0.55,
        player: {
          wave: "triangle",
          frequency: 90,
          endFrequency: 800,
          attack: 1.1,
          release: 0.12,
          decay: 0,
        },
      },
      {
        name: "air",
        duration: 2,
        gain: 0.16,
        player: {
          wave: "noise",
          frequency: 300,
          endFrequency: 300,
          cutoff: 3200,
          attack: 1.6,
          release: 0.12,
          decay: 0,
        },
      },
      {
        name: "spark",
        start: 1.9,
        duration: 0.35,
        gain: 0.6,
        player: {
          wave: "sine",
          frequency: 1400,
          endFrequency: 600,
          decay: 4,
        },
      },
    ],
  },
  {
    id: "whoosh",
    category: "motion",
    duration: 0.85,
    echo: 0,
    inputs: [
      {
        name: "air",
        duration: 0.58,
        gain: 0.6,
        player: {
          wave: "noise",
          attack: 0.19,
          release: 0.3,
          cutoff: 2800,
          decay: 0,
        },
      },
      {
        name: "body",
        start: 0.06,
        duration: 0.46,
        gain: 0.38,
        player: {
          wave: "sine",
          frequency: 220,
          endFrequency: 55,
          attack: 0.15,
          release: 0.22,
          decay: 0,
        },
      },
    ],
  },
  {
    id: "explosion",
    category: "motion",
    duration: 2.3,
    echo: 0.16,
    inputs: [
      {
        name: "attack",
        duration: 0.16,
        gain: 0.7,
        player: {
          wave: "noise",
          cutoff: 9000,
          decay: 5,
          drive: 2,
        },
      },
      {
        name: "body",
        duration: 1,
        gain: 0.9,
        player: {
          wave: "sine",
          frequency: 130,
          endFrequency: 28,
          decay: 5,
          drive: 1,
        },
      },
      {
        name: "debris",
        start: 0.03,
        duration: 1.9,
        gain: 0.6,
        player: {
          wave: "noise",
          cutoff: 1300,
          release: 0.7,
          decay: 4,
        },
      },
    ],
  },
];
export function fromPreset(
  id: string,
  name: string,
  layerName: (key: string) => string,
): Project {
  const p = PRESETS.find((p) => p.id === id) ?? PRESETS[0];
  return {
    schema: "momo.soundforge/v4",
    name,
    seed: 2048,
    duration: p.duration,
    master: 0.8,
    echo: p.echo,
    assets: {},
    inputs: p.inputs.map((l, i) =>
      makeLayer({ ...l, id: `${p.id}-${i}`, name: layerName(l.name!) }),
    ),
  };
}
