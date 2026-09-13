import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {unpackTar} from 'modern-tar';
import {buildApplicationArchives} from '../scripts/build-vfs.mjs';
import {main as cloudflareMain} from '../scripts/webdyne-cloudflare.mjs';
import {readSourceInventory} from '../scripts/stage-perl-libraries.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'perl-staging-'));
  try {
    await mkdir(join(root, 'app')); await mkdir(join(root, 'lib'));
    await writeFile(join(root, 'app/app.psp'), '<p>unchanged</p>');
    const put = async (name, value) => {
      await mkdir(join(root, 'lib', name, '..'), {recursive: true});
      await writeFile(join(root, 'lib', name), value);
    };
    const build = options => buildApplicationArchives({projectRoot: root, appDirectory: 'app', libraryDirectories: ['lib'], outputDirectory: join(root, 'out'), ...options});
    await run({root, put, build});
  } finally { await rm(root, {recursive: true, force: true}); }
}
async function payload(result) {
  const entries = await unpackTar(gunzipSync(await readFile(result.perlLibraryVfsArchive)), {strict: true});
  return Object.fromEntries(entries.filter(({header}) => header.type === 'file').map(({header, data}) => [header.name, Buffer.from(data).toString()]));
}

test('deployment exclusions remove both installer forms but retain ordinary modules', () => fixture(async ({put, build}) => {
  await put('WebDyne/Install.pm', 'installer'); await put('WebDyne/Install/Apache.pm', 'apache');
  await put('WebDyne/InstallExtra.pm', 'keep'); await put('.meta/Example/install.json', '{}');
  await put('auto/Example/.packlist', 'metadata'); await put('Example.pod', '=head1 docs');
  const result = await build({});
  assert.deepEqual(Object.keys(await payload(result)), ['perl5/lib/WebDyne/InstallExtra.pm']);
  assert.equal(result.libraryReport.files.filter(x => x.reason === 'WebDyne installer').length, 2);
}));

test('foreign architecture roots flatten portable sources without deleting darwin-named modules', () => fixture(async ({put, build}) => {
  await put('x86_64-linux-thread-multi/.meta/Example-1/install.json', '{}');
  await put('x86_64-linux-thread-multi/Example.pm', 'architecture companion');
  await put('Example.pm', 'portable companion');
  await put('Module/Build/Platform/darwin.pm', 'ordinary module');
  const result = await build({}); const files = await payload(result);
  assert.equal(files['perl5/lib/Example.pm'], 'architecture companion');
  assert.equal(files['perl5/lib/Module/Build/Platform/darwin.pm'], 'ordinary module');
  assert.ok(!Object.keys(files).some(x => x.includes('x86_64')));
}));

test('raw source inventory recognises modules transformed in the embedded runtime', () => fixture(async ({put, build}) => {
  const source = 'package Example;\n\nsub answer { return 42; }\n1;\n';
  await put('Example.pm', source);
  const result = await build({embeddedFiles: {'Example.pm': hash('minified')}, sourceInventory: {sourceFiles: {'Example.pm': hash(source)}}});
  assert.deepEqual(result.omittedEmbeddedFiles, ['perl5/lib/Example.pm']);
  assert.deepEqual(await payload(result), {});
}));

test('source hashes cannot claim a module absent from the delivered inventory', () => fixture(async ({put, build}) => {
  await put('Example.pm', 'removed from wasm');
  const result = await build({sourceInventory: {sourceFiles: {'Example.pm': hash('removed from wasm')}}});
  assert.equal((await payload(result))['perl5/lib/Example.pm'], 'removed from wasm');
}));

for (const modified of [false, true]) {
  test(`host XS with verified implementation and ${modified ? 'modified' : 'matching'} companion`, () => fixture(async ({put, build}) => {
    await put('host-test/.meta/Example-1/install.json', JSON.stringify({dist: 'Example-1', provides: {Example: {file: 'lib/Example.pm'}}}));
    await put('host-test/Example.pm', modified ? 'patched' : 'package Example; 1;');
    await put('host-test/auto/Example/Example.so', 'native');
    const options = {embeddedFiles: {'Example.pm': hash('compiled source')}, sourceInventory: {
      sourceFiles: {'Example.pm': hash('package Example; 1;')}, nativeModules: {'Example.pm': {distribution: 'Example-1'}},
    }};
    if (modified) await assert.rejects(build(options), /no unchanged companion/);
    else {
      const result = await build(options);
      assert.deepEqual(await payload(result), {});
      assert.ok(result.libraryReport.files.some(x => x.reason === 'host XS supplied by runtime: Example.pm'));
    }
  }));
}

