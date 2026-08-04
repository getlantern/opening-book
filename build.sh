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
# The hash goes in the FILENAME. Note the reason, because a wrong one was recorded here first:
# it is NOT that Cloudflare ignores query strings. It does not — a unique query is a separate
# edge cache key, verified directly. The reason is simpler and applies to every cache in the
# path: /assets/* is served with a long max-age, so a client that already holds `site.css` will
# keep using its copy until that expires no matter what query the HTML appends. A new filename
# is a new URL, which nothing can have a stale copy of.
for asset in site.css site.js little.js; do
  base=${asset%.*}; ext=${asset##*.}
  hash=$(shasum -a 256 "assets/$asset" | cut -c1-10)
  mv "dist/assets/$asset" "dist/assets/$base.$hash.$ext"
  for f in dist/*.html; do
    # BSD and GNU sed disagree about -i, so write through a temp file
    sed "s|assets/$asset|assets/$base.$hash.$ext|g" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
done

# Refuse to ship without a 404.html. Cloudflare Pages infers not-found behaviour from the files
# present: with no 404.html it treats the site as a single-page app and answers unmatched paths
# with index.html and status 200 — a cacheable success that gets pinned under asset URLs. See
# README.
[ -e dist/404.html ] || { echo "build failed: no 404.html (see README — Pages would serve index.html with 200 for unmatched paths)" >&2; exit 1; }

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
