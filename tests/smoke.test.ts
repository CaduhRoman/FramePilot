import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {context, createProject, importAsset, listProjects, mainContext, moveAsset, openProject, persist, projectFolder, promptFor, removeAsset, updateAsset, validateSegments} from '../src/main/project';
import {Claude} from '../src/main/claude';
import {Processes} from '../src/main/processes';

const brief = {name: 'Teste', briefing: 'Editar clipes com trilha e legendas', width: 1920, height: 1080, fps: 30, duration: 5, style: 'Documental', notes: ''};

test('project round trip, safe media copy, and initial/delta context', async () => {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'framepilot-'));
  try {
    const root = path.join(base, 'Vídeo com espaços');
    const project = await createProject(root, brief);
    assert.equal((await openProject(root)).brief.fps, 30);
    const source = path.join(base, 'logo com espaço.svg');
    await fs.writeFile(source, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await importAsset(root, project, source, 'logo', 'Logo principal', true);
    assert.match(promptFor(project, 'Monte o vídeo').prompt, /INITIAL PROJECT CONTEXT/);
    assert.match(promptFor(project, 'Monte o vídeo').prompt, /Logo principal/);
    assert.equal(await fs.readFile(path.join(root, 'remotion/public', project.assets[0].publicPath!), 'utf8'), await fs.readFile(source, 'utf8'));
    project.session.initialSent = true;
    project.changes = [];
    assert.equal(promptFor(project, 'Aumente o título').prompt, '[USER REQUEST]\nAumente o título');
    await importAsset(root, project, source, 'reference', 'Somente arquivo', false);
    assert.equal(promptFor(project, 'Continue').prompt, '[USER REQUEST]\nContinue');
    await importAsset(root, project, source, 'logo', 'Nova logo principal', true);
    const delta = promptFor(project, 'Troque a logo').prompt;
    assert.match(delta, /NEW PROJECT CONTEXT/);
    assert.match(delta, /Nova logo principal/);
    assert.doesNotMatch(delta, /INITIAL PROJECT CONTEXT|Somente arquivo/);
    await persist(root, project);
    assert.equal((await openProject(root)).assets.length, 3);
    await assert.rejects(createProject(root, brief), /pasta vazia/);
  } finally {await fs.rm(base, {recursive: true, force: true});}
});

test('real subprocess transport resumes exact session, sends context once, and survives missing CLI', async () => {
  if (process.platform === 'win32') return; // executable fixture below uses a POSIX shebang
  const base = await fs.mkdtemp(path.join(tmpdir(), 'framepilot-cli-'));
  const processes = new Processes();
  try {
    const root = path.join(base, 'project');
    const project = await createProject(root, brief);
    const mock = path.join(base, 'mock-claude');
    const session = '00000000-0000-4000-8000-000000000001';
    await fs.writeFile(mock, `#!${process.execPath}\nconst fs = require('node:fs');
let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
 fs.appendFileSync('calls.jsonl', JSON.stringify({args: process.argv.slice(2), prompt: input}) + '\\n');
 const emit = x => console.log(JSON.stringify({...x, session_id: '${session}'}));
 emit({type:'system',subtype:'init'});
 fs.appendFileSync('remotion/src/Video.tsx', '\\n// edited by CLI fixture\\n');
 emit({type:'assistant',message:{content:[{type:'text',text:'Editado.'}]}});
 emit({type:'result',is_error:false,result:'Editado.'});
});\n`);
    await fs.chmod(mock, 0o755);
    const claude = new Claude(processes, () => {}, () => {}, () => {});
    await claude.send(root, project, 'Primeiro pedido', mock);
    assert.equal(project.session.id, session);
    assert.equal(project.session.initialSent, true);
    assert.equal(project.messages.at(-1)?.role, 'assistant');
    const reopened = await openProject(root);
    await claude.send(root, reopened, 'Segundo pedido', mock);
    const calls = (await fs.readFile(path.join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.match(calls[0].prompt, /INITIAL PROJECT CONTEXT/);
    assert.equal(calls[1].prompt, '[USER REQUEST]\nSegundo pedido');
    assert.deepEqual(calls[1].args.slice(-2), ['--resume', session]);
    await claude.send(root, reopened, 'Outro pedido', path.join(base, 'missing-cli'));
    assert.match(reopened.messages.at(-1)!.text, /Claude Code não encontrado/);
    assert.equal(claude.job, undefined);
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
    await importAsset(dir, project, source, 'main', 'podcast', true);
    await importAsset(dir, project, source, 'main', 'bastidores', true);
    await importAsset(dir, project, source, 'video', 'b-roll', true);
    const [a, b, c] = project.assets;
    assert.equal(a.publicPath, undefined, 'main originals never go to remotion/public');
    assert.equal(project.changes.length, 1, 'main imports are announced by the material step');
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