test('unknown native dependencies are rejected even inside excluded host architecture roots', () => fixture(async ({put, build}) => {
  await put('foreign/.meta/Example-2/install.json', '{}');
  await put('foreign/auto/Example/Example.so', 'native');
  await assert.rejects(build({}), /Native Perl artifacts.*Example.so/s);
}));

test('missing native capability is not inferred from a matching Perl wrapper', () => fixture(async ({put, build}) => {
  await put('Example.pm', 'same'); await put('auto/Example/Example.so', 'native');
  await assert.rejects(build({embeddedFiles: {'Example.pm': hash('same')}}), /verified target XS implementation/);
}));

test('empty bootstrap files are omitted but nonempty unsupported bootstraps fail', () => fixture(async ({put, build}) => {
  await put('auto/Example/Example.bs', ''); assert.deepEqual(await payload(await build({})), {});
  await put('auto/Example/Example.bs', 'bootstrap code'); await assert.rejects(build({}), /Native Perl artifacts/);
}));

test('minification preserves behaviour and source bytes, retains removed documentation, and is reproducible', () => fixture(async ({root, put, build}) => {
  const source = 'package Example;\n# copyright retained\nsub answer {\n    return  6 * 7;\n}\n1;\n\n=head1 LICENSE\n\nExample licence text.\n\n=cut\n';
  await put('Example.pm', source);
  const result = await build({minify: true}); const files = await payload(result);
  const compact = files['perl5/lib/Example.pm'];
  assert.ok(compact.length < source.length); assert.match(compact, /copyright retained/);
  assert.doesNotMatch(compact, /=head1/);
  assert.match(files['perl5/PERL-LIBRARY-DOCUMENTATION.txt'], /Example licence text/);
  await writeFile(join(root, 'Example.pm'), compact);
  assert.equal(execFileSync('perl', [`-I${root}`, '-MExample', '-e', 'print Example::answer()'], {encoding: 'utf8'}), '42');
  assert.equal(await readFile(join(root, 'lib/Example.pm'), 'utf8'), source);
  const firstArchive = await readFile(result.perlLibraryVfsArchive);
  const firstReport = await readFile(result.reportPath);
  await build({minify: true});
  assert.deepEqual(await readFile(result.perlLibraryVfsArchive), firstArchive);
  assert.deepEqual(await readFile(result.reportPath), firstReport);
  assert.equal(result.libraryReport.output_bytes, Object.values(files).reduce((n, x) => n + Buffer.byteLength(x), 0));
  assert.equal(result.libraryReport.saved_bytes, Buffer.byteLength(source) - result.libraryReport.output_bytes);
  assert.ok(!(await readdir(join(root, 'out'))).some(x => x.startsWith('.perl-stage-')));
}));

for (const [name, source] of Object.entries({
  data: 'package DataTest; 1;\n__DATA__\n=head1 DATA is runtime content\n',
  end: 'package EndTest; 1;\n__END__\n=pod\nkeep data\n',
  heredoc: 'package Here; my $x=<<"EOF";\n=head1 not POD\nEOF\n1;\n',
  line: 'package Line; my $line=__LINE__; 1;\n',
})) {
  test(`minification leaves ${name} source byte-identical`, () => fixture(async ({put, build}) => {
    await put('Example.pm', source);
    assert.equal((await payload(await build({minify: true})))['perl5/lib/Example.pm'], source);
  }));
}

test('minification can be disabled and rejects malformed source when enabled', () => fixture(async ({root, put, build}) => {
  await put('Bad.pm', 'package Bad; sub { {{{');
  const result = await build({minify: false}); const report = await readFile(result.reportPath);
  await assert.rejects(build({minify: true}), /Perl::Tidy failed/);
  await assert.rejects(build({minify: 'auto'}), /Perl::Tidy failed/);
  assert.deepEqual(await readFile(result.reportPath), report);
  assert.ok(!(await readdir(join(root, 'out'))).some(x => x.startsWith('.perl-stage-')));
}));

