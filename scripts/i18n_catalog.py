"""Read and write the split translation catalog in src/i18n/ from Python curate scripts.

load(root) returns the merged {"en-US": {...}, "zh-TW": {...}} map. save(root, tr, area) writes it back:
an existing key stays in the file that holds it, a new key goes to src/i18n/<area>.json, a removed key is dropped.
"""
import json
from pathlib import Path


def _files(root):
    return sorted((Path(root) / 'src/i18n').glob('*.json'))


def load(root):
    merged = {}
    for path in _files(root):
        for language, entries in json.loads(path.read_text()).items():
            merged.setdefault(language, {}).update(entries)
    return merged


def save(root, tr, area):
    files = {path: json.loads(path.read_text()) for path in _files(root)}
    target = Path(root) / 'src/i18n' / f'{area}.json'
    if target not in files:
        raise SystemExit(f'{target} does not exist; add it and its import in src/i18n/index.js first')
    owner = {}
    for path, data in files.items():
        for language, entries in data.items():
            for key in list(entries):
                if key in tr.get(language, {}):
                    entries[key] = tr[language][key]
                    owner[(language, key)] = path
                else:
                    del entries[key]
    for language, entries in tr.items():
        for key, value in entries.items():
            if (language, key) not in owner:
                files[target].setdefault(language, {})[key] = value
    for path, data in files.items():
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
