#!/bin/sh
# Синхронизирует метки ресурсов, время в подвале и файл проверки версии.
set -eu
cd "$(dirname "$0")"
python3 - <<'PY'
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re

now = datetime.now(timezone.utc)
version = now.strftime('%Y%m%d%H%M')
moscow = now.astimezone(timezone(timedelta(hours=3)))
stamp = '<time datetime="{}">{} МСК</time>'.format(
    now.strftime('%Y-%m-%dT%H:%MZ'), moscow.strftime('%d.%m.%Y в %H:%M')
)
page = Path('index.html')
html = re.sub(r'\?v=\d+', '?v=' + version, page.read_text(encoding='utf-8'))
html, count = re.subn(r'(<span id="appVer" class="app-ver">Обновлено )<time[^>]*>[^<]*</time>', r'\g<1>' + stamp, html)
if count != 1:
    raise SystemExit('На странице должна быть одна отметка времени обновления')
page.write_text(html, encoding='utf-8')
Path('version.txt').write_text(version + '\n', encoding='utf-8')
print('version ' + version)
PY
