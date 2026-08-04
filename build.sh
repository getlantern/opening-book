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
# The hash goes in the FILENAME, not a query string. A query string does not work here:
# Cloudflare's edge cache for /assets/* ignores it, so `site.css?v=<hash>` returned a stale
# body for hours while the deployment-specific URL served the new one — a mobile fix shipped
# and stayed invisible on the live domain because of exactly this. A different path is the only
# thing a cache cannot conflate.
for asset in site.css site.js little.js; do
  base=${asset%.*}; ext=${asset##*.}
  hash=$(shasum -a 256 "assets/$asset" | cut -c1-10)
  mv "dist/assets/$asset" "dist/assets/$base.$hash.$ext"
  for f in dist/*.html; do
    # BSD and GNU sed disagree about -i, so write through a temp file
    sed "s|assets/$asset|assets/$base.$hash.$ext|g" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
done

# Fail loudly if a page references an asset that did not make it into dist/.
missing=0
for f in dist/*.html; do
  while IFS= read -r ref; do
    case "$ref" in http*|"#"*|"") continue ;; esac
    ref=${ref%%#*}          # drop fragments
    ref=${ref%%\?*}         # tolerate any query string
    [ -e "dist/$ref" ] || { echo "MISSING in dist: $ref (referenced by $f)" >&2; missing=1; }
  done < <(grep -oE '(href|src)="[^"]+"' "$f" | sed 's/.*="//; s/"$//')
done
[ "$missing" -eq 0 ] || { echo "build failed: unresolved references" >&2; exit 1; }

echo "dist/ ready — $(find dist -type f | wc -l | tr -d ' ') files, $(du -sh dist | cut -f1)"
grep -ohE 'assets/(site|little)\.[a-f0-9]{10}\.(css|js)' dist/index.html | sort -u | sed 's/^/  /'
