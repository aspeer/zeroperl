#!/usr/bin/env python3
"""Validate preserved attribution files without extracting archive paths."""
import hashlib
import json
from pathlib import PurePosixPath
import sys
import tarfile

archive = sys.argv[1]
with tarfile.open(archive, 'r:gz') as tar:
    inventory = json.load(tar.extractfile('third-party-notices/inventory.json'))
expected = {record['path']: record for record in inventory['files']}
if len(expected) != len(inventory['files']):
    raise ValueError('Duplicate attribution inventory paths')
seen = set()
with tarfile.open(archive, 'r|gz') as tar:
    for member in tar:
        path = PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or path.parts[0] != 'third-party-notices':
            raise ValueError(f'Invalid attribution path: {member.name}')
        if member.isdir():
            continue
        if not member.isfile():
            raise ValueError(f'Unexpected attribution entry type: {member.name}')
        relative = str(path.relative_to('third-party-notices'))
        if relative in ('README.txt', 'inventory.json'):
            continue
        record = expected[relative]
        data = tar.extractfile(member).read()
        if len(data) != record['bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
            raise ValueError(f'Attribution checksum mismatch: {relative}')
        if relative in seen:
            raise ValueError(f'Duplicate archive entry: {relative}')
        seen.add(relative)
if seen != expected.keys():
    raise ValueError(f'Missing attribution entries: {expected.keys() - seen}')
print(f'Attribution evidence verified: {len(seen)} files (Perl {inventory["perlVersion"]})')
