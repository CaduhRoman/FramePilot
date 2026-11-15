import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  applyBrandKeys, brandCandidates, brandContext, brandId, createBrand, kitDir, listBrands, mirror, projectKit,
  publicKit, putBrandAsset, readKit, removeBrandAsset, resolveKit, snapshotBrand, syncProjectBrand, updateBrand, validateKit
} from '../src/main/brand';
import {createProject, listProjects, moveProject, openProject, persist, projectFolder, promptFor} from '../src/main/project';
import type {BrandKit, Project} from '../src/shared/types';

const brief = {name: 'Reels JA', briefing: 'Reels da marca', width: 1080, height: 1920, fps: 30, duration: 10, style: '', notes: ''};
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';

async function library() {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'framepilot-brand-'));
  return {base, library: path.join(base, 'FramePilot')};
}
/** Lê o kit como os componentes Remotion o veem: brand-kit.json gerado dentro do projeto. */
const readGenerated = async (root: string) =>
  JSON.parse(await fs.readFile(path.join(root, 'remotion/src/brand-kit.json'), 'utf8'));

test('brand id, validation and defaults', () => {
  assert.equal(brandId('JA'), 'ja');
  assert.equal(brandId('Julia Almeida'), 'julia-almeida');
  assert.equal(brandId('Animação Café'), 'animacao-cafe');
  assert.equal(brandId('***'), '', 'um nome sem letras nem números não vira marca');
  // Campos inválidos caem para o padrão em vez de derrubar a leitura do kit.
  const kit = validateKit({name: 'JA', version: -3, colors: {primary: 'javascript:alert(1)'},
    fonts: {heading: {family: 'Inter', weight: '700'}, '': {family: 'x'}},
    assets: {logo: {file: 'assets/logo.svg', label: 'Logo'}, bad: {file: '../../fora.svg', label: 'Escapa'},
      absoluto: {file: '/etc/passwd', label: 'Escapa'}, 'MAIÚSCULA': {file: 'assets/x.png', label: 'Chave inválida'}}}, 'ja');
  assert.equal(kit.version, 1);
  assert.equal(kit.colors.primary, '#f5f5f5', 'cor inválida cai para o padrão');
  assert.deepEqual(Object.keys(kit.fonts), ['heading']);
  assert.deepEqual(Object.keys(kit.assets), ['logo'], 'travessia de caminho e chave inválida são descartadas');
  assert.equal(kit.assets.logo.kind, 'image');
  assert.ok(kit.templates.length, 'a marca sempre oferece ao menos um template');
});

test('resolvedor de assets: chave estável, prefixo público e asset local do projeto', () => {
  const kit = validateKit({name: 'JA', version: 2, colors: {primary: '#00ff88'},
    fonts: {heading: {family: 'Inter', weight: '700', asset: 'font-heading'}, body: {family: 'Arial'}},
    assets: {logo: {file: 'assets/logo.svg', label: 'Logo principal'},
      'music-main': {file: 'assets/trilha.mp3', label: 'Trilha padrão'},
      'font-heading': {file: 'fonts/font-heading.woff2', label: 'Fonte de título'}}}, 'ja');
  const published = publicKit(kit);
  // Todo `file` já é um caminho válido para staticFile() dentro do projeto.
  assert.equal(published.assets.logo.file, 'brand/assets/logo.svg');
  assert.equal(published.assets['music-main'].file, 'brand/assets/trilha.mp3');
  assert.equal(published.fonts.heading.file, 'brand/fonts/font-heading.woff2', 'a fonte carrega pelo asset referenciado');
  assert.equal(published.fonts.body.file, undefined, 'fonte do sistema não ganha arquivo');
  assert.equal(published.locked, false);

  // Override local: a chave continua sendo brand:logo, mas aponta para um arquivo do próprio projeto.
  const overridden = publicKit(resolveKit(kit, {assets: {logo: {file: 'assets/ab12-logo-natal.png', label: 'Logo de Natal', kind: 'image', local: true}}}));
  assert.equal(overridden.assets.logo.file, 'assets/ab12-logo-natal.png', 'asset local não recebe o prefixo da marca');
  assert.equal(overridden.assets['music-main'].file, 'brand/assets/trilha.mp3', 'o resto do kit é herdado, não copiado');
});

