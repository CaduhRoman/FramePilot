import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createProject, importAsset, openProject, persist, promptFor} from '../src/main/project';
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