test('staging rejects symlinks even inside excluded metadata', () => fixture(async ({root, put, build}) => {
  await put('.meta/X/real', 'private'); await symlink(join(root, 'lib/.meta/X/real'), join(root, 'lib/.meta/X/link'));
  await assert.rejects(build({}), /symlinks are not portable/);
}));

test('staging rejects output inside a library', () => fixture(async ({root, put, build}) => {
  await put('Example.pm', '1;');
  await assert.rejects(build({outputDirectory: join(root, 'lib/out')}), /outside Perl libraries/);
}));

test('older packages have conservative inventory fallback; corrupt inventories fail', () => fixture(async ({root}) => {
  assert.deepEqual(await readSourceInventory(root), {});
  await writeFile(join(root, 'library-sources.json'), '{"schema":99}');
  await assert.rejects(readSourceInventory(root), /schema/);
}));

test('runtime source recorder preserves target precedence and lists only supported CPAN recipes', () => fixture(async ({root}) => {
  const prefix = join(root, 'prefix'); const core = join(prefix, 'lib/5.44.0');
  await mkdir(join(core, 'wasm32-wasi'), {recursive: true});
  await writeFile(join(core, 'Example.pm'), 'portable');
  await writeFile(join(core, 'wasm32-wasi/Example.pm'), 'target');
  await mkdir(join(core, 'wasm32-wasi/.meta/Example-1'), {recursive: true});
  await writeFile(join(core, 'wasm32-wasi/.meta/Example-1/install.json'), JSON.stringify({dist: 'Example-1', provides: {Example: {file: 'lib/Example.pm'}}}));
  const recipes = join(root, 'recipes.json');
  await writeFile(recipes, JSON.stringify([{module: 'Example'}, {module: 'Missing'}, {module: 'Example', before: '5.024'}]));
  const recorder = fileURLToPath(new URL('../tools/record-library-sources.pl', import.meta.url));
  const result = JSON.parse(execFileSync('perl', [recorder, prefix, '5.44.0', recipes]));
  assert.deepEqual(result.sourceFiles, {'Example.pm': hash('target')});
  assert.deepEqual(result.nativeModules, {'Example.pm': {distribution: 'Example-1'}});
}));


test('different XS distribution versions fail even when the wrapper bytes match', () => fixture(async ({put, build}) => {
  await put('host/.meta/Example-2/install.json', JSON.stringify({dist: 'Example-2', provides: {Example: {file: 'lib/Example.pm'}}}));
  await put('host/Example.pm', 'same wrapper'); await put('host/auto/Example/Example.so', 'native');
  await assert.rejects(build({embeddedFiles: {'Example.pm': hash('same wrapper')},
    sourceInventory: {nativeModules: {'Example.pm': {distribution: 'Example-1'}}}}), /verified target XS implementation/);
}));


test('CLI defaults to auto and honours explicit minification modes', () => fixture(async ({root, put}) => {
  const original = 'package Example;\nsub answer {\n    return 42;\n}\n1;\n';
  await put('Example.pm', original);
  for (const minify of [undefined, 'auto', true, false]) {
    await writeFile(join(root, 'package.json'), JSON.stringify({name: 'stage-cli', webdyne: {perlLibrary: 'lib', perlMinify: minify}}));
    await cloudflareMain(['build'], root);
    const result = {perlLibraryVfsArchive: join(root, '.webdyne/perl-lib-vfs.tar.gz')};
    const actual = (await payload(result))['perl5/lib/Example.pm'];
    if (minify === false) assert.equal(actual, original);
    else assert.ok(actual.length < original.length);
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({webdyne: {perlMinify: 'false'}}));
  await assert.rejects(cloudflareMain(['build'], root), /must be a boolean/);
}));

test('symlinked output cannot mutate a library', () => fixture(async ({root, put, build}) => {
  await put('Example.pm', '1;');
  await symlink(join(root, 'lib'), join(root, 'output-alias'));
  await assert.rejects(build({outputDirectory: join(root, 'output-alias/new')}), /outside Perl libraries/);
  assert.deepEqual(await readdir(join(root, 'lib')), ['Example.pm']);
}));

