export const SOUND_CATEGORIES = ["footsteps", "mechanisms", "keys", "strings", "woodwinds", "brass", "percussion", "music", "interface", "magic", "motion", "impacts", "foley", "liquid", "uncategorized"] as const;
export type SoundCategory = (typeof SOUND_CATEGORIES)[number];
export type LibraryPreferences = {
  layoutVersion: 2;
  favorites: string[];
  recent: string[];
  filter: "all" | "favorites" | "recent";
  view: "list" | "grid";
};
export const LIBRARY_PREFERENCES_KEY = "momo-sound-forge-library";
export function parseLibraryPreferences(value: unknown): LibraryPreferences {
  const p = (value && typeof value === "object" ? value : {}) as Partial<LibraryPreferences>;
  const ids = (v: unknown, limit: number) => Array.isArray(v)
    ? [...new Set(v.filter((id): id is string => typeof id === "string" && id.length < 200))].slice(0, limit) : [];
  return { layoutVersion: 2, favorites: ids(p.favorites, 10000), recent: ids(p.recent, 24),
    filter: p.filter === "favorites" || p.filter === "recent" ? p.filter : "all",
    view: p.layoutVersion === 2 && p.view === "list" ? "list" : "grid" };
}
export function rememberSound(recent: string[], id: string) {
  return [id, ...recent.filter((item) => item !== id)].slice(0, 24);
}
