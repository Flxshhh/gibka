#!/bin/sh
# Обновляет номер версии у css/js/картинок в index.html, чтобы браузеры не брали старые файлы из кэша.
V=$(date -u +%Y%m%d%H%M)
sed -i -E "s/\?v=[0-9]+/?v=$V/g" "$(dirname "$0")/index.html"
echo "$V" > "$(dirname "$0")/version.txt"   # сайт сверяется с этим файлом и предлагает обновиться
echo "version $V"
