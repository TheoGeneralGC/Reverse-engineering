import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { docx, legacyDoc, pdf, pptx } from './knowledge-format-fixtures.ts';

function installedParserRoots(): Map<string, string> {
  const require = createRequire(import.meta.url), result = new Map<string, string>();
  for (const name of ['fflate', 'saxes', 'parse5', 'word-extractor', 'pdfjs-dist']) {
    let directory = dirname(realpathSync(require.resolve(name))), found = false;
    for (let depth = 0; depth < 64; depth++) {
      const metadata = join(directory, 'package.json');
      if (existsSync(metadata) && JSON.parse(readFileSync(metadata, 'utf8')).name === name) { result.set(name, directory); found = true; break; }
      const parent = dirname(directory); if (parent === directory) break; directory = parent;
    }
    assert.equal(found, true, 'The installed parser package root must resolve: ' + name);
  }
  return result;
}

function linkParserPackages(modules: string): Map<string, string> {
  mkdirSync(modules, { recursive: true });
  const roots = installedParserRoots();
  for (const [name, directory] of roots) symlinkSync(directory, join(modules, name), 'junction');
  return roots;
}

test('actual extraction supports a hoisted workspace with symlinked package roots without granting unrelated files', async () => {
  const originalApi = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-hoisted-fixture-'));
  try {
    const workspace = join(directory, 'workspace'), api = join(workspace, 'apps', 'mail', 'api');
    const modules = join(workspace, 'node_modules');
    mkdirSync(api, { recursive: true }); mkdirSync(modules);
    cpSync(join(originalApi, 'src'), join(api, 'src'), { recursive: true });
    writeFileSync(join(api, 'package.json'), '{"name":"synthetic-hoisted-api","type":"module"}');
    writeFileSync(join(workspace, 'package.json'), '{"name":"synthetic-workspace","private":true,"type":"module"}');
    // Only symlink already-installed dependencies; no copied vendor fixtures,
    // binary downloads, package installation, environment files or databases.
    const actualRoots = linkParserPackages(modules);
    const unrelated = join(modules, 'synthetic-unrelated'); mkdirSync(unrelated);
    writeFileSync(join(unrelated, 'package.json'), '{"name":"synthetic-unrelated","version":"1.0.0"}');
    const secret = join(unrelated, 'not-parser-data.txt'); writeFileSync(secret, 'SYNTHETIC_UNRELATED_FILE_MUST_STAY_DENIED');
    assert.equal(existsSync(join(api, 'node_modules')), false, 'Dependencies exist only in the workspace ancestor');
    const runner = await import(pathToFileURL(join(api, 'src', 'knowledge-runner.ts')).href) as typeof import('../src/knowledge-runner.ts');
    const permissions = runner.knowledgeWorkerReadPaths('pdf');
    const apiSrc = realpathSync(join(api, 'src')), packageFile = realpathSync(join(api, 'package.json'));
    assert.ok(permissions.includes(apiSrc)); assert.ok(permissions.includes(packageFile));
    assert.equal(new Set(permissions).size, permissions.length);
    assert.ok(permissions.some(path => path !== realpathSync(path)), 'Node metadata reads also require the exact selected package alias');
    assert.ok(permissions.every(path => ![directory, workspace, api, modules, unrelated, ...[...actualRoots.values()].map(dirname)].includes(path)), 'No parent, workspace, node_modules tree or unrelated package is permitted');
    for (const path of permissions.filter(path => path !== apiSrc && path !== packageFile)) {
      const metadata = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
      assert.equal(typeof metadata.name, 'string', 'Dependency permissions name actual package roots');
      assert.notEqual(metadata.name, 'synthetic-unrelated');
    }
    for (const [extension, bytes] of [
      ['txt', Buffer.from('Cedar hoisted synthetic text.')], ['docx', docx()], ['doc', legacyDoc()], ['pdf', pdf()], ['pptx', pptx([2, 1])],
    ] as const) {
      const value = await runner.runKnowledgeExtraction(bytes, extension);
      assert.match(value.text, /Cedar|VISIBLE_SLIDE_2/, extension);
      assert.equal(value.truncated, false, extension);
    }
    const probe = spawnSync(process.execPath, ['--permission', ...permissions.map(path => '--allow-fs-read=' + path), '--input-type=module', '-e',
      `import fs from 'node:fs';let denied=false;try{fs.readFileSync(${JSON.stringify(secret)})}catch(e){denied=e.code==='ERR_ACCESS_DENIED'}console.log(JSON.stringify({denied,permitted:process.permission.has('fs.read',${JSON.stringify(secret)})}));if(!denied)process.exitCode=1;`], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', NODE_NO_WARNINGS: '1' }, timeout: 5000 });
    assert.equal(probe.status, 0, probe.stderr);
    assert.deepEqual(JSON.parse(probe.stdout), { denied: true, permitted: false });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('unusual separator, wildcard and control characters fail closed before permission flags can widen a source path', async () => {
  const originalApi = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-permission-path-'));
  try {
    for (const segment of ['star*', 'comma,', 'question?', 'bracket[', 'brace{', 'line\nbreak']) {
      const api = join(directory, segment), src = join(api, 'src');
      mkdirSync(src, { recursive: true });
      for (const name of ['knowledge-runner.ts', 'knowledge-input.ts', 'knowledge-types.ts', 'types.ts']) {
        cpSync(join(originalApi, 'src', name), join(src, name));
      }
      writeFileSync(join(api, 'package.json'), '{"name":"synthetic-path-control","type":"module"}');
      linkParserPackages(join(api, 'node_modules'));
      const runner = await import(pathToFileURL(join(src, 'knowledge-runner.ts')).href) as typeof import('../src/knowledge-runner.ts');
      assert.throws(() => runner.knowledgeWorkerReadPaths('txt'), /permission paths are unsupported/);
      await assert.rejects(() => runner.runKnowledgeExtraction(Buffer.from('Synthetic path control'), 'txt'), { code: 'knowledge_parser_unavailable' });
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