test('UTF-8 source and binary data survive staging', () => fixture(async ({root, put, build}) => {
  const source = "package Example; use utf8; sub word { return 'café π'; } 1;\n";
  await put('Example.pm', source); await put('data.bin', Buffer.from([0, 255, 128, 42]));
  const result = await build({minify: true}); const files = await payload(result);
  await writeFile(join(root, 'Example.pm'), files['perl5/lib/Example.pm']);
  assert.equal(execFileSync('perl', ['-CS', `-I${root}`, '-MExample', '-e', 'print Example::word()'], {encoding: 'utf8'}), 'café π');
  const entries = await unpackTar(gunzipSync(await readFile(result.perlLibraryVfsArchive)), {strict: true});
  assert.deepEqual(Buffer.from(entries.find(x => x.header.name.endsWith('/data.bin')).data), Buffer.from([0, 255, 128, 42]));
}));

test('no-library builds do not require Perl on PATH', () => fixture(async ({root}) => {
  const builder = new URL('../scripts/build-vfs.mjs', import.meta.url).href;
  const code = `import {buildApplicationArchives} from ${JSON.stringify(builder)}; await buildApplicationArchives(${JSON.stringify({projectRoot: root, appDirectory: 'app', outputDirectory: join(root, 'empty')})});`;
  execFileSync(process.execPath, ['--input-type=module', '-e', code], {env: {...process.env, PATH: ''}});
}));

// Isolate dependency failures in child processes: the real host installation
// and concurrent tests remain untouched. The @INC hook blocks only Perl::Tidy.
for (const dependency of ['missing', 'wrong-version']) {
  test(`CLI auto fallback with ${dependency} formatter keeps other staging rules`, () => fixture(async ({root, put}) => {
    const source = 'package Example;\nsub answer {\n    return 42;\n}\n1;\n';
    await put('foreign/.meta/Example/install.json', '{}');
    await put('foreign/Example.pm', source);
    await put('WebDyne/Install.pm', 'installer');
    const hook = dependency === 'missing'
      ? 'unshift(@INC, sub { die "simulated missing Perl::Tidy\\n" if $_[1] eq "Perl/Tidy.pm"; return; }); 1;'
      : 'package Perl::Tidy; our $VERSION="0.001"; $INC{"Perl/Tidy.pm"}=__FILE__; 1;';
    await writeFile(join(root, 'StageDependency.pm'), hook);
    const run = () => spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {main} from ${JSON.stringify(new URL('../scripts/webdyne-cloudflare.mjs', import.meta.url).href)}; await main(['build'], ${JSON.stringify(root)});`],
      {encoding: 'utf8', env: {...process.env, PERL5OPT: `-I${root} -MStageDependency`}});
    for (const mode of [undefined, 'auto', true, false]) {
      await writeFile(join(root, 'package.json'), JSON.stringify({name: 'fallback', webdyne: {perlLibrary: 'lib', perlMinify: mode}}));
      const result = run();
      if (mode === true) {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /minification requires Perl::Tidy 20260826/);
        continue;
      }
      assert.equal(result.status, 0, result.stderr);
      const files = await payload({perlLibraryVfsArchive: join(root, '.webdyne/perl-lib-vfs.tar.gz')});
      assert.deepEqual(files, {'perl5/lib/Example.pm': source});
      const report = JSON.parse(await readFile(join(root, '.webdyne/perl-library-report.json')));
      assert.equal(report.minify, false);
      assert.equal(report.minify_requested, mode ?? 'auto');
      if (mode === false) {
        assert.equal(result.stderr, '');
        assert.equal(report.minification_skipped, undefined);
      } else {
        assert.match(result.stderr, /Perl library minification skipped/);
        assert.match(report.minification_skipped, /cpanm Perl::Tidy@20260826/);
      }
    }
    await put('auto/Unknown/Unknown.so', 'unsupported native code');
    await writeFile(join(root, 'package.json'), JSON.stringify({webdyne: {perlLibrary: 'lib'}}));
    const rejected = run();
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Native Perl artifacts/);
  }));
}
