#!/usr/bin/python3 -I
"""Validate stopped-build output before root publishes it or copies state."""

import os
from pathlib import Path
import stat
import sys

MAX_ENTRIES = 20000
MAX_FILE = 128 * 1024 * 1024
MAX_TOTAL = 1024 * 1024 * 1024
MAX_STATE = 8 * 1024 * 1024


def regular_file(path, limit, nonempty=False):
    info = Path(path).lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError('Expected a regular file without links')
    if info.st_mode & 0o6000 or info.st_size > limit or (nonempty and info.st_size == 0):
        raise ValueError('Unsafe file mode or size')
    return info


def validate_tree(root):
    root = Path(root)
    root_info = root.lstat()
    if not stat.S_ISDIR(root_info.st_mode) or root_info.st_mode & 0o6000:
        raise ValueError('Publication root must be a real directory')
    regular_file(root/'index.html', MAX_FILE, nonempty=True)
    pending = [root]
    entries = 0
    size = 0
    while pending:
        directory = pending.pop()
        with os.scandir(directory) as children:
            for child in children:
                entries += 1
                if entries > MAX_ENTRIES:
                    raise ValueError('Too many publication entries')
                relative = Path(child.path).relative_to(root)
                if any(ord(c) < 32 for c in child.name):
                    raise ValueError('Unsafe publication filename')
                if child.name.startswith('.') and relative.parts != ('.well-known',):
                    raise ValueError('Hidden build or secret metadata in publication')
                # Use the same lstat API as for the root (DirEntry caches can
                # omit device identifiers on Windows during local tests).
                info = Path(child.path).lstat()
                if info.st_dev != root_info.st_dev:
                    raise ValueError('Publication crosses a filesystem boundary')
                if stat.S_ISDIR(info.st_mode):
                    if info.st_mode & 0o6000:
                        raise ValueError('Unsafe directory mode')
                    pending.append(Path(child.path))
                else:
                    info = regular_file(child.path, MAX_FILE)
                    size += info.st_size
                    if size > MAX_TOTAL:
                        raise ValueError('Publication is too large')


def main():
    if sys.platform != 'linux' or os.geteuid() != 0 or len(sys.argv) != 3:
        raise ValueError('Run as root: lucky-verify-publication --tree directory | --state file')
    mode, target = sys.argv[1:]
    if mode == '--tree':
        validate_tree(target)
        print('Publication tree verified')
    elif mode == '--state':
        regular_file(target, MAX_STATE, nonempty=True)
        print('Publication state verified')
    else:
        raise ValueError('Unknown publication check')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError):
        print('Publication output rejected: unsafe links, file types, names or limits.', file=sys.stderr)
        sys.exit(1)
