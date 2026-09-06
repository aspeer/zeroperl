#!/usr/bin/env python3
"""Render pinned, reviewed notice excerpts; never infer licences during packaging."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Unsafe notice path: ' + name)
    return str(path)


def payload_identity(inventory):
    encode = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    # These generated files carry host paths/configuration, not new module code.
    content = {name: value for name, value in inventory.items()
               if '.meta' not in PurePosixPath(name).parts
               and PurePosixPath(name).name not in ('.packlist', 'Config_heavy.pl')}
    return {'paths': digest(encode(sorted(inventory))), 'content': digest(encode(content))}


def render(evidence, policy_path, manifest, destination, repo, inventory):
    if not Path(policy_path).is_file():
        raise ValueError('No reviewed runtime licence inventory: ' + str(policy_path))
    policy = json.loads(Path(policy_path).read_text())
    if policy.get('schemaVersion') != 1:
        raise ValueError('Unsupported runtime licence inventory schema')
    if (policy['perlVersion'] != manifest['perlVersion'] or
            policy['payloadIdentity'] != payload_identity(inventory) or
            policy['profile'] != manifest.get('profile', {})):
        raise ValueError('Runtime licence review is stale: review the changed runtime payload')
    if digest(Path(evidence).read_bytes()) != manifest['artifacts']['notices']['sha256']:
        raise ValueError('Attribution evidence checksum mismatch')
    for name, expected in policy['buildInputs'].items():
        if digest((repo / safe_path(name)).read_bytes()) != expected:
            raise ValueError('Runtime licence review is stale: ' + name)
    texts = {}
    with tarfile.open(evidence, 'r:gz') as archive:
        for source in policy['sources']:
            name = safe_path(source['path'])
            if source['location'] == 'evidence':
                data = archive.extractfile('third-party-notices/' + name).read()
            elif source['location'] == 'repository':
                data = (repo / name).read_bytes()
            else:
                raise ValueError('Unknown notice source location')
            ranges = source['ranges']
            if 'generatedCopyrightSha256' in source:
                # Errno.pm is generated with host-specific errno constants. Only
                # its complete copyright POD section is relevant to this review.
                match = re.search(rb'^=head1 COPYRIGHT\n.*?(?=^=head1 |^=cut|\Z)', data, re.M | re.S)
                if not match or digest(match.group()) != source['generatedCopyrightSha256']:
                    raise ValueError('Generated copyright section changed: ' + name)
                ranges = [[match.start(), match.end()]]
            elif digest(data) != source['sha256']:
                raise ValueError('Notice source changed: ' + name)
            for start, end in ranges:
                if not 0 <= start < end <= len(data):
                    raise ValueError('Invalid reviewed notice range: ' + name)
                text = data[start:end].decode(source.get('encoding', 'utf-8')).strip()
                # Deduplicate wrapping/indentation only. Keep the first complete
                # excerpt verbatim; never rewrite legal words or remove clauses.
                key = re.sub(r'\s+', ' ', text)
                item = texts.setdefault(key, {'text': text, 'components': set()})
                item['components'].add(source['component'])
    covered = set().union(*(item['components'] for item in texts.values()))
    if covered != set(policy['components']):
        raise ValueError('Reviewed component has no notice coverage')
    header = '''Third-party licences and copyright notices

This file accompanies the WebDyne ZeroPerl WASM runtime. Each numbered text
applies to the components listed above it. Shared terms are printed once;
component-specific copyright notices and exceptions remain included. The
broader attribution collection and extraction inventory are supplied on the matching
GitHub Release, linked from THIRD-PARTY-NOTICES.md.

Where a component offers Perl's Artistic/GPL alternative, this distribution
uses the Artistic option. Full evidence on GitHub retains upstream alternatives.
Other components retain their own terms, including Apache, MIT and BSD notices.

The Perl interpreter is modified for WASI, static XS linkage, an embedded
filesystem and asynchronous host calls. It is distributed as zeroperl-webdyne,
not as the standard perl executable. Standard Perl source is available at
https://www.cpan.org/src/5.0/perl-%s.tar.gz . The matching modified source and
build instructions are in https://github.com/aspeer/zeroperl .

''' % manifest['perlVersion']
    chunks = [header]
    for index, key in enumerate(sorted(texts), 1):
        item = texts[key]
        chunks.append('\n' + '=' * 60 + '\nNotice %d\nApplies to: %s\n\n%s\n' % (
            index, '; '.join(sorted(item['components'])), item['text']))
    output = ''.join(chunks).encode('utf-8')
    if len(output) > 500_000:
        raise ValueError('Runtime notices exceed the 500 KB review budget')
    Path(destination).write_bytes(output)
    print('Runtime notices: %d components, %d distinct texts, %d bytes' % (
        len(covered), len(texts), len(output)))


if __name__ == '__main__':
    evidence, policy, manifest, destination, inventory = sys.argv[1:]
    render(evidence, policy, json.loads(Path(manifest).read_text()), destination,
           Path(__file__).resolve().parent.parent, json.loads(Path(inventory).read_text()))