test('herança e override de tokens, fontes e defaults', () => {
  const kit = validateKit({name: 'JA', version: 1, colors: {primary: '#00ff88', secondary: '#111111'},
    fonts: {heading: {family: 'Inter', weight: '700'}}, defaults: {width: 1080, height: 1920, fps: 30, durationInSeconds: 30},
    assets: {logo: {file: 'assets/logo.svg', label: 'Logo'}}}, 'ja');
  const resolved = resolveKit(kit, {colors: {primary: '#ff0066'}, fonts: {heading: {weight: '900'}},
    defaults: {durationInSeconds: 15}});
  assert.equal(resolved.colors.primary, '#ff0066', 'o projeto sobrescreve pontualmente');
  assert.equal(resolved.colors.secondary, '#111111', 'o que não foi sobrescrito continua herdado');
  assert.equal(resolved.fonts.heading.family, 'Inter', 'override parcial de fonte preserva a família');
  assert.equal(resolved.fonts.heading.weight, '900');
  assert.equal(resolved.defaults.durationInSeconds, 15);
  assert.equal(resolved.defaults.width, 1080);
  assert.equal(kit.colors.primary, '#00ff88', 'o kit da marca não é mutado pelo override do projeto');
  assert.deepEqual(resolveKit(kit, undefined), kit, 'sem overrides, o projeto usa o kit da marca tal e qual');
  // Overrides perigosos são ignorados em vez de aplicados.
  assert.equal(resolveKit(kit, {assets: {logo: {file: '../../../fora.svg', label: 'x', kind: 'image'}}}).assets.logo.file, 'assets/logo.svg');
});

test('criar marca, trocar a logo pela chave e manter a versão subindo', async () => {
  const {base, library: lib} = await library();
  try {
    const brand = await createBrand(lib, {name: 'JA', colors: {primary: '#00ff88'}});
    assert.equal(brand.kit.id, 'ja');
    assert.equal(brand.kit.version, 1);
    assert.match(brand.guide, /guia da marca/i);
    // O CLAUDE.md da pasta da marca é o que o Claude Code lê das pastas pai.
    const instructions = await fs.readFile(path.join(lib, 'ja/CLAUDE.md'), 'utf8');
    assert.match(instructions, /@brand\/BRAND\.md/);
    assert.match(instructions, /NUNCA escreva o caminho do arquivo/);

    const first = path.join(base, 'logo-antiga.svg');
    await fs.writeFile(first, SVG);
    let kit = await putBrandAsset(lib, 'ja', 'logo', 'Logo principal', first);
    assert.equal(kit.version, 2, 'adicionar asset incrementa a versão do kit');
    assert.equal(kit.assets.logo.file, 'assets/logo.svg', 'o arquivo no disco é nomeado pela chave');
    assert.match(await fs.readFile(path.join(kitDir(lib, 'ja'), 'assets/logo.svg'), 'utf8'), /^<svg/);

    // Substituir por outra extensão mantém a chave e remove o arquivo antigo.
    const second = path.join(base, 'logo-nova.png');
    await fs.writeFile(second, Buffer.from('89504e470d0a1a0a', 'hex'));
    kit = await putBrandAsset(lib, 'ja', 'logo', 'Logo principal', second);
    assert.equal(kit.version, 3);
    assert.equal(kit.assets.logo.file, 'assets/logo.png');
    await assert.rejects(fs.access(path.join(kitDir(lib, 'ja'), 'assets/logo.svg')), 'o arquivo substituído é apagado');
    assert.deepEqual(Object.keys(kit.assets), ['logo'], 'a chave é a mesma: nenhum projeto precisa ser editado');

    kit = await updateBrand(lib, 'ja', {colors: {primary: '#ff0066'}, guide: '# JA\nTom direto.'});
    assert.equal(kit.colors.primary, '#ff0066');
    assert.equal(kit.version, 4);
    assert.equal((await listBrands(lib))[0].guide, '# JA\nTom direto.');

    await assert.rejects(putBrandAsset(lib, 'ja', 'Logo Maiúscula', 'x', second), /Chave inválida/);
    await assert.rejects(createBrand(lib, {name: 'JA'}), /Já existe uma pasta/);
    kit = await removeBrandAsset(lib, 'ja', 'logo');
    assert.deepEqual(Object.keys(kit.assets), []);
    assert.equal(kit.version, 5);
  } finally {await fs.rm(base, {recursive: true, force: true});}
});

