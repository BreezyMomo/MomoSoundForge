import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  // Sound libraries are external self-describing packages. The app bundle
  // contains only the editor, protocol and portable project functionality.
  publicDir: 'public',
  plugins: [react()],
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  base: "./",
});
