#!/usr/bin/env python3
"""Preserve attribution evidence before the embedded sources lose comments.

This deliberately includes build-only distributions: it is an evidence bundle,
not a legal conclusion that every collected source is linked into the WASM.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil

out = Path('/build/third-party-notices')
if out.exists():
    shutil.rmtree(out)
out.mkdir()
records = {}
legal_name = re.compile(r'^(?:licen[cs]e|copying|copyright|notice|authors|artistic|readme)(?:[._-].*)?$', re.I)
legal_text = re.compile(rb'copyright|licen[cs]e|same terms as perl', re.I)

def preserve(root, label, recursive=True):
    if not root.is_dir():
        return
    paths = root.rglob('*') if recursive else root.iterdir()
    for path in sorted(paths):
        relative = path.relative_to(root)
        if any(part in ('blib', '.git', 'prefix') for part in relative.parts):
            continue
        if not path.is_file() or path.is_symlink():
            continue
        is_metadata = path.name in ('META.json', 'MYMETA.json', 'META.yml', 'install.json')
        if not (is_metadata or legal_name.match(path.name) or path.suffix in ('.pm', '.pod', '.xs', '.c', '.h')):
            continue
        data = path.read_bytes()
        if not (is_metadata or legal_name.match(path.name) or legal_text.search(data)):
            continue
        target = out / label / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        records[str(target.relative_to(out))] = {'path': str(target.relative_to(out)), 'source': str(path),
                        'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}

native = Path(os.environ.get('NATIVE_DIR', '/build/native'))
preserve(native, 'perl', False)
for group in ('cpan', 'dist', 'ext', 'lib'):
    preserve(native / group, 'perl/' + group)
for work in sorted(Path('/root/.cpanm/work').glob('*')) + sorted(Path('/root/.menlo/work').glob('*')):
    for dist in sorted(work.iterdir()):
        if dist.is_dir():
            preserve(dist, 'native-cpan/' + dist.name)
for dist in sorted(Path('/build/cpan-xs').glob('*')):
    if dist.is_dir():
        preserve(dist, 'target-cpan/' + dist.name)
preserve(Path('/build/dependency-notices'), 'libraries')
preserve(Path('/opt/wasi-sdk'), 'wasi-sdk')
(out / 'inventory.json').write_text(json.dumps({'schemaVersion': 1,
    'perlVersion': os.environ.get('PERL_VERSION'),
    'scope': 'Attribution evidence from matching build sources; includes build-only dependencies.',
    'files': [records[key] for key in sorted(records)]}, indent=2) + '\n')
(out / 'README.txt').write_text('''Attribution evidence from the matching runtime build.

Files preserve upstream license texts, READMEs, metadata, and original source
files containing attribution. Native CPAN entries may include build-only
packages or versions superseded by target-cpan. The release manifest and
prefix inventory describe the installed runtime payload. This evidence bundle
is not a claim that every collected distribution is included in that payload.
The wasi-sdk directory contains notices present in the installed SDK; assess
its completeness against wasi-libc and compiler-rt source before publication.
''')
print(f'Preserved {len(records)} attribution source files')
