import {defineConfig, externalizeDepsPlugin} from 'electron-vite';
import {cp, mkdir} from 'node:fs/promises';
import path from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // frame-tool is the MCP server Claude Code starts to request frames on demand.
  main: {build: {rollupOptions: {input: {index: 'src/main/index.ts', 'frame-tool': 'src/main/frame-tool.ts'}, output: {chunkFileNames: '[name]-[hash].js'}}}, plugins: [externalizeDepsPlugin(), {
    name: 'bundle-claude-skills',
    async closeBundle() {
      await mkdir(path.join(__dirname, 'out/main'), {recursive: true});
      await cp(path.join(__dirname, 'favicon.png'), path.join(__dirname, 'out/main/favicon.png'));
      const destination = path.join(__dirname, 'out/main/claude-resources');
      await mkdir(destination, {recursive: true});
      await cp(path.join(__dirname, '.claude/skills'), path.join(destination, '.claude/skills'), {recursive: true});
      await cp(path.join(__dirname, 'CLAUDE.md'), path.join(destination, 'CLAUDE.md'));
    }
  }]},
  preload: {plugins: [externalizeDepsPlugin()]},
  renderer: {plugins: [react()]}
});
