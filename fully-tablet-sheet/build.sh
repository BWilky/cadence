#!/usr/bin/env sh
# Concatenates src/*.js into fully-tablet-sheet.js. No bundler, no transpiling.
set -e
cd "$(dirname "$0")"
cat src/00-head.js src/10-sheet-core.js src/20-sheet-render.js src/30-sheet-history.js src/40-sheet-styles.js src/50-opener.js src/60-cards.js > fully-tablet-sheet.js
node --check fully-tablet-sheet.js
echo "built fully-tablet-sheet.js ($(wc -c < fully-tablet-sheet.js) bytes)"
