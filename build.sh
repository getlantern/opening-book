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
cp -- assets/site.css assets/site.js assets/little.js assets/favicon.svg assets/og.png dist/assets/
cp -- _redirects _headers robots.txt sitemap.xml dist/

# ---- cache-bust the assets that change -----------------------------------------------------
# Cloudflare serves /assets/* with a long max-age (observed: 14400, longer than the value in
# _headers — it applies its own). Without this, a returning visitor keeps a stale stylesheet for
# hours and silently misses whatever shipped: after one deploy the `.ground` rules were live on
# the server while browsers still had the previous CSS, so the element fell back to
# position:static and the terrain it defines simply did not exist.
#
# Appending a content hash gives each revision its own URL, so caches can be as aggressive as
# they like and a change is still picked up on the next load.
for asset in site.css site.js little.js; do
  hash=$(shasum -a 256 "assets/$asset" | cut -c1-10)
  for f in dist/*.html; do
    # BSD and GNU sed disagree about -i, so write through a temp file
    sed "s|assets/$asset\"|assets/$asset?v=$hash\"|g" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
done

# Fail loudly if a page references an asset that did not make it into dist/.
missing=0
for f in dist/*.html; do
  while IFS= read -r ref; do
    case "$ref" in http*|"#"*|"") continue ;; esac
    ref=${ref%%#*}          # drop fragments
    ref=${ref%%\?*}         # and the cache-busting query added above
    [ -e "dist/$ref" ] || { echo "MISSING in dist: $ref (referenced by $f)" >&2; missing=1; }
  done < <(grep -oE '(href|src)="[^"]+"' "$f" | sed 's/.*="//; s/"$//')
done
[ "$missing" -eq 0 ] || { echo "build failed: unresolved references" >&2; exit 1; }

echo "dist/ ready — $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
grep -ohE 'assets/(site\.css|little\.js)\?v=[a-f0-9]+' dist/index.html | sort -u | sed 's/^/  /'
