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
  --commit-dirty=true

# ---- verify what the live domain actually serves --------------------------------------------
# Publishing is not the same as being served. A hashed asset requested before its deployment has
# reached an edge node gets the not-found fallback — index.html, as text/html, status 200 — and
# that gets cached for hours. The page still loads; the script just silently does not run. So
# check the content-type of every hashed asset, and say so loudly if it is wrong.
SITE=${SITE:-https://spark.lantern.io}
echo
echo "verifying $SITE ..."
fail=0
for ref in $(grep -ohE 'assets/[a-z]+\.[a-f0-9]{10}\.(css|js)' dist/index.html | sort -u); do
  want=js; case "$ref" in *.css) want=css ;; esac
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    ct=$(curl -sI --max-time 20 "$SITE/$ref" | tr -d '\r' | awk 'tolower($1)=="content-type:"{print $2}')
    case "$ct" in
      *javascript*) [ "$want" = js ]  && { echo "  ok   $ref  ($ct)"; break; } ;;
      *css*)        [ "$want" = css ] && { echo "  ok   $ref  ($ct)"; break; } ;;
    esac
    if [ "$attempt" = 10 ]; then
      echo "  FAIL $ref is being served as '$ct' — the edge has cached a fallback for this path." >&2
      echo "       A cached wrong answer will not clear on its own. Change the file so the hash" >&2
      echo "       changes, giving a fresh path, then deploy again." >&2
      fail=1
    else
      sleep 6
    fi
  done
done
[ "$fail" -eq 0 ] || exit 1
echo "all hashed assets verified"
