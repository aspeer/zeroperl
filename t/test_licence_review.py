#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import tempfile
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('licence_review', ROOT / 'tools/licence-review.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class LicenceReviewTest(unittest.TestCase):
    def fixture(self):
        old = b'old code\nCopyright Alice\nPermission granted.\nend code\n'
        excerpt = b'Copyright Alice\nPermission granted.\n'
        start = old.index(excerpt)
        path = 'native-cpan/Example-1.0/lib/Example.pm'
        policy = {'components': ['Example-1.0'], 'sources': [
            {'location': 'evidence', 'path': path, 'component': 'Example-1.0',
             'sha256': review.notices.digest(old), 'ranges': [[start, start + len(excerpt)]]}]}
        return policy, path, old

    def test_version_change_and_shifted_unchanged_notice(self):
        policy, path, old = self.fixture()
        new_path = path.replace('1.0', '1.1')
        new = old.replace(b'old code', b'new, longer code')
        candidate, blockers, changes, diff = review.propose(policy, {path: old}, {new_path: new}, ROOT)
        self.assertEqual(blockers, [])
        self.assertEqual(candidate['components'], ['Example-1.1'])
        source = candidate['sources'][0]
        begin, end = source['ranges'][0]
        self.assertEqual(new[begin:end], b'Copyright Alice\nPermission granted.\n')
        self.assertEqual(source['sha256'], review.notices.digest(new))
        self.assertIn('new, longer code', diff)
        self.assertEqual(policy['components'], ['Example-1.0'])

    def test_changed_notice_blocks(self):
        policy, path, old = self.fixture()
        _, blockers, _, _ = review.propose(policy, {path: old}, {path: old.replace(b'Alice', b'Bob')}, ROOT)
        self.assertTrue(any('text changed' in item for item in blockers))

    def test_new_distribution_and_new_evidence_block(self):
        policy, path, old = self.fixture()
        new = {path: old, 'native-cpan/New-1.0/LICENSE': b'New terms'}
        _, blockers, _, _ = review.propose(policy, {path: old}, new, ROOT)
        self.assertTrue(any('New distribution' in item for item in blockers))
        self.assertTrue(any('added/removed' in item for item in blockers))

    def test_added_notice_in_existing_file_is_in_report(self):
        policy, path, old = self.fixture()
        _, _, _, diff = review.propose(policy, {path: old}, {path: old + b'Additional copyright Bob\n'}, ROOT)
        self.assertIn('+Additional copyright Bob', diff)

    def test_untrusted_baseline_source_blocks(self):
        policy, path, old = self.fixture()
        _, blockers, _, _ = review.propose(policy, {path: old + b'tampered'}, {path: old}, ROOT)
        self.assertTrue(any('Baseline source' in item for item in blockers))

    def test_ambiguous_excerpt_blocks(self):
        with self.assertRaisesRegex(ValueError, 'more than once'):
            review.relocate(b'Grant', b'Grant and Grant', [[0, 5]])

    def test_changed_repository_notice_blocks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'LICENSE').write_bytes(b'New licence')
            policy = {'components': ['A'], 'sources': [{'location': 'repository',
                      'component': 'A', 'path': 'LICENSE', 'sha256': review.notices.digest(b'Old licence')}]}
            _, blockers, _, _ = review.propose(policy, {}, {}, root)
            self.assertTrue(any('Repository notice' in item for item in blockers))

    def test_adoption_rejects_changed_inputs_and_allows_repeat(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate, manifest, policy = [root / name for name in ('candidate', 'manifest', 'policy')]
            for path in (candidate, manifest, policy):
                path.write_text(path.name)
            report = {'status': 'verified-proposal', 'blockers': [],
                      'candidateSha256': review.notices.digest(candidate.read_bytes()),
                      'manifestSha256': review.notices.digest(manifest.read_bytes()),
                      'policySha256': review.notices.digest(policy.read_bytes())}
            review.check_adoption(report, candidate, manifest, policy)
            for path in (candidate, manifest, policy):
                original = path.read_bytes()
                path.write_bytes(b'changed')
                with self.assertRaises(ValueError):
                    review.check_adoption(report, candidate, manifest, policy)
                path.write_bytes(original)
            policy.write_bytes(candidate.read_bytes())
            review.check_adoption(report, candidate, manifest, policy)
            report['blockers'] = ['needs review']
            with self.assertRaises(ValueError):
                review.check_adoption(report, candidate, manifest, policy)

    def test_commit_target_preserves_unrelated_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def run(*args, check=True):
                return subprocess.run(args, cwd=root, check=check, capture_output=True, text=True)
            run('git', 'init', '-q')
            run('git', 'config', 'user.email', 'test@example.invalid')
            run('git', 'config', 'user.name', 'Test')
            (root / 'release').mkdir()
            (root / 'release/defaults.mk').write_text('PERL_VERSION ?= 5.44.0\n')
            (root / 'Makefile').write_bytes((ROOT / 'Makefile').read_bytes())
            (root / 'tools').mkdir()
            (root / 'tools/licence-review.py').write_text("from pathlib import Path\nPath('policy').write_text('adopted')\n")
            (root / 'policy').write_text('old')
            (root / 'unrelated').write_text('old')
            run('git', 'add', '.')
            run('git', 'commit', '-qm', 'initial')
            (root / 'unrelated').write_text('user changes')
            run('git', 'add', 'unrelated')
            blocked = run('make', 'licence-commit', 'LICENCE_COMMIT_FILES=policy', check=False)
            self.assertNotEqual(blocked.returncode, 0)
            self.assertEqual((root / 'policy').read_text(), 'old')
            run('git', 'reset', '-q', 'HEAD', 'unrelated')
            run('make', 'licence-commit', 'LICENCE_COMMIT_FILES=policy')
            self.assertEqual(run('git', 'show', 'HEAD:policy').stdout, 'adopted')
            self.assertEqual(run('git', 'show', 'HEAD:unrelated').stdout, 'old')
            self.assertEqual((root / 'unrelated').read_text(), 'user changes')
            head = run('git', 'rev-parse', 'HEAD').stdout
            run('make', 'licence-commit', 'LICENCE_COMMIT_FILES=policy')
            self.assertEqual(run('git', 'rev-parse', 'HEAD').stdout, head)


if __name__ == '__main__':
    unittest.main()
