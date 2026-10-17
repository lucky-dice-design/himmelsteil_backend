import hashlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('entry', Path(__file__).with_name('ssh-entrypoint.py'))
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)
REV = 'a' * 40
DIGEST = hashlib.sha256(b'release').hexdigest()


class ProtocolTests(unittest.TestCase):
    def test_valid_protocol(self):
        self.assertEqual(entry.parse_command('status'), ('status',))
        for repo in entry.REPOSITORIES:
            self.assertEqual(entry.parse_command(f'deploy {repo} {REV}'), ('deploy', repo, REV))
            self.assertEqual(entry.parse_command(f'upload {repo} {REV} 7 {DIGEST}'), ('upload', repo, REV, 7, DIGEST))

    def test_rejects_shell_paths_whitespace_and_protocol_misuse(self):
        bad = ['', 'sh', '/bin/bash', 'true', 'status\n', 'status extra',
               f'deploy unknown {REV}', f'deploy ../himmelsteil_backend {REV}',
               f'deploy himmelsteil_backend {REV};id', f'deploy himmelsteil_backend {REV}\n',
               f'deploy  himmelsteil_backend {REV}', f'deploy\thimmelsteil_backend\t{REV}',
               f'deploy himmelsteil_backend {REV} extra', f'upload himmelsteil_backend {REV}',
               'internal-sftp', 'scp -t deploy-incoming', 'mkdir -p deploy-incoming']
        for command in bad:
            with self.subTest(command=command), self.assertRaises(ValueError):
                entry.parse_command(command)

    def test_rejects_invalid_lengths_revisions_and_digests(self):
        for size in ['0', '-1', '01', str(entry.MAX_UPLOAD + 1), '99999999999999999999', '1;id']:
            with self.subTest(size=size), self.assertRaises(ValueError):
                entry.parse_command(f'upload himmelsteil_backend {REV} {size} {DIGEST}')
        for revision in ['a'*39, 'a'*41, 'A'*40, '../'+REV]:
            with self.subTest(revision=revision), self.assertRaises(ValueError):
                entry.parse_command(f'deploy himmelsteil_backend {revision}')
        with self.assertRaises(ValueError):
            entry.parse_command(f'upload himmelsteil_backend {REV} 7 {DIGEST[:-1]}')

    def test_stream_digest_and_exact_length(self):
        destination = io.BytesIO()
        entry.receive_stream(io.BytesIO(b'release'), destination, 7, DIGEST)
        self.assertEqual(destination.getvalue(), b'release')
        for data, digest in [(b'releas', DIGEST), (b'releases', DIGEST), (b'release', '0'*64)]:
            with self.subTest(data=data, digest=digest), self.assertRaises(ValueError):
                entry.receive_stream(io.BytesIO(data), io.BytesIO(), 7, digest)

    def test_disabled_deployment_never_calls_sudo(self):
        with patch.object(entry, 'deployment_enabled', return_value=False), patch.object(entry.subprocess, 'run') as run:
            with self.assertRaises(ValueError):
                entry.run_deployment('himmelsteil_backend', REV)
            run.assert_not_called()

    def test_deployment_has_fixed_argv_and_clean_environment(self):
        with patch.object(entry, 'deployment_enabled', return_value=True), patch.object(entry.subprocess, 'run') as run:
            run.return_value.returncode = 7
            self.assertEqual(entry.run_deployment('himmelsteil_backend', REV), 7)
            run.assert_called_once_with(
                ['/usr/bin/sudo', '-n', '--', '/usr/local/sbin/deploy-himmelsteil_backend', REV],
                stdin=entry.subprocess.DEVNULL, check=False,
                env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'},
            )

    @unittest.skipUnless(os.name == 'posix', 'POSIX file flags required')
    def test_deploy_disabled_without_root_activation(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertFalse(entry.deployment_enabled('himmelsteil_backend', Path(tmp)/'missing'))


@unittest.skipUnless(os.name == 'posix', 'POSIX directory descriptors required')
class UploadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.base.chmod(0o700)
        self.command = ('upload', 'himmelsteil_backend', REV, 7, DIGEST)

    def test_atomic_upload_and_failed_retry(self):
        entry.store_upload(self.command, io.BytesIO(b'release'), self.base)
        target = self.base/'himmelsteil_backend'/REV/'release.tar.gz'
        self.assertEqual(target.read_bytes(), b'release')
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(ValueError):
            entry.store_upload(self.command, io.BytesIO(b'bad'), self.base)
        self.assertEqual(target.read_bytes(), b'release')
        self.assertEqual(list(target.parent.iterdir()), [target])

    def test_rejects_symlink_repository(self):
        outside = self.base/'outside'
        outside.mkdir(mode=0o700)
        (self.base/'himmelsteil_backend').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(OSError):
            entry.store_upload(self.command, io.BytesIO(b'release'), self.base)
        self.assertEqual(list(outside.iterdir()), [])

    def test_rejects_nonprivate_directory(self):
        repo = self.base/'himmelsteil_backend'
        repo.mkdir(mode=0o755)
        repo.chmod(0o755)
        with self.assertRaises(ValueError):
            entry.store_upload(self.command, io.BytesIO(b'release'), self.base)

    def test_rejects_storage_and_revision_limits(self):
        with patch.object(entry, 'MAX_STORAGE', 1), self.assertRaises(ValueError):
            entry.store_upload(self.command, io.BytesIO(b'release'), self.base)
        repo = self.base/'himmelsteil_backend'
        with patch.object(entry, 'MAX_REVISIONS', 1):
            (repo/('b'*40)).mkdir(mode=0o700)
            with self.assertRaises(ValueError):
                entry.store_upload(self.command, io.BytesIO(b'release'), self.base)


if __name__ == '__main__':
    unittest.main()
