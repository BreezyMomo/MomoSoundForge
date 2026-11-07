import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

// Validate the actual deployment folder, including resources loaded on demand.
const root = path.resolve("dist");
const html = await readFile(path.join(root, "index.html"), "utf8");
for (const match of html.matchAll(/(?:src|href)="(\.\/[^"?#]+)"/g)) {
  await stat(path.resolve(root, match[1]));
}
const catalog = JSON.parse(await readFile("src/data/builtin-catalog.json", "utf8"));
for (const sound of [...catalog.sounds, ...catalog.recordings]) {
  const bytes = await readFile(path.join(root, "sound-library", sound.file));
  if (bytes.length !== sound.compressedBytes ||
      createHash("sha256").update(bytes).digest("hex") !== sound.sha256) {
    throw Error(`Missing or corrupt deployed sound: ${sound.id}`);
  }
}
for (const file of ["vsco-cc0.txt", "kenney-cc0.txt", "sources.json"]) {
  await stat(path.join(root, "sound-library/licenses", file));
}
const assets = await readdir(path.join(root, "assets"));
if (!assets.some(file => file.startsWith("render.worker-") && file.endsWith(".js")) ||
    !assets.some(file => file.endsWith(".wasm"))) {
  throw Error("Missing audio worker or WebAssembly encoder");
}
async function size(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error(`Deployment contains a symlink: ${file}`);
    total += entry.isDirectory() ? await size(file) : (await stat(file)).size;
  }
  return total;
}
const bytes = await size(root);
if (bytes >= 1_000_000_000) throw Error("Website exceeds the GitHub Pages 1 GB limit");
console.log(`Static site verified: ${catalog.sounds.length} sounds, ${(bytes / 1048576).toFixed(1)} MiB`);
