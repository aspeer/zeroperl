#!/usr/bin/env python3
"""Preserve verbatim legal text from verified build evidence without SDK/source bulk.

Keep whole dedicated notice files. For source files keep complete POD/comment
blocks containing legal markers; fall back to the whole file if any marker is
outside those blocks. Identical texts are stored once with all source paths.
The separately shipped SDK license inventory covers the omitted installed SDK.
"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile

LEGAL = re.compile(rb'copyright|licen[cs]e|same terms as perl', re.I)
DEDICATED = re.compile(r'^(?:licen[cs]e|copying|copyright|notice|authors|artistic|readme)(?:[._-].*)?$', re.I)
BLOCKS = re.compile(rb'/\*.*?\*/|(?:^[ \t]*\#[^\n]*(?:\n|$))+|(?:^[ \t]*//[^\n]*(?:\n|$))+|^=(?!cut\b)[a-zA-Z][^\n]*\n.*?(?:^=cut[^\n]*(?:\n|$)|\Z)', re.M | re.S)

def legal_blocks(data):
    spans = [(m.start(), m.end()) for m in BLOCKS.finditer(data) if LEGAL.search(m.group())]
    markers = list(LEGAL.finditer(data))
    if any(not any(start <= m.start() < end for start, end in spans) for m in markers):
        return [data]  # Unrecognized syntax: preserve, never silently truncate.
    return [data[start:end] for start, end in spans]

def compact(archive, destination):
    texts = {}
    with tarfile.open(archive, 'r:gz') as tar:
        inventory = json.load(tar.extractfile('third-party-notices/inventory.json'))
        for record in inventory['files']:
            name = record['path']
            path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Unsafe evidence path')
            if path.parts[0] == 'wasi-sdk':
                continue
            if path.name in ('META.json', 'MYMETA.json', 'META.yml', 'install.json'):
                continue
            data = tar.extractfile('third-party-notices/' + name).read()
            if hashlib.sha256(data).hexdigest() != record['sha256'] or len(data) != record['bytes']:
                raise ValueError('Evidence checksum mismatch: ' + name)
            blocks = [data] if DEDICATED.match(path.name) else legal_blocks(data)
            for block in blocks:
                key = hashlib.sha256(block).hexdigest()
                item = texts.setdefault(key, {'text': block, 'sources': set()})
                item['sources'].add(name)
    header = b'''Third-party license and attribution texts from matching build sources.

Texts below are verbatim dedicated notice files or complete legal comment/POD
blocks; unfamiliar source syntax is retained in full. Duplicate texts appear
once with their source paths. The scope conservatively includes build-only
components. Installed SDK source/documents are excluded here; their licenses
and original-source references are shipped separately in licenses/wasi-sdk-27.
Full checksummed build evidence is retained as a diagnostic build artifact.

'''
    with open(destination, 'wb') as out:
        out.write(header)
        for key, item in sorted(texts.items()):
            out.write(('\n' + '=' * 72 + '\nSources:\n' + '\n'.join(sorted(item['sources'])) + '\nSHA-256: ' + key + '\n\n').encode())
            out.write(item['text'])
            out.write(b'\n')
    print(f'Preserved {len(texts)} distinct notice texts: {Path(destination).stat().st_size} bytes')

if __name__ == '__main__':
    compact(sys.argv[1], sys.argv[2])
