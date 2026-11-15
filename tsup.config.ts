import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm', 'iife'],
  globalName: 'artplayerPluginSmartBuffer',
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'es2020',
  external: ['artplayer', 'hls.js'],
});
