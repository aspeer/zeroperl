// Run: node t/runtime/smoke-perl-staging.mjs /path/to/new-runtime.wasm [--verbatim]
// Exercise staged/minified modules through the real persistent PAGI runtime,
// including data, Unicode, async Futures and repeated concurrent requests.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {register} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildApplicationArchives} from '../../scripts/build-vfs.mjs';
register('./perl-source-loader.mjs', import.meta.url);
const {createWebDyneRuntime} = await import('../../js/runtime/webdyne-runtime.js');
const root = await mkdtemp(join(tmpdir(), 'wasm-perl-staging-'));
const interpreters = [];
const verbatim = process.argv.includes('--verbatim');
try {
  await mkdir(join(root, 'app')); await mkdir(join(root, 'lib'));
  await writeFile(join(root, 'lib/Compact.pm'), `package Compact;
use strict; use warnings; use utf8;
use Future; use Future::AsyncAwait;
async sub value {
    my $answer = await Future->done(42);
    return "café π:$answer";
}
1;
=head1 COPYRIGHT

Fixture attribution retained in the deployment archive.

=cut
`);
  await writeFile(join(root, 'lib/RuntimeData.pm'), `package RuntimeData;
our $value; sub value { if (!defined($value)) { $value=<DATA>; chomp($value); } return $value; }
1;
__DATA__
kept
=head1 This is runtime data, not removable POD
`);
  await writeFile(join(root, 'app/app.pagi'), `use Future::AsyncAwait;
use Encode qw(encode); use Compact; use RuntimeData;
async sub {
    my ($scope_hr, $receive_cr, $send_cr)=@_;
    return if $scope_hr->{'type'} eq 'lifespan';
    my $body=encode('UTF-8', (await Compact::value()).':'.RuntimeData::value());
    await $send_cr->({type => 'http.response.start', status => 200, headers => [['content-type','text/plain; charset=utf-8']]});
    await $send_cr->({type => 'http.response.body', body => $body, more_body => 0});
};
`);
  const files = await buildApplicationArchives({projectRoot: root, appDirectory: 'app', libraryDirectories: verbatim ? [] : ['lib'], verbatimLibraryDirectories: verbatim ? ['lib'] : [], outputDirectory: join(root, 'out'), minify: true});
  if (verbatim) {
    assert.ok(files.libraryReport.files.every(x => x.reason === 'explicit library retained verbatim'));
    assert.equal(files.libraryReport.saved_bytes, 0);
  } else {
    assert.equal(files.libraryReport.files.find(x => x.path === 'Compact.pm').minification, 'compacted');
    assert.match(files.libraryReport.files.find(x => x.path === 'RuntimeData.pm').minification, /skipped/);
  }
  const runtime = createWebDyneRuntime({
    zeroperlModule: await WebAssembly.compile(await readFile(process.argv[2])),
    appVfsArchive: new Uint8Array(await readFile(files.appVfsArchive)).buffer,
    perlLibraryVfsArchive: new Uint8Array(await readFile(files.perlLibraryVfsArchive)).buffer,
    extensions: [{register(perl) { interpreters.push(perl); }}],
  });
  async function request() {
    const result = runtime.dispatch(new Request('http://localhost/'), {WEBDYNE_INDEX: 'app.pagi'});
    const response = await result.response;
    assert.equal(response.status, 200); assert.equal(await response.text(), 'café π:42:kept');
    await result.completion;
  }
  await request();
  for (let batch = 0; batch < 5; batch++) await Promise.all(Array.from({length: 4}, request));
  assert.equal(interpreters.length, 1);
  const check = await interpreters[0].eval(`
    die 'source inventory leaked into WASM' if -e '/zeroperl/library-sources.json';
    die 'installer remains embedded' if eval { require WebDyne::Install; 1 };
    1;
  `);
  assert.equal(check.success, true, check.error);
  console.log('PASS: ' + (verbatim ? 'verbatim' : 'minified') + ' async/UTF-8 modules, preserved DATA, 21 requests in one interpreter; installer and build inventory absent from WASM');
} finally {
  for (const perl of interpreters) await perl.dispose();
  await rm(root, {recursive: true, force: true});
}
