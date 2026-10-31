#!/bin/bash
#
# Ask what one stylesheet is still deciding.
#
# Disables its import, measures the post surface, reports how much moved, and
# puts the import back. A file that moves nothing has had all its rules
# overruled by a later layer; a file that moves hundreds of values is
# load-bearing. One run answers in about a minute what reading the file cannot
# answer at all, because the question is never what a rule says — it is
# whether anything says it again later.
#
#   bash scripts/probe-stylesheet.sh feed-density.css
#
# IT ONLY SEES THE RESTING STATE. The snapshot reads a page sitting still: no
# hover, no focus, no press, no animation. engagement-effects.css probed as
# "nothing moved" and is not dead at all — it holds the burst a like makes
# when you tap it. Before deleting anything this calls quiet, read the file
# and ask whether it describes a moment rather than a state.
#
# Compares against $BASELINE (default: the it4 baseline path), so take a
# snapshot first:
#   node scripts/measure-screens.mjs --snapshot "$TEMP/baseline.json"
#
set -u
cd "$(dirname "$0")/.." || exit 1
sheet="$1"
baseline="${BASELINE:-$TEMP/it4-before.json}"
backup="$TEMP/layout-probe-backup.tsx"

cp app/layout.tsx "$backup"
node -e "
const fs = require('fs');
const path = 'app/layout.tsx';
const source = fs.readFileSync(path, 'utf8');
fs.writeFileSync(path, source.replace('import \"./$sheet\";', '/* probe */'));
"
timeout 400 node scripts/measure-screens.mjs --snapshot "$TEMP/probe.json" >/dev/null 2>&1
moved=$(timeout 200 node scripts/measure-screens.mjs --diff "$baseline" "$TEMP/probe.json" 2>&1 | head -1)
cp "$backup" app/layout.tsx
echo "$sheet : $moved"
