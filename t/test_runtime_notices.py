#!/usr/bin/env python3
import copy
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('runtime_notices', ROOT / 'tools/runtime-notices.py')
notices = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notices)


class RuntimeNoticesTest(unittest.TestCase):
    def test_exact_excerpts_deduplication_and_stale_review_rejection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'evidence.tar.gz'
            licence = b'Copyright Alice\n\nPermission to redistribute.\nAll conditions and warranty text.\n'
            data = b'Unneeded source code\n' + licence + b'More source code\n'
            with tarfile.open(archive, 'w:gz') as tar:
                info = tarfile.TarInfo('third-party-notices/source.c')
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
            (root / 'build-input').write_text('original')
            inventory = {'Module.pm': 'code', 'Config_heavy.pl': 'host-configuration', '.meta/Example-1.0/install.json': 'host-paths'}
            manifest = {'perlVersion': '5.44.0', 'artifacts': {'notices': {'sha256': notices.digest(archive.read_bytes())}}}
            policy = {'schemaVersion': 1, 'perlVersion': '5.44.0', 'profile': {},
                      'payloadIdentity': notices.payload_identity(inventory),
                      'buildInputs': {'build-input': notices.digest(b'original')},
                      'components': ['A', 'B'], 'sources': [
                          {'location': 'evidence', 'path': 'source.c', 'sha256': notices.digest(data),
                           'component': name, 'ranges': [[len(b'Unneeded source code\n'), len(b'Unneeded source code\n') + len(licence)]]}
                          for name in ['A', 'B']]}
            policy_path = root / 'policy.json'
            output = root / 'NOTICES.txt'

            def render(value=policy, build=manifest, files=inventory):
                policy_path.write_text(json.dumps(value))
                notices.render(archive, policy_path, build, output, root, files)

            render()
            result = output.read_text()
            self.assertEqual(result.count('Copyright Alice'), 1)
            self.assertIn(licence.decode().strip(), result)
            self.assertIn('Applies to: A; B', result)
            self.assertNotIn('Unneeded source code', result)
            modified = {**inventory, 'New.pm': 'new-module'}
            with self.assertRaisesRegex(ValueError, 'stale'):
                render(files=modified)
            with self.assertRaisesRegex(ValueError, 'stale'):
                render(files={**inventory, 'Module.pm': 'changed-module'})
            render(files={**inventory, 'Config_heavy.pl': 'different-host', '.meta/Example-1.0/install.json': 'different-host'})
            self.assertEqual(output.read_text(), result)
            for field in ['sha256', 'ranges']:
                changed = copy.deepcopy(policy)
                changed['sources'][0][field] = 'wrong' if field == 'sha256' else [[0, len(data) + 1]]
                with self.assertRaises(ValueError):
                    render(changed)
            changed = copy.deepcopy(policy)
            changed['components'].append('Unreviewed component')
            with self.assertRaisesRegex(ValueError, 'coverage'):
                render(changed)
            (root / 'build-input').write_text('new static library')
            with self.assertRaisesRegex(ValueError, 'stale'):
                render()
            (root / 'build-input').write_text('original')
            archive.write_bytes(b'changed evidence')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                render()


if __name__ == '__main__':
    unittest.main()
