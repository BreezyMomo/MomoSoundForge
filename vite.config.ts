import { defineConfig, loadEnv, type ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from 'node:path';
import { normalizeLibraryUrl, distributionDescriptor } from './src/builtinDistribution.mjs';
import { finishDistribution } from './tools/sound-distribution.mjs';
export default defineConfig(({ mode, command }) => {
  const external = normalizeLibraryUrl(loadEnv(mode, process.cwd(), 'VITE_').VITE_SOUND_LIBRARY_URL ?? '');
  let config: ResolvedConfig;
  return {
  // Dev still serves local generation; only production artifacts omit binaries.
  publicDir: external && command === 'build' ? false : 'public',
  plugins: [react(), {
    name: 'sound-library-distribution',
    configResolved(resolved) { config = resolved; },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/sound-library/distribution.json') return next();
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify(distributionDescriptor(external)));
      });
    },
    async writeBundle() { await finishDistribution(config.root, path.resolve(config.root, config.build.outDir), external); },
  }],
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  base: "./",
  };
});
