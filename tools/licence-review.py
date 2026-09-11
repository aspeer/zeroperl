#!/usr/bin/env python3
"""Propose a notice inventory from verified evidence; never modify release policy."""
import argparse
import copy
import difflib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('runtime_notices', ROOT / 'tools/runtime-notices.py')
notices = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notices)


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def run(*args, **kwargs):
    try:
        return subprocess.run(list(map(str, args)), cwd=ROOT, check=True, **kwargs)
    except subprocess.CalledProcessError as error:
        if kwargs.get('capture_output'):
            print(error.stdout or '', file=sys.stderr)
            print(error.stderr or '', file=sys.stderr)
        raise


def evidence_files(path):
    result = {}
    with tarfile.open(path, 'r:gz') as archive:
        for member in archive:
            if not member.isfile():
                continue
            name = notices.safe_path(member.name)
            if not name.startswith('third-party-notices/'):
                raise ValueError('Unexpected evidence path: ' + name)
            name = name.removeprefix('third-party-notices/')
            if name in result:
                raise ValueError('Duplicate evidence path: ' + name)
            result[name] = archive.extractfile(member).read()
    return result


def distribution(name):
    """CPAN distribution basename, preserving hyphens in the name."""
    match = re.fullmatch(r'(.+)-v?\d[^/]*', name)
    return match.group(1) if match else name


def relocate(old, new, ranges):
    result = []
    for start, end in ranges:
        if not 0 <= start < end <= len(old):
            raise ValueError('Invalid baseline excerpt range')
        excerpt = old[start:end]
        offset = new.find(excerpt)
        if offset < 0:
            raise ValueError('Reviewed notice text changed or disappeared')
        if new.find(excerpt, offset + 1) >= 0:
            raise ValueError('Reviewed notice text occurs more than once')
        result.append([offset, offset + len(excerpt)])
    return result


def propose(policy, old_files, new_files, repo):
    candidate = copy.deepcopy(policy)
    blockers, changes, diffs = [], [], []
    old_dists = {p.split('/')[1] for p in old_files if p.startswith('native-cpan/')}
    new_dists = {p.split('/')[1] for p in new_files if p.startswith('native-cpan/')}
    mapping = {}
    for old in sorted(old_dists):
        matches = sorted(d for d in new_dists if distribution(d) == distribution(old))
        if len(matches) != 1:
            blockers.append(f'Distribution removed or ambiguous: {old}: {matches}')
        else:
            mapping[old] = matches[0]
    for new in sorted(new_dists - set(mapping.values())):
        blockers.append(f'New distribution needs notice selection: {new}')
    for old, new in mapping.items():
        if old != new:
            changes.append(f'Distribution: {old} -> {new}')
    for key in ('components', 'excludedCpanDistributions'):
        candidate[key] = [mapping.get(name, name) for name in policy.get(key, [])]

    def mapped(path):
        parts = path.split('/')
        if parts[0] == 'native-cpan':
            parts[1] = mapping.get(parts[1], parts[1])
        return '/'.join(parts)

    # Include all attribution changes, including sources outside selected excerpts.
    # This exposes newly added legal text rather than assuming old excerpts suffice.
    mapped_old = {mapped(path): data for path, data in old_files.items()}
    original_names = {mapped(path): path for path in old_files}
    for path in sorted(set(mapped_old) | set(new_files)):
        if path in ('inventory.json', 'README.txt'):
            continue
        old, new = mapped_old.get(path, b''), new_files.get(path, b'')
        if old != new:
            diffs.extend(difflib.unified_diff(old.decode('utf-8', 'replace').splitlines(True),
                         new.decode('utf-8', 'replace').splitlines(True),
                         fromfile='baseline/' + original_names.get(path, path), tofile='new/' + path))
        if path not in mapped_old or path not in new_files:
            blockers.append('Evidence file added/removed; review coverage: ' + path)

    for source in candidate['sources']:
        original_path = source['path']
        try:
            if source['location'] == 'repository':
                data = (repo / notices.safe_path(original_path)).read_bytes()
                if notices.digest(data) != source['sha256']:
                    raise ValueError('Repository notice source changed')
                continue
            if source['location'] != 'evidence':
                raise ValueError('Unknown source location')
            old = old_files[original_path]
            source['path'] = mapped(original_path)
            source['component'] = mapping.get(source['component'], source['component'])
            new = new_files[source['path']]
            if 'generatedCopyrightSha256' in source:
                pattern = rb'^=head1 COPYRIGHT\n.*?(?=^=head1 |^=cut|\Z)'
                before, after = (re.search(pattern, value, re.M | re.S) for value in (old, new))
                if not before or not after or any(notices.digest(m.group()) != source['generatedCopyrightSha256'] for m in (before, after)):
                    raise ValueError('Generated copyright section changed')
                source['ranges'] = [[after.start(), after.end()]]
            else:
                if notices.digest(old) != source['sha256']:
                    raise ValueError('Baseline source does not match reviewed hash')
                if old != new:
                    source['ranges'] = relocate(old, new, source['ranges'])
            source['sha256'] = notices.digest(new)
            if original_path != source['path'] or old != new:
                changes.append('Preserved notice text: ' + source['path'])
        except (KeyError, ValueError, OSError) as error:
            blockers.append(f'{original_path}: {error}')
    return candidate, blockers, changes, ''.join(diffs)


