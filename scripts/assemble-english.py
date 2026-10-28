"""Opt-in, offline post-dist assembly. Never fetch, build statistics, or deploy.

Run ONLY after the existing successful `python -m cmeta dist`.
Sources deliberately live outside site/: adding them there would change JA font subsets.
"""
from pathlib import Path
import hashlib
import re
import shutil
import sys


def assemble(repo):
    repo = Path(repo).resolve()
    source, dist = repo / 'site-en', repo / 'dist'
    target = dist / 'en'
    if target.exists():
        raise SystemExit('Refusing to replace existing dist/en; create a fresh dist first')
    required = ['index.html', 'app.js', 'charts.js', 'speed-share.js', 'site.webmanifest']
    shared = ['index.html', 'style.css', 'dashboard.css', 'favicon.svg', 'favicon.ico',
              'apple-touch-icon.png', 'vendor/chart.umd.min.js', 'data/meta.json', 'data/names.json']
    for directory, files in [(source, required), (dist, shared)]:
        for name in files:
            if not (directory / name).is_file():
                raise SystemExit(f'Missing required existing file: {directory / name}')
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    before = {p.relative_to(dist): digest(p) for p in dist.rglob('*') if p.is_file()}
    html = (source / 'index.html').read_text('utf-8')
    ja = (dist / 'index.html').read_text('utf-8')
    # Reuse the actual JA build's self-hosted font subset, without rebuilding it.
    font_styles = re.findall(r'<style>\s*@font-face\{.*?</style>', ja, re.S)
    if font_styles:
        fonts = '\n'.join(font_styles).replace('url(fonts/', 'url(../fonts/')
        html = re.sub(r'<!-- fonts:start.*?<!-- fonts:end -->', lambda _: fonts, html, flags=re.S)
    for name in ['app.js', 'charts.js', 'speed-share.js']:
        html = html.replace(f'"{name}"', f'"{name}?v={digest(source / name)[:10]}"')
    for name in ['style.css', 'dashboard.css', 'vendor/chart.umd.min.js']:
        html = html.replace(f'"../{name}"', f'"../{name}?v={digest(dist / name)[:10]}"')
    target.mkdir()
    for name in required:
        shutil.copyfile(source / name, target / name)
    (target / 'index.html').write_text(html, 'utf-8')
    after = {p.relative_to(dist): digest(p) for p in dist.rglob('*') if p.is_file() and target not in p.parents}
    if before != after:
        raise SystemExit('Existing deployment bytes changed; do not deploy')
    print(f'PASS: added {len(required)} EN files; preserved {len(before)} existing deployment files')


if __name__ == '__main__':
    assemble(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1])
