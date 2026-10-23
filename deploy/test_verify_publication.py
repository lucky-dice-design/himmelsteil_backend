import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publication', Path(__file__).with_name('verify-publication.py'))
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'index.html').write_text('<h1>Site</h1>')

    def test_accepts_regular_website_and_well_known_directory(self):
        assets = self.root/'assets'
        assets.mkdir()
        (assets/'site.css').write_text('body {}')
        known = self.root/'.well-known'
        known.mkdir()
        (known/'example.txt').write_text('public')
        publication.validate_tree(self.root)

    def test_rejects_missing_or_empty_homepage(self):
        (self.root/'index.html').write_text('')
        with self.assertRaises(ValueError):
            publication.validate_tree(self.root)
        (self.root/'index.html').unlink()
        with self.assertRaises(FileNotFoundError):
            publication.validate_tree(self.root)

    def test_rejects_private_metadata_anywhere(self):
        for name in ['.env', '.git', '.cms-live-state.json', '.DS_Store']:
            with self.subTest(name=name):
                target = self.root/name
                target.write_text('private')
                with self.assertRaisesRegex(ValueError, 'Hidden'):
                    publication.validate_tree(self.root)
                target.unlink()
        known = self.root/'.well-known'
        known.mkdir()
        (known/'.secret').write_text('private')
        with self.assertRaisesRegex(ValueError, 'Hidden'):
            publication.validate_tree(self.root)

    def test_entry_and_size_limits(self):
        for name, limit in [('MAX_ENTRIES', 0), ('MAX_FILE', 1), ('MAX_TOTAL', 1)]:
            with self.subTest(name=name), patch.object(publication, name, limit), self.assertRaises(ValueError):
                publication.validate_tree(self.root)

    def test_rejects_filesystem_boundary(self):
        original = publication.Path.lstat
        root_device = self.root.lstat().st_dev

        def altered(path, *args, **kwargs):
            info = original(path, *args, **kwargs)
            if path == self.root/'index.html':
                fields = list(info)
                fields[2] = root_device + 1
                return os.stat_result(fields)
            return info

        with patch.object(publication.Path, 'lstat', altered), self.assertRaisesRegex(ValueError, 'filesystem'):
            publication.validate_tree(self.root)

    def test_private_state_must_be_nonempty_and_bounded(self):
        state = self.root/'state.json'
        state.write_text('{}')
        publication.regular_file(state, 8, nonempty=True)
        with self.assertRaises(ValueError):
            publication.regular_file(state, 1, nonempty=True)
        state.write_text('')
        with self.assertRaises(ValueError):
            publication.regular_file(state, 8, nonempty=True)
        with self.assertRaises(ValueError):
            publication.regular_file(self.root, 8)

    @unittest.skipUnless(os.name == 'posix', 'POSIX links required')
    def test_rejects_symlink_roots_files_directories_and_state(self):
        link = self.root/'link'
        link.symlink_to(self.root/'index.html')
        with self.assertRaises(ValueError):
            publication.validate_tree(self.root)
        with self.assertRaises(ValueError):
            publication.regular_file(link, 1024)
        link.unlink()
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            publication.validate_tree(link)
        with self.assertRaises(ValueError):
            publication.validate_tree(self.root)

    @unittest.skipUnless(hasattr(os, 'link'), 'Hardlinks required')
    def test_rejects_hardlinks_to_private_state(self):
        state = self.root/'private.json'
        state.write_text('private')
        link = self.root/'public.json'
        os.link(state, link)
        with self.assertRaises(ValueError):
            publication.validate_tree(self.root)
        with self.assertRaises(ValueError):
            publication.regular_file(state, 1024)

    @unittest.skipUnless(os.name == 'posix', 'POSIX special files required')
    def test_rejects_fifo_and_setuid_modes(self):
        fifo = self.root/'fifo'
        os.mkfifo(fifo)
        with self.assertRaises(ValueError):
            publication.validate_tree(self.root)
        fifo.unlink()
        (self.root/'index.html').chmod(0o4755)
        with self.assertRaises(ValueError):
            publication.validate_tree(self.root)

    def test_does_not_change_existing_files(self):
        before = (self.root/'index.html').read_bytes()
        publication.validate_tree(self.root)
        self.assertEqual((self.root/'index.html').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
