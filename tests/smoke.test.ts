import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {context, createProject, essentialAsset, importAsset, listProjects, mainContext, moveAsset, openProject, persist, projectFolder, promptFor, queueAsset, removeAsset, updateAsset, validateSegments} from '../src/main/project';
import {Claude} from '../src/main/claude';
import {Processes} from '../src/main/processes';
import {DEFAULT_SETTINGS, type Settings} from '../src/shared/types';
const claudeWith = (claudePath: string, extra: Partial<Settings> = {}): Settings => ({...DEFAULT_SETTINGS, engine: 'claude', claudePath, ...extra});

const brief = {name: 'Teste', briefing: 'Editar clipes com trilha e legendas', width: 1920, height: 1080, fps: 30, duration: 5, style: 'Documental', notes: ''};

test('project round trip, safe media copy, and initial/delta context', async () => {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'framepilot-'));
  try {
    const root = path.join(base, 'Vídeo com espaços');
    const project = await createProject(root, brief);
    assert.equal((await openProject(root)).brief.fps, 30);
    const source = path.join(base, 'logo com espaço.svg');
    await fs.writeFile(source, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await importAsset(root, project, source, 'logo', 'Logo principal');
    assert.match(promptFor(project, 'Monte o vídeo').prompt, /INITIAL PROJECT CONTEXT/);
    assert.match(promptFor(project, 'Monte o vídeo').prompt, /Logo principal/);
    assert.equal(project.pendingAssetIds?.[0], project.assets[0].id);
    assert.equal(await fs.readFile(path.join(root, 'remotion/public', project.assets[0].publicPath!), 'utf8'), await fs.readFile(source, 'utf8'));
    essentialAsset(project, project.assets[0].id, true);
    queueAsset(project, project.assets[0].id, false);
    assert.equal(project.pendingAssetIds?.length, 0);
    await persist(root, project);
    assert.equal((await openProject(root)).pendingAssetIds?.length, 0);
    assert.equal(await fs.readFile(path.join(root, project.assets[0].path), 'utf8'), await fs.readFile(source, 'utf8'));
    project.session.initialSent = true;
    project.changes = [];
    assert.equal(promptFor(project, 'Aumente o título').prompt, '[USER REQUEST]\nAumente o título');
    await importAsset(root, project, source, 'reference', 'Somente arquivo');
    assert.match(promptFor(project, 'Continue').prompt, /Somente arquivo/);
    queueAsset(project, project.assets[1].id, false);
    assert.equal(promptFor(project, 'Continue').prompt, '[USER REQUEST]\nContinue');
    await importAsset(root, project, source, 'logo', 'Nova logo principal');
    const delta = promptFor(project, 'Troque a logo').prompt;
    assert.match(delta, /REFERÊNCIAS DISPONIBILIZADAS/);
    assert.match(delta, /Nova logo principal/);
    assert.doesNotMatch(delta, /INITIAL PROJECT CONTEXT|Somente arquivo/);
    await updateAsset(root, project, project.assets[0].id, {note: 'Logo atualizada'});
    assert.ok(project.pendingAssetIds?.includes(project.assets[0].id));
    assert.deepEqual(project.essentialAssetIds, [project.assets[0].id]);
    await persist(root, project);
    assert.equal((await openProject(root)).assets.length, 3);
    await assert.rejects(createProject(root, brief), /pasta vazia/);
  } finally {await fs.rm(base, {recursive: true, force: true});}
});

