import { build } from 'esbuild';
import { copyFileSync, cpSync, mkdirSync } from 'node:fs';

mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
await build({ entryPoints: ['ui.js'], bundle: true, minify: true, platform: 'browser', format: 'iife', target: 'es2022', outfile: 'dist/ui.js' });
await build({ entryPoints: ['cli.js'], bundle: true, minify: true, platform: 'node', format: 'esm', target: 'node24', outfile: 'dist/cli.mjs', external: ['@deepseek-ai/*'] });
copyFileSync(new URL('../src/panel.html', import.meta.url), new URL('./dist/panel.html', import.meta.url));
cpSync(new URL('../templates/', import.meta.url), new URL('./templates/', import.meta.url), { recursive: true });
copyFileSync(new URL('../LICENSE', import.meta.url), new URL('./LICENSE', import.meta.url));