test('projeto de marca: kit espelhado, brand.tsx gerado e contexto para a IA', async () => {
  const {base, library: lib} = await library();
  try {
    await createBrand(lib, {name: 'JA', colors: {primary: '#00ff88'}});
    const logo = path.join(base, 'logo.svg');
    await fs.writeFile(logo, SVG);
    await putBrandAsset(lib, 'ja', 'logo', 'Logo principal', logo);
    // Um componente reutilizável da marca deve chegar ao projeto.
    await fs.writeFile(path.join(kitDir(lib, 'ja'), 'components/Intro.tsx'), 'export const Intro = () => null;\n');

    const root = await projectFolder(lib, brief.name, 'ja');
    assert.equal(path.basename(path.dirname(root)), 'ja', 'o projeto nasce dentro da pasta da marca');
    const project = await createProject(root, brief, 'ja');
    assert.equal(project.brand?.id, 'ja');

    // Resolvedor: o projeto referencia a logo por chave e o arquivo está onde staticFile() procura.
    const generated = await readGenerated(root);
    assert.equal(generated.assets.logo.file, 'brand/assets/logo.svg');
    assert.match(await fs.readFile(path.join(root, 'remotion/public/brand/assets/logo.svg'), 'utf8'), /^<svg/);
    assert.match(await fs.readFile(path.join(root, 'remotion/src/brand.tsx'), 'utf8'), /export function resolveAsset/);
    assert.match(await fs.readFile(path.join(root, 'remotion/src/brand.tsx'), 'utf8'), /delayRender/, 'as fontes seguram o render até carregarem');
    assert.equal(await fs.readFile(path.join(root, 'remotion/src/brand-components/Intro.tsx'), 'utf8'), 'export const Intro = () => null;\n');
    // A composição inicial já usa a marca por chave e token, não caminho e hex.
    const video = await fs.readFile(path.join(root, 'remotion/src/Video.tsx'), 'utf8');
    assert.match(video, /tryAsset\('brand:logo'\)/);
    assert.match(video, /colors\.background/);
    assert.doesNotMatch(video, /#[0-9a-f]{6}/i, 'nenhum hex hardcoded no projeto de marca');

    // Contexto da IA: identidade, chaves disponíveis e a proibição de hardcodar.
    const prompt = promptFor(project, 'coloca a logo no canto e usa a cor principal', root).prompt;
    assert.match(prompt, /\[MARCA\]/);
    assert.match(prompt, /brand:logo — Logo principal/);
    assert.match(prompt, /Nunca escreva hex nem nome de fonte/);
    assert.match(await fs.readFile(path.join(root, 'CONTEXT.md'), 'utf8'), /## Marca/);

    // Trocar a logo na marca chega ao projeto sem editar o projeto.
    const nova = path.join(base, 'logo2.svg');
    await fs.writeFile(nova, '<svg xmlns="http://www.w3.org/2000/svg" id="nova"/>');
    await putBrandAsset(lib, 'ja', 'logo', 'Logo principal', nova);
    await syncProjectBrand(root, project);
    assert.match(await fs.readFile(path.join(root, 'remotion/public/brand/assets/logo.svg'), 'utf8'), /id="nova"/);
    assert.equal((await readGenerated(root)).assets.logo.file, 'brand/assets/logo.svg', 'a chave e o caminho público não mudam');
  } finally {await fs.rm(base, {recursive: true, force: true});}
});

test('snapshot congela a marca no export e "atualizar" volta para a marca ao vivo', async () => {
  const {base, library: lib} = await library();
  try {
    await createBrand(lib, {name: 'JA'});
    const antiga = path.join(base, 'antiga.svg');
    await fs.writeFile(antiga, '<svg xmlns="http://www.w3.org/2000/svg" id="antiga"/>');
    await putBrandAsset(lib, 'ja', 'logo', 'Logo', antiga);
    const root = await projectFolder(lib, brief.name, 'ja');
    const project = await createProject(root, brief, 'ja');

    // Export: grava a versão usada e um snapshot do kit.
    const version = await snapshotBrand(root, project);
    assert.equal(version, 2);
    assert.equal(project.brand?.lock?.version, 2);
    assert.match(await fs.readFile(path.join(root, '.brand-snapshot/assets/logo.svg'), 'utf8'), /id="antiga"/);

    // A marca muda depois do export.
    const nova = path.join(base, 'nova.svg');
    await fs.writeFile(nova, '<svg xmlns="http://www.w3.org/2000/svg" id="nova"/>');
    const live = await putBrandAsset(lib, 'ja', 'logo', 'Logo', nova);
    assert.equal(live.version, 3);

    // Re-renderizar o projeto travado continua usando a logo antiga.
    await syncProjectBrand(root, project);
    assert.match(await fs.readFile(path.join(root, 'remotion/public/brand/assets/logo.svg'), 'utf8'), /id="antiga"/);
    assert.equal((await readGenerated(root)).version, 2);
    assert.equal((await readGenerated(root)).locked, true);
    assert.equal((await projectKit(root, project))?.kit.version, 3, 'a marca ao vivo segue em frente');

    // "Atualizar para a marca atual": solta o lock e o projeto volta a acompanhar a marca.
    project.brand = {id: 'ja'};
    await fs.rm(path.join(root, '.brand-snapshot'), {recursive: true, force: true});
    await syncProjectBrand(root, project);
    assert.match(await fs.readFile(path.join(root, 'remotion/public/brand/assets/logo.svg'), 'utf8'), /id="nova"/);
    assert.equal((await readGenerated(root)).version, 3);
    assert.equal((await readGenerated(root)).locked, false);
  } finally {await fs.rm(base, {recursive: true, force: true});}
});

test('biblioteca em dois níveis: marcas, avulsos e mover projeto', async () => {
  const {base, library: lib} = await library();
  try {
    await createBrand(lib, {name: 'JA'});
    await createBrand(lib, {name: 'Julia'});
    const brandRoot = await projectFolder(lib, 'Reels JA', 'ja');
    await createProject(brandRoot, brief, 'ja');
    // Projeto avulso: continua na raiz da biblioteca, exatamente como antes das marcas.
    const looseRoot = await projectFolder(lib, 'Animação Café');
    const loose = await createProject(looseRoot, {...brief, name: 'Animação Café'});
    assert.equal(path.dirname(looseRoot), lib);
    assert.equal(loose.brand, undefined);
    await assert.rejects(fs.access(path.join(looseRoot, 'remotion/src/brand.tsx')), 'projeto avulso não recebe módulo de marca');
    assert.doesNotMatch(promptFor(loose, 'Edita', looseRoot).prompt, /\[MARCA\]/);

    let listed = await listProjects(lib);
    assert.equal(listed.length, 2);
    assert.equal(listed.find(p => p.name === 'Reels JA')?.brandId, 'ja');
    assert.equal(listed.find(p => p.name === 'Animação Café')?.brandId, undefined, 'avulso não ganha marca');
    assert.deepEqual((await listBrands(lib)).map(b => b.kit.id), ['ja', 'julia']);

    // Mover o avulso para a JA: herda a marca sem perder nada.
    const moved = await moveProject(lib, looseRoot, 'ja');
    assert.equal(path.basename(path.dirname(moved)), 'ja');
    const reopened = await openProject(moved);
    assert.equal(reopened.brand?.id, 'ja');
    assert.equal(reopened.brief.name, 'Animação Café');
    assert.match(await fs.readFile(path.join(moved, 'remotion/src/brand.tsx'), 'utf8'), /useBrand/);
    listed = await listProjects(lib);
    assert.equal(listed.filter(p => p.brandId === 'ja').length, 2);

    // Mover de volta para Avulsos limpa o que a marca havia deixado.
    const back = await moveProject(lib, moved, '');
    assert.equal(path.dirname(back), lib);
    assert.equal((await openProject(back)).brand, undefined);
    await assert.rejects(fs.access(path.join(back, 'remotion/src/brand.tsx')));
    await assert.rejects(fs.access(path.join(back, 'remotion/public/brand')));

    // Mover sem destino válido não mexe no disco.
    await assert.rejects(moveProject(lib, back, 'inexistente'));
    assert.equal((await listProjects(lib)).length, 2);
  } finally {await fs.rm(base, {recursive: true, force: true});}
});

test('mirror sincroniza, não recopia o que está igual e remove o que sobrou', async () => {
  const {base} = await library();
  try {
    const source = path.join(base, 'src');
    const dest = path.join(base, 'dest');
    await fs.mkdir(path.join(source, 'nested'), {recursive: true});
    await fs.writeFile(path.join(source, 'a.txt'), 'a');
    await fs.writeFile(path.join(source, 'nested/b.txt'), 'b');
    assert.equal(await mirror(source, dest), true);
    assert.equal(await fs.readFile(path.join(dest, 'nested/b.txt'), 'utf8'), 'b');

    // Arquivo que só existe no destino (resto de uma versão anterior da marca) é removido.
    await fs.writeFile(path.join(dest, 'sobra.txt'), 'x');
    await fs.writeFile(path.join(source, 'a.txt'), 'a2');
    await mirror(source, dest);
    assert.equal(await fs.readFile(path.join(dest, 'a.txt'), 'utf8'), 'a2');
    await assert.rejects(fs.access(path.join(dest, 'sobra.txt')));
    assert.equal(await mirror(path.join(base, 'nao-existe'), dest), false);
  } finally {await fs.rm(base, {recursive: true, force: true});}
});

test('sugestão de troca para brand:<chave> só com confirmação', async () => {
  const {base, library: lib} = await library();
  try {
    await createBrand(lib, {name: 'JA'});
    const logo = path.join(base, 'logo.svg');
    await fs.writeFile(logo, SVG);
    const kit = await putBrandAsset(lib, 'ja', 'logo', 'Logo', logo);
    const root = await projectFolder(lib, 'Reels JA', 'ja');
    const project = await createProject(root, brief, 'ja');
    const file = path.join(root, 'remotion/src/Cena.tsx');
    await fs.writeFile(file, ["import {Img, staticFile} from 'remotion';",
      "export const Cena = () => <Img src={staticFile('assets/ab12-logo.png')} />;",
      "export const Outra = () => <Img src={staticFile('assets/ab12-foto-cafe.jpg')} />;"].join('\n') + '\n');

    const candidates = await brandCandidates(root, kit);
    assert.equal(candidates.length, 1, 'só sugere quando o nome do arquivo aponta claramente para a chave');
    assert.equal(candidates[0].key, 'logo');
    assert.equal(candidates[0].file, 'remotion/src/Cena.tsx');

    // Nada é aplicado sem o arquivo ser confirmado.
    assert.equal(await applyBrandKeys(root, kit, []), 0);
    assert.match(await fs.readFile(file, 'utf8'), /staticFile\('assets\/ab12-logo\.png'\)/);

    assert.equal(await applyBrandKeys(root, kit, [candidates[0].file]), 1);
    const applied = await fs.readFile(file, 'utf8');
    assert.match(applied, /resolveAsset\('brand:logo'\)/);
    assert.match(applied, /import \{resolveAsset\} from '\.\/brand'/);
    assert.match(applied, /staticFile\('assets\/ab12-foto-cafe\.jpg'\)/, 'o asset que não é da marca fica como está');
    assert.ok(project.brand);
  } finally {await fs.rm(base, {recursive: true, force: true});}
});

test('marca ilegível não impede abrir o projeto', async () => {
  const {base, library: lib} = await library();
  try {
    await createBrand(lib, {name: 'JA'});
    const root = await projectFolder(lib, 'Reels JA', 'ja');
    await createProject(root, brief, 'ja');
    await fs.writeFile(path.join(kitDir(lib, 'ja'), 'brand.json'), '{ isto não é json');
    const project = await openProject(root);
    assert.equal(project.brand?.id, 'ja', 'o vínculo continua registrado');
    assert.doesNotMatch(promptFor(project, 'Edita', root).prompt, /\[MARCA\]/, 'sem kit legível, nada de contexto inventado');
    assert.equal(await projectKit(root, project), null);
  } finally {await fs.rm(base, {recursive: true, force: true});}
});

test('snapshot apagado à mão cai para a marca ao vivo em vez de deixar o projeto sem kit', async () => {
  const {base, library: lib} = await library();
  try {
    await createBrand(lib, {name: 'JA'});
    const logo = path.join(base, 'logo.svg');
    await fs.writeFile(logo, SVG);
    await putBrandAsset(lib, 'ja', 'logo', 'Logo', logo);
    const root = await projectFolder(lib, 'Reels JA', 'ja');
    const project = await createProject(root, brief, 'ja');
    await snapshotBrand(root, project);
    await fs.rm(path.join(root, '.brand-snapshot'), {recursive: true, force: true});
    const kit = await syncProjectBrand(root, project);
    assert.ok(kit, 'o projeto continua com um kit utilizável');
    assert.equal((await readGenerated(root)).locked, false, 'sem snapshot, o projeto não finge estar congelado');
    assert.match(await fs.readFile(path.join(root, 'remotion/public/brand/assets/logo.svg'), 'utf8'), /^<svg/);
  } finally {await fs.rm(base, {recursive: true, force: true});}
});
