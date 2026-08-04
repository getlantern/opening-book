#!/usr/bin/env bash
# Build and publish the Spark site to Cloudflare Pages.
#
# The account is pinned here rather than left to wrangler: this login can see both
# "Brave New Software Project, Inc." (the Lantern org, used below) and a personal account,
# and with two visible accounts a non-interactive deploy just fails. Pinning also means nobody
# can publish the company site to the wrong account by accident.
set -euo pipefail
cd "$(dirname "$0")"

export CLOUDFLARE_ACCOUNT_ID=1c693b3f1031ed33f68653b1e67dfbef   # Brave New Software Project, Inc.

./build.sh
npx --yes wrangler@4 pages deploy dist \
  --project-name spark \
  --branch main \
  --commit-dirty=true 2>&1 | tee /tmp/spark-deploy.log
grep -oE 'https://[a-f0-9]+\.spark-[a-z0-9]+\.pages\.dev' /tmp/spark-deploy.log | head -1 > .last-deploy-url || true

# ---- verify, in an order that does not cause the problem -------------------------------------
# Publishing is not the same as being served, and the failure mode is invisible: ask an edge node
# for a brand-new asset path before that deployment has reached it and Pages answers with the
# not-found fallback (index.html, text/html, status 200) — then caches it for hours. The page
# still loads; the script silently does not run.
#
# The ordering below matters, and getting it wrong once made this script the CAUSE of the very
# failure it checks for. Do not request an asset path on the live domain until the live HTML is
# already asking for it: that is the proof the deployment reached that node.
#   1. verify the upload on the deployment-specific URL, which has no shared cache
#   2. wait for the live HTML to reference the new hashes — the alias has switched
#   3. only then check the asset content-types on the live domain
SITE=${SITE:-https://spark.lantern.io}
REFS=$(grep -ohE 'assets/[a-z]+\.[a-f0-9]{10}\.(css|js)' dist/index.html | sort -u)
ctype() { curl -sI --max-time 20 "$1" | tr -d '\r' | awk 'tolower($1)=="content-type:"{print $2}'; }
want_of() { case "$1" in *.css) echo css ;; *) echo js ;; esac; }
ok_ct() { case "$2" in *javascript*) [ "$1" = js ] ;; *css*) [ "$1" = css ] ;; *) false ;; esac; }

echo
echo "1/3 upload, on the deployment URL"
DEPLOY_URL=$(cat .last-deploy-url 2>/dev/null || true)
if [ -n "$DEPLOY_URL" ]; then
  for ref in $REFS; do
    ct=$(ctype "$DEPLOY_URL/$ref")
    if ok_ct "$(want_of "$ref")" "$ct"; then echo "  ok   $ref ($ct)"
    else echo "  FAIL $ref uploaded wrong: '$ct'" >&2; exit 1; fi
  done
else
  echo "  (deployment URL not captured; skipping)"
fi

echo "2/3 waiting for the live HTML to ask for the new hashes"
for i in $(seq 1 40); do
  html=$(curl -s --max-time 20 "$SITE/?probe=$i")
  missing=0
  for ref in $REFS; do case "$html" in *"$ref"*) ;; *) missing=1 ;; esac; done
  [ "$missing" -eq 0 ] && { echo "  alias switched"; break; }
  [ "$i" = 40 ] && { echo "  FAIL live HTML never referenced the new build" >&2; exit 1; }
  sleep 6
done

echo "3/3 content-types on the live domain"
fail=0
for ref in $REFS; do
  ct=$(ctype "$SITE/$ref")
  if ok_ct "$(want_of "$ref")" "$ct"; then echo "  ok   $ref ($ct)"
  else
    echo "  FAIL $ref is served as '$ct' — the edge cached a fallback for this path." >&2
    echo "       It will not clear on its own, and the wrangler token is zone-read only so it" >&2
    echo "       cannot be purged. Change the file so the hash changes, then deploy again." >&2
    fail=1
  fi
done
[ "$fail" -eq 0 ] || exit 1
echo "all hashed assets verified"
