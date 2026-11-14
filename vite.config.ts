import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // The app loads this address during `mygo dev` (devUrl in mygo.json).
    port: 5173,
    strictPort: true,
    // The development app and the packaged builds are not the page's.
    watch: { ignored: ["**/.mygo/**", "**/build/**"] },
  },
  // CodeMirror loads a grammar on first use. Discovered that late, Vite
  // re-optimizes and answers the old module URL with 504 "Outdated Optimize
  // Dep"; a failed module URL stays failed for the page's life, so the file
  // went plain until a reload. Pre-bundling the grammars this app maps keeps
  // the first Go or Java file from invalidating the others.
  optimizeDeps: {
    include: [
      "@codemirror/lang-cpp",
      "@codemirror/lang-css",
      "@codemirror/lang-go",
      "@codemirror/lang-html",
      "@codemirror/lang-java",
      "@codemirror/lang-javascript",
      "@codemirror/lang-json",
      "@codemirror/lang-markdown",
      "@codemirror/lang-php",
      "@codemirror/lang-python",
      "@codemirror/lang-rust",
      "@codemirror/lang-sass",
      "@codemirror/lang-sql",
      "@codemirror/lang-yaml",
      "@codemirror/legacy-modes/mode/clike",
      "@codemirror/legacy-modes/mode/dockerfile",
      "@codemirror/legacy-modes/mode/ruby",
      "@codemirror/legacy-modes/mode/shell",
      "@codemirror/legacy-modes/mode/swift",
      "@codemirror/legacy-modes/mode/toml",
    ],
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
