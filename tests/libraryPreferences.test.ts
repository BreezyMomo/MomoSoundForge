import { expect, it } from "vitest";
import { parseLibraryPreferences, rememberSound } from "../src/libraryPreferences";

it("recovers invalid preferences and keeps preset and saved identities separate", () => {
  expect(parseLibraryPreferences(null)).toEqual({ layoutVersion: 2, favorites: [], recent: [], filter: "all", view: "grid" });
  expect(parseLibraryPreferences({ favorites: [null, 3, "preset-ice", "preset-ice", "library-ice"], recent: {}, filter: "unknown", view: "bad" })).toEqual({ layoutVersion: 2, favorites: ["preset-ice", "library-ice"], recent: [], filter: "all", view: "grid" });
});
it("moves reused sounds to the front and retains only the latest 24", () => {
  const items = Array.from({ length: 24 }, (_, i) => `library-${i}`);
  expect(rememberSound(items, "library-10")).toEqual(["library-10", ...items.filter(id => id !== "library-10")]);
  expect(rememberSound(items, "preset-ice")).toEqual(["preset-ice", ...items.slice(0, 23)]);
});

it("migrates the old default list to grid while preserving subsequent explicit choices", () => {
  expect(parseLibraryPreferences({view: "list", favorites: ["preset-ice"]})).toMatchObject({view: "grid", favorites: ["preset-ice"]});
  expect(parseLibraryPreferences({layoutVersion: 2, view: "list"}).view).toBe("list");
});
