#!/usr/bin/env python3
"""Build a reviewable policy from Git-tracked, explicitly reviewed source trees."""

import argparse
import hashlib
import json
import subprocess


def tracked_content(root):
    files = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z']).decode().split('\0')
    return {
        name: subprocess.check_output(['git', '-C', str(root), 'show', ':' + name])
        for name in files if name
    }


def build(himmelsteil, luckydice):
    hfiles, lfiles = tracked_content(himmelsteil), tracked_content(luckydice)
    hscopes = ['server/directus/', 'server/preview/']
    hpolicy = {}
    for name, content in hfiles.items():
        if not any(name.startswith(scope) for scope in hscopes):
            continue
        mutable = name.endswith(('.mjs', '.md')) or name in {
            'server/directus/contact-service/package.json',
            'server/directus/contact-service/package-lock.json',
        }
        hpolicy[name] = None if mutable else hashlib.sha256(content).hexdigest()
    lpolicy = {}
    for name, content in lfiles.items():
        if '/' in name:
            continue
        mutable = name.endswith(('.mjs', '.md')) or name in {'schema.json', 'seed.json'}
        lpolicy[name] = None if mutable else hashlib.sha256(content).hexdigest()
    return {'version': 1, 'repositories': {
        'himmelsteil_backend': {
            'scopes': hscopes, 'files': hpolicy,
            'required': ['server/directus/contact-service/server.mjs', 'server/directus/contact-service/package.json', 'server/directus/contact-service/package-lock.json'],
        },
        'luckydice-backend': {
            'scopes': [''], 'files': lpolicy,
            'required': ['setup.mjs', 'setup-collection-navigation.mjs', 'server.mjs', 'schema.json', 'seed.json', 'sync-content.mjs'],
        },
        'himmelsteil_frontend': {
            'scopes': [], 'files': {},
            'required': ['dist/index.html', 'package.json', 'content/cms-fallback.json', 'scripts/build-directus-site.mjs', 'scripts/check-site.mjs'],
        },
        'luckydice-frontend': {
            'scopes': [], 'files': {}, 'required': ['dist/index.html', 'dist/assets/content.js'],
        },
    }}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('himmelsteil')
    parser.add_argument('luckydice')
    args = parser.parse_args()
    print(json.dumps(build(args.himmelsteil, args.luckydice), indent=2, sort_keys=True))
