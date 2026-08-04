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

# ---- verify without poisoning what is being verified -----------------------------------------
# Publishing is not the same as being served, and getting this wrong is expensive: a request for a
# new hashed path that lands before that colo resolves the new deployment gets Pages' not-found
# fallback (index.html, status 200), and /assets/* has a long max-age, so the colo pins that HTML
# under the asset's real URL for hours. The page renders; the script never runs.
#
# Two things make the naive check useless or harmful:
#   - index.html is DYNAMIC, never cached, so every colo names the new hash instantly. That says
#     nothing about whether the ASSET has propagated. An earlier check assumed it did.
#   - simply requesting the canonical path to find out is what creates the bad entry.
# So probe with a unique query string. That is a separate cache key (verified — Cloudflare does
# not ignore the query), so a miss during the window is pinned to a URL nobody will ever request
# again. Only once the probe returns the right type is the real URL touched.
SITE=${SITE:-https://spark.lantern.io}
REFS=$(grep -ohE 'assets/[a-z]+\.[a-f0-9]{10}\.(css|js)' dist/index.html | sort -u)
RUN=$$
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

echo "2/3 waiting for propagation, via throwaway cache keys"
for ref in $REFS; do
  want=$(want_of "$ref")
  n=1
  while :; do
    ct=$(ctype "$SITE/$ref?deploycheck=$RUN-$n")
    ok_ct "$want" "$ct" && { echo "  ok   $ref propagated"; break; }
    if [ "$n" -ge 30 ]; then
      echo "  FAIL $ref never propagated (last type '$ct')" >&2; exit 1
    fi
    n=$((n + 1)); sleep 6
  done
done

echo "3/3 the real URLs"
fail=0
for ref in $REFS; do
  ct=$(ctype "$SITE/$ref")
  if ok_ct "$(want_of "$ref")" "$ct"; then echo "  ok   $ref ($ct)"
  else
    echo "  FAIL $ref is served as '$ct'." >&2
    echo "       Propagation succeeded, so this is an entry cached BEFORE this deploy — most" >&2
    echo "       likely from a visitor, or a check that requested the path too early. It will" >&2
    echo "       not clear on its own and the wrangler token is zone-read only, so it cannot be" >&2
    echo "       purged: change the file to move to a fresh hash, or wait out the max-age." >&2
    fail=1
  fi
done
[ "$fail" -eq 0 ] || exit 1
echo "all hashed assets verified"
