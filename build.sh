#!/usr/bin/env bash
# Assemble the deployable site into dist/.
#
# Explicit copies rather than `wrangler pages deploy .` so the upload can never pick up .git,
# README.md, wrangler config, or anything else added to the repo later.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist/assets
cp -- *.html dist/
cp -- assets/site.css assets/site.js assets/favicon.svg dist/assets/
cp -- _redirects _headers dist/

# Fail loudly if a page references an asset that did not make it into dist/.
missing=0
for f in dist/*.html; do
  while IFS= read -r ref; do
    case "$ref" in http*|"#"*|"") continue ;; esac
    [ -e "dist/${ref%%#*}" ] || { echo "MISSING in dist: $ref (referenced by $f)" >&2; missing=1; }
  done < <(grep -oE '(href|src)="[^"]+"' "$f" | sed 's/.*="//; s/"$//')
done
[ "$missing" -eq 0 ] || { echo "build failed: unresolved references" >&2; exit 1; }

echo "dist/ ready — $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