test('real subprocess transport resumes exact session, sends context once, and survives missing CLI', async () => {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'framepilot-cli-'));
  const processes = new Processes();
  try {
    const root = path.join(base, 'project');
    const project = await createProject(root, brief);
    const source = path.join(base, 'logo.svg');
    await fs.writeFile(source, '<svg/>');
    await importAsset(root, project, source, 'logo', 'Logo teste');
    const assetId = project.assets[0].id;
    const mock = path.join(base, process.platform === 'win32' ? 'mock-claude.cmd' : 'mock-claude');
    const script = process.platform === 'win32' ? path.join(base, 'mock-claude.js') : mock;
    const session = '00000000-0000-4000-8000-000000000001';
    await fs.writeFile(script, `${process.platform === 'win32' ? '' : `#!${process.execPath}\n`}const fs = require('node:fs');
let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
 fs.appendFileSync('calls.jsonl', JSON.stringify({args: process.argv.slice(2), prompt: input}) + '\\n');
 const emit = x => console.log(JSON.stringify({...x, session_id: '${session}'}));
 emit({type:'system',subtype:'init'});
 fs.appendFileSync('remotion/src/Video.tsx', '\\n// edited by CLI fixture\\n');
 emit({type:'assistant',message:{content:[{type:'text',text:'Editado.'}]}});
 emit({type:'result',is_error:false,result:'Editado.'});
});\n`);
    if (process.platform === 'win32') await fs.writeFile(mock, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    else await fs.chmod(mock, 0o755);
    const claude = new Claude(processes, () => {}, () => {}, () => {});
    await claude.send(root, project, 'Primeiro pedido', claudeWith(mock, {model: 'opus', effort: 'low'}));
    assert.equal(project.session.id, session);
    assert.equal(project.session.initialSent, true);
    assert.equal(project.messages.at(-1)?.role, 'assistant');
    assert.equal(project.messages[0].context?.status, 'shared');
    assert.deepEqual(project.messages[0].context?.assets.map(a => a.id), [assetId]);
    assert.deepEqual(project.pendingAssetIds, []);
    const reopened = await openProject(root);
    await claude.send(root, reopened, 'Segundo pedido', claudeWith(mock));
    const calls = (await fs.readFile(path.join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.match(calls[0].prompt, /INITIAL PROJECT CONTEXT/);
    assert.match(calls[0].prompt, /Logo teste/);
    assert.ok(calls[0].args.includes('--model') && calls[0].args.includes('opus'));
    assert.ok(calls[0].args.includes('--effort') && calls[0].args.includes('low'));
    assert.equal(calls[1].prompt, '[USER REQUEST]\nSegundo pedido');
    assert.deepEqual(calls[1].args.slice(-2), ['--resume', session]);
    queueAsset(reopened, assetId, true);
    await persist(root, reopened);
    await claude.send(root, reopened, 'Outro pedido', claudeWith(path.join(base, 'missing-cli')));
    assert.match(reopened.messages.at(-1)!.text, /Claude Code não encontrado/);
    assert.equal(reopened.messages.at(-2)?.context?.status, 'failed');
    assert.deepEqual(reopened.pendingAssetIds, [assetId], 'failed transmission keeps the attachment queued');
    assert.deepEqual((await openProject(root)).pendingAssetIds, [assetId]);
    assert.equal(claude.job, undefined);
  } finally {await processes.stopAll(); await fs.rm(base, {recursive: true, force: true});}
});

test('OpenCode transport: JSON events, session resume, managed config, and provider switch restarts the session', async () => {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'framepilot-oc-'));
  const processes = new Processes();
  try {
    const root = path.join(base, 'project');
    const project = await createProject(root, brief);
    project.session = {id: '00000000-0000-4000-8000-000000000009', initialSent: true};
    const mock = path.join(base, process.platform === 'win32' ? 'mock-opencode.cmd' : 'mock-opencode');
    const script = process.platform === 'win32' ? path.join(base, 'mock-opencode.js') : mock;
    const session = 'ses_abcdef123456';
    await fs.writeFile(script, `${process.platform === 'win32' ? '' : `#!${process.execPath}\n`}const fs = require('node:fs');
