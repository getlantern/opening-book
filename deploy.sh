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
