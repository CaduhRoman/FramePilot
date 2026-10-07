import {existsSync, promises as fs} from 'node:fs';
import path from 'node:path';

// The build copies these resources beside the main bundle, including in packaged apps.
const bundled = path.join(__dirname, 'claude-resources');
const resources = existsSync(bundled) ? bundled : path.resolve(__dirname, '../..');
export const skillReminder = 'Antes de cada pedido de edição de vídeo, leia .claude/skills/video-craft/SKILL.md e .claude/skills/video-craft/craft.md e aplique suas regras. Consulte outras skills locais relevantes. Não reescreva as regras para contorná-las.';

export async function ensureProjectSkills(root: string) {
  async function copyMissing(source: string, target: string): Promise<void> {
    await fs.mkdir(target, {recursive: true});
    for (const entry of await fs.readdir(source, {withFileTypes: true})) {
      const from = path.join(source, entry.name);
      const to = path.join(target, entry.name);
      if (entry.isDirectory()) await copyMissing(from, to);
      else if (entry.isFile()) {
        try {await fs.copyFile(from, to, 1 /* COPYFILE_EXCL: preserve user edits */);}
        catch (error) {if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;}
      }
    }
  }
  await copyMissing(path.join(resources, '.claude/skills'), path.join(root, '.claude/skills'));
  const target = path.join(root, 'CLAUDE.md');
  const instructions = await fs.readFile(path.join(resources, 'CLAUDE.md'), 'utf8');
  try {await fs.writeFile(target, instructions, {flag: 'wx'});}
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await fs.readFile(target, 'utf8');
    if (!existing.includes('<!-- framepilot-video-skills -->')) {
      await fs.appendFile(target, '\n\n' + instructions.slice(instructions.indexOf('<!-- framepilot-video-skills -->')));
    }
  }
}
