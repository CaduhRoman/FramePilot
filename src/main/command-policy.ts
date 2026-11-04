import path from 'node:path';

// Heuristic review of agent commands. Anything it flags needs explicit approval in the main process;
// it cannot see inside scripts (python x.py), so those run within the project directory by default.
const DESTRUCTIVE: [RegExp, string][] = [
  [/(^|[\s;&|(])(rm|rmdir|rd|del|erase|unlink|shred|truncate)(?=\s|$)/i, 'apaga arquivos ou pastas'],
  [/\b(remove-item|clear-content|clear-recyclebin)\b|(^|[\s;&|(])ri(?=\s)/i, 'apaga arquivos ou conteúdo'],
  [/(^|[\s;&|(])find\b.*\s-delete\b/i, 'apaga arquivos encontrados'],
  [/\bgit\s+(reset\s+--hard|clean\b|checkout\s+(--\s|\.)|restore\b|stash\s+(drop|clear)|branch\s+-D\b|rebase\b|filter-branch\b|push\b.*(\s--force\b|\s-f\b|\s--delete\b|\s:))/i, 'descarta ou reescreve histórico/alterações do Git'],
  [/\b(format|mkfs(\.\w+)?|diskpart|fdisk|parted|dd)(?=\s|$)/i, 'altera discos ou partições'],
  [/\b(shutdown|reboot|halt|poweroff|stop-computer|restart-computer)\b/i, 'desliga ou reinicia o sistema'],
  [/\b(sudo|runas|su|doas|start-process\b.*-verb\s+runas)(?=\s|$)/i, 'pede privilégios elevados'],
  [/\b(taskkill|kill|pkill|killall|stop-process|tskill)(?=\s|$)/i, 'encerra processos do sistema'],
  [/\b(chmod|chown|chgrp|icacls|takeown|cacls|set-acl)(?=\s|$)/i, 'altera permissões de arquivos'],
  [/\b(reg(\.exe)?\s+(add|delete|import)|set-itemproperty|new-itemproperty|remove-itemproperty|regedit)\b/i, 'altera o registro do sistema'],
  [/\b(setx|set-executionpolicy|bcdedit|sc(\.exe)?\s+(delete|config|create)|systemctl|launchctl|crontab|schtasks)\b/i, 'altera configurações ou serviços do sistema'],
  [/\b(npm|pnpm|yarn)\s+(publish|unpublish)\b/i, 'publica pacotes'],
  [/\b(npm|pnpm)\s+(i|install|add|uninstall|remove|rm|un|update|link)\b[^|;&]*(\s-g\b|\s--global\b)|\byarn\s+global\b/i, 'altera pacotes globais'],
  [/\bpip3?\s+uninstall\b|\b(apt|apt-get|dnf|yum|pacman|brew|choco|winget|scoop)\s+(remove|uninstall|purge|install)\b/i, 'instala ou remove software do sistema'],
  [/\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^;&]*\|\s*(sh|bash|zsh|iex|invoke-expression|python3?|node)\b/i, 'executa script baixado da internet'],
  [/\b(invoke-expression|iex)\b/i, 'executa código dinâmico'],
];
const NULL_DEVICES = new Set(['/dev/null', 'nul', '$null', '/dev/stdout', '/dev/stderr']);

const inside = (root: string, target: string, p: path.PlatformPath = path) => {
  const relative = p.relative(p.resolve(root), p.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !p.isAbsolute(relative));
};

/** Splits a shell line into words, marking where each command starts (after |, ;, &&, ||, parentheses). */
function words(command: string) {
  const out: {text: string; first: boolean}[] = [];
  let first = true;
  for (const match of command.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\|\||&&|[|;&()\n])|([^\s|;&()"']+)/g)) {
    if (match[3]) {first = true; continue;}
    const text = match[1] ?? match[2] ?? match[4] ?? '';
    out.push({text, first});
    first = false;
  }
  return out;
}

/** Returns the reasons a command needs explicit approval; empty means it can run inside the project. */
export function reviewCommand(command: string, cwd: string, root: string, platform: NodeJS.Platform = process.platform): string[] {
  const reasons = new Set<string>();
  const windows = platform === 'win32';
  const p = windows ? path.win32 : path.posix;
  if (!inside(root, cwd, p)) reasons.add(`roda fora do projeto (${cwd})`);
  for (const [pattern, reason] of DESTRUCTIVE) if (pattern.test(command)) reasons.add(reason);
  for (const word of words(command)) {
    // The program itself may live anywhere (python, ffmpeg); its arguments and redirections may not.
    if (word.first) continue;
    for (const raw of [word.text, ...word.text.split('=').slice(1)]) {
      const value = raw.replace(/^[0-9]?>>?|^</, '');
      if (!value || NULL_DEVICES.has(value.toLowerCase())) continue;
      if (/^(~|\$home\b|\$env:|%[a-z_]+%|\$\{?[a-z_]+)/i.test(value)) {reasons.add(`usa caminho fora do projeto (${value})`); continue;}
      const absolute = windows ? /^([a-z]:[\\/]|\\\\)/i.test(value) : value.startsWith('/');
      if (absolute ? !inside(root, value, p) : (/(^|[\\/])\.\.([\\/]|$)/.test(value) && !inside(root, p.resolve(cwd, value), p))) {
        reasons.add(`usa caminho fora do projeto (${value})`);
      }
    }
  }
  return [...reasons];
}
