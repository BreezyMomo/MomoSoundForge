import type { AppearanceThemeDefinition } from "@momo/workbench/appearance";

// Product identity is data. Components, surfaces and portal rendering remain in Workbench.
export const soundTheme: AppearanceThemeDefinition = {
  id: "soundforge-night",
  labelKey: "appearance.soundforgeNight",
  descriptionKey: "appearance.soundforgeNightDescription",
  mode: "dark",
  accent: "#b49ae8",
  surfaces: {
    bg: "#0c0c10",
    inset: "#101015",
    panel: "#19191f",
    surface: "#23232d",
    hover: "#30303d",
    line: "#3b3b49",
    "line-strong": "#737187",
    text: "#f0eef6",
    muted: "#c3bfce",
    subtle: "#aaa5b8",
  },
  roles: {
    header: "#13131a",
    selection: "#b49ae8",
    navigation: "#bdb0df",
    control: "#91cbd7",
  },
};
