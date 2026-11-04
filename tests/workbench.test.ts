import { describe, it, expect } from "vitest";
import { validateCatalogs } from "@momo/workbench/i18n";
import { config, catalogs } from "../src/i18n";
describe("shared workbench integration", () => {
  it("provides matching Chinese and English catalogs without translating document data", () => {
    expect(validateCatalogs({ config, catalogs }).languages).toEqual([
      "zh-CN",
      "en",
    ]);
    const keys = Object.keys(catalogs["zh-CN"]);
    expect(keys.sort()).toEqual(Object.keys(catalogs.en).sort());
    expect(keys.length).toBeGreaterThan(150);
  });
});
