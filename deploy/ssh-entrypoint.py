#!/usr/bin/python3 -I
"""Root-owned forced SSH command, executed as the unprivileged deploy user."""

import contextlib
import hashlib
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys

BASE = Path('/home/github-deploy/deploy-incoming')
ENABLE_FILE = Path('/etc/lucky-deploy-ssh-enabled')
REPOSITORIES = frozenset({
    'himmelsteil_backend', 'himmelsteil_frontend',
    'luckydice-backend', 'luckydice-frontend',
})
MAX_UPLOAD = 256 * 1024 * 1024
MAX_STORAGE = 1024 * 1024 * 1024
MAX_REVISIONS = 16


def parse_command(command):
    if command == 'status':
        return ('status',)
    parts = command.split(' ')
    if len(parts) not in (3, 5) or parts[0] not in ('upload', 'deploy'):
        raise ValueError('Command rejected')
    action, repo, revision = parts[:3]
    if repo not in REPOSITORIES or not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('Command rejected')
    if action == 'deploy' and len(parts) == 3:
        return (action, repo, revision)
    if action != 'upload' or len(parts) != 5:
        raise ValueError('Command rejected')
    length, digest = parts[3:]
    if not re.fullmatch(r'[1-9][0-9]{0,8}', length):
        raise ValueError('Invalid upload length')
    if int(length) > MAX_UPLOAD or not re.fullmatch(r'[0-9a-f]{64}', digest):
        raise ValueError('Invalid upload length or digest')
    return (action, repo, revision, int(length), digest)


def receive_stream(source, destination, length, expected_digest):
    digest = hashlib.sha256()
    remaining = length
    while remaining:
        chunk = source.read(min(remaining, 64 * 1024))
        if not chunk:
            raise ValueError('Incomplete upload')
        destination.write(chunk)
        digest.update(chunk)
        remaining -= len(chunk)
    if source.read(1):
        raise ValueError('Upload exceeds declared length')
    if digest.hexdigest() != expected_digest:
        raise ValueError('Upload digest mismatch')


def open_directory(name, parent=None, create=False):
    if create:
        try:
            os.mkdir(name, 0o700, dir_fd=parent)
        except FileExistsError:
            pass
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    info = os.fstat(fd)
    if info.st_uid != os.getuid() or info.st_mode & 0o077:
        os.close(fd)
        raise ValueError('Upload directory must be private and owned by deploy user')
    return fd


def deployment_enabled(repo, enable_file=ENABLE_FILE):
    try:
        fd = os.open(enable_file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return False
    with os.fdopen(fd, 'r', encoding='ascii') as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_size > 4096:
            raise ValueError('Unsafe deployment enable file')
        enabled = set(file.read(4097).splitlines())
    if not enabled <= REPOSITORIES:
        raise ValueError('Invalid deployment enable file')
    return repo in enabled


def check_capacity(base, repo_fd, length):
    # All writes are serialized below. Do not follow links in quota accounting.
    total = 0
    for directory, _, files in os.walk(base, followlinks=False):
        for name in files:
            total += os.lstat(Path(directory) / name).st_size
    if total + length > MAX_STORAGE:
        raise ValueError('Upload storage limit reached; administrator cleanup required')
    if len(os.listdir(repo_fd)) > MAX_REVISIONS:
        raise ValueError('Release count limit reached; administrator cleanup required')


def store_upload(command, source, base=BASE):
    _, repo, revision, length, digest = command
    with contextlib.ExitStack() as stack:
        base_fd = open_directory(base)
        stack.callback(os.close, base_fd)
        repo_fd = open_directory(repo, base_fd, create=True)
        stack.callback(os.close, repo_fd)
        # Refuse a new revision before creating its directory if the limit is hit.
        names = os.listdir(repo_fd)
        if revision not in names and len(names) >= MAX_REVISIONS:
            raise ValueError('Release count limit reached; administrator cleanup required')
        check_capacity(base, repo_fd, length)
        revision_fd = open_directory(revision, repo_fd, create=True)
        stack.callback(os.close, revision_fd)
        # Exclusive temporary names and dir_fd keep a failed upload from replacing
        # the previous release. No uploaded archive is extracted by this program.
        name = '.upload-' + os.urandom(16).hex()
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=revision_fd)
        try:
            with os.fdopen(fd, 'wb') as destination:
                receive_stream(source, destination, length, digest)
                destination.flush()
                os.fsync(destination.fileno())
            os.replace(name, 'release.tar.gz', src_dir_fd=revision_fd, dst_dir_fd=revision_fd)
        finally:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(name, dir_fd=revision_fd)


def deadline(_signum, _frame):
    raise TimeoutError('Upload timed out')


def run_deployment(repo, revision):
    if not deployment_enabled(repo):
        raise ValueError('Deployment is not enabled for this repository')
    result = subprocess.run(
        ['/usr/bin/sudo', '-n', '--', '/usr/local/sbin/deploy-' + repo, revision],
        stdin=subprocess.DEVNULL, check=False,
        env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'},
    )
    return result.returncode


def main():
    if sys.platform != 'linux' or os.getuid() == 0:
        raise ValueError('Run as the unprivileged Linux deployment user')
    os.umask(0o077)
    command = parse_command(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    if command[0] == 'status':
        print('Restricted deployment SSH entrypoint ready (protocol 1)')
        return 0
    import fcntl
    with contextlib.ExitStack() as stack:
        base_fd = open_directory(BASE)
        stack.callback(os.close, base_fd)
        lock_fd = os.open('.ssh.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=base_fd)
        stack.callback(os.close, lock_fd)
        info = os.fstat(lock_fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o077:
            raise ValueError('Unsafe upload lock')
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another upload or deployment is in progress') from None
        if command[0] == 'upload':
            signal.signal(signal.SIGALRM, deadline)
            signal.alarm(120)
            try:
                store_upload(command, sys.stdin.buffer)
            finally:
                signal.alarm(0)
            print('Upload verified')
            return 0
        _, repo, revision = command
        return run_deployment(repo, revision)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, TimeoutError, UnicodeError):
        print('Deployment SSH request rejected; check command, permissions, limits and activation.', file=sys.stderr)
        sys.exit(1)
