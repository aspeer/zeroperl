import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('compact', Path(__file__).parents[1] / 'tools/compact-notices.py')
compact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compact)

class NoticesTest(unittest.TestCase):
    def test_comments_and_pod_remain_verbatim(self):
        comment = b'/* Copyright Someone\nPermission to use this software.\nNo warranty. */'
        pod = b'=head1 LICENSE\n\nSame terms as Perl.\n\n= cut is not a terminator\n=cut\n'
        data = comment + b'\nint implementation;\n' + pod
        self.assertEqual(compact.legal_blocks(data), [comment, pod])

    def test_unknown_format_preserves_full_source(self):
        data = b'int code;\nCopyright and license in unfamiliar syntax\nConditions on another line'
        self.assertEqual(compact.legal_blocks(data), [data])

    def test_deduplication_and_integrity(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            payloads = {'perl/Artistic': b'Original complete terms',
                        'native-cpan/A/LICENSE': b'Original complete terms',
                        'perl/a.c': b'/* Copyright A; permission and warranty */\nint implementation;',
                        'wasi-sdk/unused.c': b'Copyright SDK; excluded with separately supplied SDK licenses'}
            records = [{'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for name, data in payloads.items()]
            def archive():
                with tarfile.open(root / 'evidence.tar.gz', 'w:gz') as tar:
                    entries = {**payloads, 'inventory.json': json.dumps({'files': records}).encode()}
                    for name, data in entries.items():
                        item = tarfile.TarInfo('third-party-notices/' + name)
                        item.size = len(data)
                        tar.addfile(item, io.BytesIO(data))
            archive()
            compact.compact(root / 'evidence.tar.gz', root / 'notices.txt')
            result = (root / 'notices.txt').read_bytes()
            self.assertEqual(result.count(b'Original complete terms'), 1)
            self.assertIn(b'perl/Artistic', result)
            self.assertIn(b'native-cpan/A/LICENSE', result)
            self.assertNotIn(b'int implementation;', result)
            self.assertNotIn(b'Copyright SDK;', result)
            payloads['perl/Artistic'] = b'tampered'
            archive()
            with self.assertRaises(ValueError):
                compact.compact(root / 'evidence.tar.gz', root / 'notices.txt')

if __name__ == '__main__':
    unittest.main()
