#!/usr/bin/python3 -I
"""Copy a bounded release into root's staging area and verify its policy."""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import tarfile

POLICY = Path('/etc/lucky-deploy/release-policy.json')
REPOSITORIES = frozenset({
    'himmelsteil_backend', 'himmelsteil_frontend',
    'luckydice-backend', 'luckydice-frontend',
})
MAX_COMPRESSED = 256 * 1024 * 1024
MAX_CONTENT = 1024 * 1024 * 1024
MAX_MEMBERS = 20000
MAX_FILE = 128 * 1024 * 1024


def safe_path(name):
    path = PurePosixPath(name)
    if (not name or '\\' in name or any(ord(c) < 32 for c in name)
            or path.is_absolute() or '..' in path.parts or str(path) == '.'):
        raise ValueError('Unsafe archive path')
    return str(path)


def load_policy(path, require_root=True):
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    fd = os.open(path, flags)
    with os.fdopen(fd, 'rb') as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 1024 * 1024:
            raise ValueError('Invalid release policy file')
        if require_root and (info.st_uid != 0 or info.st_mode & 0o022):
            raise ValueError('Release policy must be root-owned and not writable by others')
        document = json.loads(source.read(1024 * 1024 + 1))
    if document.get('version') != 1 or set(document.get('repositories', {})) != REPOSITORIES:
        raise ValueError('Invalid release policy schema')
    return document


def in_scope(name, scopes):
    return any((scope == '' and '/' not in name) or (scope and name.startswith(scope)) for scope in scopes)


def verify_archive(repo, archive_path, document):
    if repo not in REPOSITORIES:
        raise ValueError('Unknown repository')
    rule = document['repositories'][repo]
    fixed = {name: digest for name, digest in rule['files'].items() if digest is not None}
    required = set(fixed) | set(rule['required'])
    seen, files = set(), set()
    total = 0
    with tarfile.open(archive_path, mode='r:gz') as archive:
        for member in archive:
            if len(seen) >= MAX_MEMBERS:
                raise ValueError('Too many archive members')
            name = safe_path(member.name)
            if name in seen:
                raise ValueError('Duplicate archive path')
            seen.add(name)
            if not (member.isfile() or member.isdir()) or member.issparse():
                raise ValueError('Links and special archive members are forbidden')
            if member.mode & 0o6000:
                raise ValueError('Setuid and setgid archive modes are forbidden')
            if not member.isfile():
                continue
            if member.size < 0 or member.size > MAX_FILE:
                raise ValueError('Archive member too large')
            total += member.size
            if total > MAX_CONTENT:
                raise ValueError('Uncompressed release too large')
            files.add(name)
            if in_scope(name, rule['scopes']) and name not in rule['files']:
                raise ValueError('Unapproved deployed file: ' + name)
            if name in fixed:
                digest = hashlib.sha256()
                with archive.extractfile(member) as content:
                    while chunk := content.read(64 * 1024):
                        digest.update(chunk)
                if digest.hexdigest() != fixed[name]:
                    raise ValueError('Protected file changed: ' + name)
    if required - files:
        raise ValueError('Required or protected release files are missing')
    for name in files:
        if any(str(parent) in files for parent in PurePosixPath(name).parents if str(parent) != '.'):
            raise ValueError('File used as an archive directory')


def stage_and_verify(repo, source_path, destination_path, document):
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    fd = os.open(source_path, flags)
    created = False
    try:
        with os.fdopen(fd, 'rb') as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_COMPRESSED:
                raise ValueError('Release must be a bounded regular file')
            output_fd = os.open(destination_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
            created = True
            with os.fdopen(output_fd, 'wb') as destination:
                remaining = info.st_size
                while remaining:
                    chunk = source.read(min(remaining, 64 * 1024))
                    if not chunk:
                        raise ValueError('Release changed while staging')
                    destination.write(chunk)
                    remaining -= len(chunk)
                if source.read(1):
                    raise ValueError('Release grew while staging')
                destination.flush()
                os.fsync(destination.fileno())
        verify_archive(repo, destination_path, document)
    except BaseException:
        if created:
            Path(destination_path).unlink(missing_ok=True)
        raise


def main():
    if sys.platform != 'linux' or os.geteuid() != 0 or len(sys.argv) != 4:
        raise ValueError('Usage as root: lucky-verify-release repository source destination')
    import resource
    # Limits apply only to this verifier process, not to the deployment shell.
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
    repo, source, destination = sys.argv[1:]
    if repo not in REPOSITORIES:
        raise ValueError('Unknown repository')
    parent = Path(destination).parent
    info = parent.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise ValueError('Destination must be inside a private root staging directory')
    stage_and_verify(repo, source, destination, load_policy(POLICY))
    print('Release policy verified')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, tarfile.TarError, MemoryError):
        print('Release rejected by protected-file or archive policy.', file=sys.stderr)
        sys.exit(1)
