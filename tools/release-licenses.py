#!/usr/bin/env python3
"""Create a deterministic, standalone GitHub Release licence archive."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

evidence, destination, source_manifest = map(Path, sys.argv[1:])
repo = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory() as scratch:
    compact = Path(scratch) / 'THIRD-PARTY-LICENSES.txt'
    subprocess.run([sys.executable, '-B', str(repo / 'tools/compact-notices.py'),
                    str(evidence), str(compact)], check=True)
    files = {'THIRD-PARTY-LICENSES.txt': compact.read_bytes(),
             'build-manifest.json': source_manifest.read_bytes()}
    for path in sorted((repo / 'licenses').rglob('*')):
        if path.is_file():
            files[path.relative_to(repo).as_posix()] = path.read_bytes()
    files['inventory.json'] = (json.dumps({name: {
        'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()
    } for name, data in sorted(files.items())}, indent=2) + '\n').encode()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('wb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w', format=tarfile.USTAR_FORMAT) as archive:
                for name, data in sorted(files.items()):
                    entry = tarfile.TarInfo(name)
                    entry.size = len(data)
                    entry.mode = 0o644
                    archive.addfile(entry, io.BytesIO(data))