def check_adoption(report, candidate_path, manifest_path, policy_path):
    if report.get('status') != 'verified-proposal' or report.get('blockers'):
        raise ValueError('Run make licence-review successfully before adoption')
    for field, path in [('candidateSha256', candidate_path), ('manifestSha256', manifest_path)]:
        if report.get(field) != notices.digest(path.read_bytes()):
            raise ValueError(f'{field} changed or missing; rerun make licence-review')
    current = notices.digest(policy_path.read_bytes())
    if current not in (report.get('policySha256'), report['candidateSha256']):
        raise ValueError('Committed policy changed since review; rerun make licence-review')


def adopt(report_path, candidate_path, manifest_path, policy_path):
    check_adoption(read_json(report_path), candidate_path, manifest_path, policy_path)
    manifest = read_json(manifest_path)
    artifacts = manifest['artifacts']
    # Recheck the current artifact bytes, payload, input hashes and all excerpts
    # before replacing the policy. No report status alone authorizes stale bytes.
    with tempfile.TemporaryDirectory(prefix='licence-adopt-', dir=report_path.parent) as directory:
        run('node', ROOT / 'tools/prepare-npm-package.mjs', '--source', manifest_path.parent,
            '--manifest', manifest_path.name, '--wasm', artifacts['wasm']['filename'],
            '--reactor', artifacts['reactor']['filename'], '--destination', Path(directory) / 'package',
            '--notice-policy', candidate_path)
    check_adoption(read_json(report_path), candidate_path, manifest_path, policy_path)
    if policy_path.read_bytes() == candidate_path.read_bytes():
        print(f'Inventory already adopted: {policy_path}')
        return 0
    with tempfile.NamedTemporaryFile(dir=policy_path.parent, delete=False) as staging:
        temporary = Path(staging.name)
        staging.write(candidate_path.read_bytes())
    try:
        temporary.chmod(policy_path.stat().st_mode & 0o777)
        temporary.replace(policy_path)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Adopted verified inventory: {policy_path}')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--perl-version', default='5.44.0')
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--adopt', action='store_true', help='Adopt the verified proposal after reviewing its evidence diff')
    args = parser.parse_args()
    version = read_json(ROOT / 'release/versions.json')['version']
    manifest_path = (args.manifest or ROOT / f'output/{args.perl_version}/manifest-{args.perl_version}-{version}.json').resolve()
    if not manifest_path.is_file():
        raise ValueError(f'Missing {manifest_path}. First run: PERL_VERSION={args.perl_version} ./build.sh run off')
    manifest = read_json(manifest_path)
    policy_path = ROOT / f'release/licences/{args.perl_version}.json'
    policy = read_json(policy_path)
    if manifest['perlVersion'] != policy['perlVersion'] or manifest.get('profile', {}) != policy['profile']:
        raise ValueError('Perl version or build profile changed; a separate review is required')
    release_id = f"{args.perl_version}-{manifest.get('releaseVersion', manifest['buildNumber'])}"
    destination = ROOT / 'output/licence-review' / release_id
    destination.mkdir(parents=True, exist_ok=True)
    report = destination / 'report.json'
    candidate_path = destination / 'candidate.json'
    if args.adopt:
        return adopt(report, candidate_path, manifest_path, policy_path)
    # Do not leave a previous successful candidate after a failed rerun.
    candidate_path.unlink(missing_ok=True)
    (destination / 'incomplete.json').unlink(missing_ok=True)
    result = {'status': 'incomplete', 'manifest': str(manifest_path), 'blockers': []}
    write_json(report, result)
    archives = [args.baseline] if args.baseline else sorted((ROOT / 'output').glob('**/third-party-notices*.tar.gz'))
    baseline = next((path for path in archives if path.is_file() and notices.digest(path.read_bytes()) == policy['evidenceSha256']), None)
    if baseline is None:
        raise ValueError('No baseline archive matches reviewed evidenceSha256. Supply LICENCE_BASELINE=/path/to/original/archive.tar.gz')
    artifacts = manifest['artifacts']
    evidence = manifest_path.parent / notices.safe_path(artifacts['notices']['filename'])
    for archive in (baseline, evidence):
        run(sys.executable, '-B', ROOT / 'tools/verify-notices.py', archive)
    package = destination / 'package'
    prepare = ['node', ROOT / 'tools/prepare-npm-package.mjs', '--source', manifest_path.parent,
               '--manifest', manifest_path.name, '--wasm', artifacts['wasm']['filename'],
               '--reactor', artifacts['reactor']['filename'], '--destination', package]
    run(*prepare, '--inventory-only', 'true')
    inventory = read_json(package / 'embedded-files.json')
    old_files, new_files = evidence_files(baseline), evidence_files(evidence)
    candidate, blockers, changes, diff = propose(policy, old_files, new_files, ROOT)
    (destination / 'evidence.diff').write_text(diff)
    for name, expected in policy['buildInputs'].items():
        actual = notices.digest((ROOT / notices.safe_path(name)).read_bytes())
        if actual != expected:
            changes.append('Build input changed: ' + name)
            if name != f'cpanfile.snapshot.{args.perl_version}':
                blockers.append('Build input needs review: ' + name)
        candidate['buildInputs'][name] = actual
    # Compare the locked distributions with actual source evidence. Bootstrap
    # tooling is retained in the archive but explicitly excluded by the policy.
    snapshot_name = f'cpanfile.snapshot.{args.perl_version}'
    locked = set(re.findall(r'^  (\S+)\n', (ROOT / snapshot_name).read_text(), re.M))
    supplied = {path.split('/')[1] for path in new_files if path.startswith('native-cpan/')}
    expected = locked | set(candidate['excludedCpanDistributions'])
    if supplied != expected:
        blockers.append(f'Dependency evidence differs from snapshot/policy: missing={sorted(expected - supplied)}, extra={sorted(supplied - expected)}')
    candidate['payloadIdentity'] = notices.payload_identity(inventory)
    for key, artifact in [('prefixSha256', 'prefix'), ('configSha256', 'config'), ('evidenceSha256', 'notices')]:
        candidate[key] = artifacts[artifact]['sha256']
    result.update(baseline=str(baseline), changes=changes, blockers=blockers,
                  evidenceDiff=str(destination / 'evidence.diff'))
    if blockers:
        result['status'] = 'needs-review'
        write_json(destination / 'incomplete.json', candidate)
        write_json(report, result)
        print(f'Review needed: {report}\n' + '\n'.join(blockers), file=sys.stderr)
        return 1
    # This is a proposal, not approval: the committed inventory stays untouched.
    write_json(candidate_path, candidate)
    result['status'] = 'verification-pending'
    write_json(report, result)
    run(*prepare, '--notice-policy', candidate_path)
    for test in ('t/test_runtime_notices.py', 't/test_compact_notices.py', 't/test_licence_review.py'):
        run(sys.executable, '-B', ROOT / test)
    run('node', '--test', *sorted((ROOT / 't.js').glob('*.test.mjs')))
    tarballs = destination / 'tarball'
    tarballs.mkdir(exist_ok=True)
    packed = run('npm', 'pack', package, '--pack-destination', tarballs, '--json', '--ignore-scripts',
                 '--cache', destination / 'npm-cache', capture_output=True, text=True)
    pack_json = tarballs / 'pack.json'
    pack_json.write_text(packed.stdout)
    tarball = tarballs / json.loads(packed.stdout)[0]['filename']
    run('node', ROOT / 'tools/check-npm-size.mjs', tarball, pack_json)
    result['status'] = 'verified-proposal'
    result['candidate'] = str(candidate_path)
    result['candidateSha256'] = notices.digest(candidate_path.read_bytes())
    result['manifestSha256'] = notices.digest(manifest_path.read_bytes())
    result['policySha256'] = notices.digest(policy_path.read_bytes())
    result['note'] = 'Inspect evidence.diff for additional notices before adopting; unchanged selected excerpts do not prove absence of new obligations.'
    write_json(report, result)
    print(f'Verified proposal: {candidate_path}\nReview report: {report}\nCommitted inventory unchanged.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.CalledProcessError, KeyError) as error:
        print(f'Licence review failed: {error}', file=sys.stderr)
        sys.exit(1)
