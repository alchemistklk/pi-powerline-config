#!/usr/bin/env python3
"""Install the shared footer without copying account or service credentials."""
import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    kit = Path(__file__).resolve().parent
    agent = Path.home() / '.pi' / 'agent'
    target = agent / 'local-packages' / 'pi-powerline-shared'
    settings_path = agent / 'settings.json'
    settings = json.loads(settings_path.read_text()) if settings_path.exists() else {}
    if not isinstance(settings, dict):
        raise SystemExit('settings.json must contain an object')
    patch = json.loads((kit / 'settings.patch.json').read_text())
    style = json.loads((kit / 'powerline-style.json').read_text())
    packages = settings.get('packages', [])
    if not isinstance(packages, list):
        raise SystemExit('settings.json must contain an object and a packages list')

    def is_powerline(entry):
        source = entry.get('source', '') if isinstance(entry, dict) else entry
        if not isinstance(source, str):
            return False
        return source == 'npm:pi-powerline' or source.startswith('npm:pi-powerline@') or Path(source.rstrip('/')).name in {'pi-powerline', 'pi-powerline-shared'}

    settings['packages'] = [entry for entry in packages if not is_powerline(entry)] + [str(target)]
    settings.update(patch)
    print('Plugin:', target)
    print('Updated display settings:', ', '.join(patch))
    if args.dry_run:
        print('Dry run: no files changed')
        return
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup = agent / 'backups' / ('pi-footer-' + stamp)
    backup.mkdir(parents=True)
    for name in ['settings.json', 'powerline-style.json']:
        original = agent / name
        if original.exists():
            shutil.copy2(original, backup / name)
    if target.exists():
        shutil.move(str(target), str(backup / 'pi-powerline-shared'))
    shutil.copytree(kit / 'pi-powerline', target)
    (agent / 'powerline-style.json').write_text(json.dumps(style, ensure_ascii=False, indent=2) + '\n')
    settings_path.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + '\n')
    print('Installed. Backup:', backup)
    print('Restart Pi or run /reload. Use a Nerd Font in your terminal.')


if __name__ == '__main__':
    main()