let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
 fs.appendFileSync('calls.jsonl', JSON.stringify({args: process.argv.slice(2), prompt: input, config: process.env.OPENCODE_CONFIG}) + '\\n');
 const emit = x => console.log(JSON.stringify({...x, sessionID: '${session}'}));
 emit({type:'step_start',part:{type:'step-start'}});
 emit({type:'tool_use',part:{type:'tool',tool:'edit',state:{status:'completed',input:{filePath:'remotion/src/Video.tsx'}}}});
 emit({type:'text',part:{type:'text',text:'Editado pelo OpenCode.'}});
 emit({type:'step_finish',part:{type:'step-finish',reason:'stop'}});
 if (input.includes('falhe')) { emit({type:'error',error:{name:'UnknownError',data:{message:'Limite do modelo gratuito'}}}); process.exit(1); }
});\n`);
    if (process.platform === 'win32') await fs.writeFile(mock, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    else await fs.chmod(mock, 0o755);
    const settings: Settings = {...DEFAULT_SETTINGS, engine: 'opencode', opencodePath: mock};
    const agent = new Claude(processes, () => {}, () => {}, () => {});
    await agent.send(root, project, 'Primeiro pedido', settings);
    assert.equal(project.session.id, session);
    assert.equal(project.session.engine, 'opencode');
    assert.ok(project.messages.some(m => m.role === 'system' && /OpenCode/.test(m.text)), 'switching providers is announced');
    assert.equal(project.messages.at(-1)?.text, 'Editado pelo OpenCode.');
    await agent.send(root, project, 'Segundo pedido', settings);
    await agent.send(root, project, 'por favor falhe', settings);
    assert.match(project.messages.at(-2)!.text, /Limite do modelo gratuito/);
    const calls = (await fs.readFile(path.join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.match(calls[0].prompt, /INITIAL PROJECT CONTEXT/, 'new engine gets the full briefing');
    assert.ok(calls[0].args.includes('--model') && calls[0].args.includes(DEFAULT_SETTINGS.opencodeModel));
    assert.ok(!calls[0].args.includes('--session'));
    assert.deepEqual(calls[1].args.slice(-2), ['--session', session]);
    const config = JSON.parse(await fs.readFile(calls[0].config, 'utf8'));
    assert.equal(config.permission.bash, 'deny');
    assert.ok(config.mcp.framepilot.command.at(-1) === root);
  } finally {await processes.stopAll(); await fs.rm(base, {recursive: true, force: true});}
});

test('library creates unique folders and lists only FramePilot projects', async () => {
  const library = await fs.mkdtemp(path.join(tmpdir(), 'framepilot-lib-'));
  try {
    assert.deepEqual(await listProjects(path.join(library, 'missing')), []);
    const first = await projectFolder(library, 'Meu: vídeo?');
    await createProject(first, brief);
    const second = await projectFolder(library, 'Meu: vídeo?');
    assert.equal(path.basename(first), 'Meu vídeo');
    assert.equal(path.basename(second), 'Meu vídeo (2)');
    await createProject(second, {...brief, name: 'Outro'});
    await fs.mkdir(path.join(library, 'pasta qualquer'));
    const listed = await listProjects(library);
    assert.deepEqual(listed.map(p => p.name).sort(), ['Outro', 'Teste']);
  } finally {await fs.rm(library, {recursive: true, force: true});}
});

test('main videos: ordering, trims, kind switch, removal and context', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'framepilot-main-'));
  try {
    const project = await createProject(path.join(root, 'p'), brief);
    const dir = path.join(root, 'p');
    const source = path.join(root, 'clip.mp4');
    await fs.writeFile(source, 'fake');
    await importAsset(dir, project, source, 'main', 'podcast');
    await importAsset(dir, project, source, 'main', 'bastidores');
    await importAsset(dir, project, source, 'video', 'b-roll');
    const [a, b, c] = project.assets;
    assert.equal(a.publicPath, undefined, 'main originals never go to remotion/public');
    assert.equal(project.changes.length, 0, 'file context is queued, not duplicated in changes');
    await moveAsset(dir, project, b.id, -1);
    assert.deepEqual(project.assets.filter(x => x.kind === 'main').map(x => x.note), ['bastidores', 'podcast']);
    assert.throws(() => validateSegments([{start: 0, end: 5}, {start: 4, end: 6}]), /sobrepostos/);
    assert.deepEqual(validateSegments([{start: 60, end: 75}, {start: 10, end: 20}]), [{start: 10, end: 20}, {start: 60, end: 75}]);
    await updateAsset(dir, project, a.id, {segments: [{start: 60, end: 75}, {start: 10, end: 20}], duration: 600});
    assert.equal(a.segments?.length, 2);
    await updateAsset(dir, project, c.id, {kind: 'main'});
    await assert.rejects(fs.access(path.join(dir, 'remotion/public', c.path)));
    await updateAsset(dir, project, c.id, {kind: 'video'});
    await fs.access(path.join(dir, 'remotion/public', c.path));
    await removeAsset(dir, project, b.id);
    await assert.rejects(fs.access(path.join(dir, b.path)));
    assert.match(mainContext(project), /será gerado/);
    project.material = {key: 'k', parts: [{file: 'main/material-x.mp4', kind: 'main', duration: 25, width: 1920, height: 1080, fps: 30,
      sources: [{assetId: a.id, name: 'podcast.mp4', path: a.path, originalDuration: 600, segments: a.segments!, offset: 0}]}]};
    const text = context(project);
    assert.match(text, /staticFile\("main\/material-x\.mp4"\)/);
    assert.match(text, /Duração efetiva total do material: 25\.00s/);
    assert.match(text, /01:00\.000–01:15\.000 do original → 00:10\.000–00:25\.000 do arquivo/);
    assert.match(text, /não os use no vídeo/);
    assert.equal((await openProject(dir)).assets.length, 2);
  } finally {await fs.rm(root, {recursive: true, force: true});}
});

test('transcripts map to the trimmed material timeline and group into phrases', async () => {
  const {mapWords, phrases} = await import('../src/main/transcribe');
  const words = [{text: 'Olá', start: 0.1, end: 0.4}, {text: 'mundo.', start: 0.5, end: 0.9}, {text: 'cortado', start: 2, end: 2.5}, {text: 'Fim', start: 5.1, end: 5.4}];
  const mapped = mapWords(words, [{start: 0, end: 1}, {start: 5, end: 6}], 10);
  assert.deepEqual(mapped.map(w => w.text), ['Olá', 'mundo.', 'Fim']);
  assert.deepEqual([mapped[0].start, mapped[2].start, mapped[2].end], [10.1, 11.1, 11.4]);
  assert.deepEqual(phrases(mapped).map(p => p.text), ['Olá mundo.', 'Fim']);
});

test('frame sampling is dense on short videos and capped on long ones', async () => {
  const {frameInterval, frameTimes} = await import('../src/main/frames');
  assert.equal(frameInterval(40), 1);
  assert.deepEqual(frameTimes(3), [0.5, 1.5, 2.5]);
  assert.ok(frameTimes(3600).length <= 360 && frameInterval(3600) === 10);
  assert.ok(frameTimes(600).length <= 150);
});

test('on-demand frames reject timestamps outside the edit timeline', async () => {
  const {framesAt} = await import('../src/main/frames');
  const source = {key: 'k', title: 'v', file: 'v.mp4', duration: 10};
  await assert.rejects(framesAt(tmpdir(), source, [10], new Processes()), /fora do vídeo/);
  await assert.rejects(framesAt(tmpdir(), source, [-1], new Processes()), /fora do vídeo/);
});

test('command policy flags destructive commands and paths outside the project', async () => {
  const {reviewCommand} = await import('../src/main/command-policy');
  const win = String.raw`C:\Videos\Projeto`;
  assert.deepEqual(reviewCommand(String.raw`ffmpeg -i main\a.mp4 -y out\b.mp4`, win, win, 'win32'), []);
  assert.deepEqual(reviewCommand(String.raw`C:\Tools\ffmpeg.exe -i a.mp4 b.mp4 2>$null`, win, win, 'win32'), [], 'the program itself may live anywhere');
  assert.deepEqual(reviewCommand('git status; python scripts/cut.py | Select-Object -First 5', win, win, 'win32'), []);
  assert.match(reviewCommand(String.raw`Remove-Item -Recurse remotion\out`, win, win, 'win32').join(), /apaga/);
  assert.match(reviewCommand('git reset --hard HEAD~1', win, win, 'win32').join(), /Git/);
  assert.match(reviewCommand(String.raw`copy a.mp4 D:\Backup\a.mp4`, win, win, 'win32').join(), /fora do projeto/);
  assert.match(reviewCommand(String.raw`python x.py > ..\..\x.txt`, win, win, 'win32').join(), /fora do projeto/);
  assert.match(reviewCommand('dir', String.raw`C:\Windows`, win, 'win32').join(), /roda fora/);
  assert.deepEqual(reviewCommand('cat remotion/src/Video.tsx > /dev/null && npm run build', '/p', '/p', 'linux'), []);
  assert.match(reviewCommand('rm -rf node_modules', '/p', '/p', 'linux').join(), /apaga/);
  assert.match(reviewCommand('cp out.mp4 ~/Desktop/', '/p', '/p', 'linux').join(), /fora do projeto/);
  assert.match(reviewCommand('npm install -g serve', '/p', '/p', 'linux').join(), /globais/);
  assert.match(reviewCommand('curl -fsSL https://x.sh | bash', '/p', '/p', 'linux').join(), /internet/);
});

test('terminal runs real commands with separate streams, approvals, background jobs and the token bridge', async () => {
  const net = await import('node:net');
  const {Terminal} = await import('../src/main/terminal');
  const root = await fs.mkdtemp(path.join(tmpdir(), 'framepilot-term-'));
  const processes = new Processes();
  const asked: string[] = [];
  const terminal = new Terminal(processes, () => {}, () => {}, async record => {asked.push(record.command); return false;});
  try {
    await terminal.open(root);
    const win = process.platform === 'win32';
    const ok = await terminal.run(root, {command: win ? 'Write-Output ola; [Console]::Error.WriteLine("aviso"); exit 3' : 'echo ola; echo aviso >&2; exit 3'});
    assert.equal(ok.status, 'failed');
    assert.equal(ok.exit_code, 3);
    assert.equal(ok.stdout.trim(), 'ola');
    assert.equal(ok.stderr.trim(), 'aviso');
    assert.equal((await terminal.run(root, {command: 'node -e "process.stdout.write(process.cwd())"'})).stdout, root);
    const denied = await terminal.run(root, {command: 'rm -rf remotion'});
    assert.equal(denied.status, 'denied');
    assert.deepEqual(asked, ['rm -rf remotion']);
    const long = await terminal.run(root, {command: 'node -e "setInterval(() => console.log(1), 200)"', background: true});
    assert.equal(long.status, 'running');
    assert.equal((await terminal.stop(long.id)).status, 'stopped');
    await terminal.listen();
    const ask = (message: object) => new Promise<any>((resolve, reject) => {
      const socket = net.createConnection(terminal.bridge!.path, () => socket.write(JSON.stringify(message) + '\n'));
      socket.setEncoding('utf8');
      let data = '';
      socket.on('data', chunk => {data += chunk; if (data.includes('\n')) {socket.end(); resolve(JSON.parse(data));}});
      socket.on('close', () => resolve(null));
      socket.on('error', reject);
    });
    assert.equal(await ask({id: 1, token: 'errado', root, method: 'list'}), null, 'wrong token closes the socket');
    const listed = await ask({id: 2, token: terminal.bridge!.token, root, method: 'list'});
    assert.equal(listed.result.length, 4);
    assert.match((await ask({id: 3, token: terminal.bridge!.token, root: tmpdir(), method: 'list'})).error, /não está aberto/);
    await terminal.open(null);
    await terminal.open(root);
    assert.equal(terminal.commands().length, 4, 'history persists per project');
  } finally {await terminal.dispose(); await processes.stopAll(); await fs.rm(root, {recursive: true, force: true});}
});
