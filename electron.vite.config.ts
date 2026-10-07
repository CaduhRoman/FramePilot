import {defineConfig, externalizeDepsPlugin} from 'electron-vite';
import {cp, mkdir} from 'node:fs/promises';
import path from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {plugins: [externalizeDepsPlugin(), {
    name: 'bundle-claude-skills',
    async closeBundle() {
      const destination = path.join(__dirname, 'out/main/claude-resources');
      await mkdir(destination, {recursive: true});
      await cp(path.join(__dirname, '.claude/skills'), path.join(destination, '.claude/skills'), {recursive: true});
      await cp(path.join(__dirname, 'CLAUDE.md'), path.join(destination, 'CLAUDE.md'));
    }
  }]},
  preload: {plugins: [externalizeDepsPlugin()]},
  renderer: {plugins: [react()]}
});
