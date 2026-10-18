import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('verify', Path(__file__).with_name('verify-release.py'))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
REPO = 'luckydice-backend'
FIXED = b'services: {}\n'


def policy():
    repos = {name: {'scopes': [], 'files': {}, 'required': []} for name in verify.REPOSITORIES}
    repos[REPO] = {'scopes': [''], 'required': ['server.mjs'], 'files': {
        'compose.yaml': hashlib.sha256(FIXED).hexdigest(), 'server.mjs': None,
    }}
    return {'version': 1, 'repositories': repos}


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root/'source.tar.gz'

    def write_archive(self, entries=None, extras=()):
        if entries is None:
            entries = [('compose.yaml', FIXED), ('server.mjs', b'console.log("app")')]
        with tarfile.open(self.archive, 'w:gz') as archive:
            for name, content in entries:
                info = tarfile.TarInfo(name)
                info.size = len(content)
                archive.addfile(info, io.BytesIO(content))
            for info in extras:
                archive.addfile(info)

    def test_preserves_approved_config_and_accepts_app_updates(self):
        self.write_archive(entries=[('compose.yaml', FIXED), ('server.mjs', b'changed app')])
        destination = self.root/'verified.tar.gz'
        verify.stage_and_verify(REPO, self.archive, destination, policy())
        self.assertEqual(destination.read_bytes(), self.archive.read_bytes())

    def test_rejects_config_changes_and_removes_staged_copy(self):
        self.write_archive(entries=[('compose.yaml', b'privileged: true'), ('server.mjs', b'app')])
        destination = self.root/'verified.tar.gz'
        with self.assertRaisesRegex(ValueError, 'Protected file changed'):
            verify.stage_and_verify(REPO, self.archive, destination, policy())
        self.assertFalse(destination.exists())

    def test_rejects_extra_compose_override_or_env(self):
        for name in ['compose.override.yaml', '.env', 'docker-compose.override.yml']:
            with self.subTest(name=name):
                self.write_archive(entries=[('compose.yaml', FIXED), ('server.mjs', b'app'), (name, b'new config')])
                with self.assertRaisesRegex(ValueError, 'Unapproved deployed file'):
                    verify.verify_archive(REPO, self.archive, policy())

    def test_rejects_missing_protected_or_required_file(self):
        for entries in [[('server.mjs', b'app')], [('compose.yaml', FIXED)]]:
            self.write_archive(entries=entries)
            with self.assertRaisesRegex(ValueError, 'missing'):
                verify.verify_archive(REPO, self.archive, policy())

    def test_rejects_duplicate_and_traversal_paths(self):
        for name in ['server.mjs', './server.mjs', '../escape', '/etc/escape', 'bad\\path', 'bad\npath']:
            with self.subTest(name=name):
                self.write_archive(entries=[('compose.yaml', FIXED), ('server.mjs', b'app'), (name, b'evil')])
                with self.assertRaises(ValueError):
                    verify.verify_archive(REPO, self.archive, policy())

    def test_rejects_symlink_hardlink_fifo_and_setuid(self):
        for kind in [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.DIRTYPE]:
            info = tarfile.TarInfo('host')
            info.type = kind
            info.linkname = '/etc'
            if kind == tarfile.DIRTYPE:
                info.mode = 0o4755
            self.write_archive(extras=[info])
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                verify.verify_archive(REPO, self.archive, policy())

    def test_archive_size_and_count_limits(self):
        self.write_archive()
        for name, value in [('MAX_MEMBERS', 1), ('MAX_CONTENT', 1), ('MAX_FILE', 1)]:
            with self.subTest(limit=name), patch.object(verify, name, value), self.assertRaises(ValueError):
                verify.verify_archive(REPO, self.archive, policy())
        with patch.object(verify, 'MAX_COMPRESSED', 1), self.assertRaises(ValueError):
            verify.stage_and_verify(REPO, self.archive, self.root/'dest', policy())

    def test_does_not_overwrite_existing_staging_file(self):
        self.write_archive()
        destination = self.root/'existing'
        destination.write_bytes(b'keep')
        with self.assertRaises(FileExistsError):
            verify.stage_and_verify(REPO, self.archive, destination, policy())
        self.assertEqual(destination.read_bytes(), b'keep')

    def test_rejects_file_used_as_directory(self):
        document = policy()
        document['repositories'][REPO]['files']['folder'] = None
        self.write_archive(entries=[('compose.yaml', FIXED), ('server.mjs', b'app'), ('folder', b'app'), ('folder/child', b'app')])
        with self.assertRaisesRegex(ValueError, 'directory'):
            verify.verify_archive(REPO, self.archive, document)

    def test_loads_versioned_policy_and_rejects_missing_repositories(self):
        target = self.root/'policy.json'
        target.write_text(json.dumps(policy()))
        self.assertEqual(verify.load_policy(target, require_root=False), policy())
        target.write_text(json.dumps({'version': 1, 'repositories': {}}))
        with self.assertRaises(ValueError):
            verify.load_policy(target, require_root=False)

    @unittest.skipUnless(os.name == 'posix', 'POSIX symlink checks required')
    def test_rejects_symlink_source_and_policy(self):
        self.write_archive()
        link = self.root/'link'
        link.symlink_to(self.archive)
        with self.assertRaises(OSError):
            verify.stage_and_verify(REPO, link, self.root/'dest', policy())
        with self.assertRaises(OSError):
            verify.load_policy(link, require_root=False)


if __name__ == '__main__':
    unittest.main()
