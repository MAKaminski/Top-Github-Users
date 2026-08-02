#!/usr/bin/env bash
#
# Commits whatever the crawl changed under data/, and nothing else.
#
# `git add data` stages only the files that actually differ, so a tier that
# discovered nothing produces no commit at all — which is the whole point of the
# deterministic writer in scripts/lib/io.ts.
#
# Matrix legs run one at a time but still land on a branch that may have moved
# since checkout, so the push is a rebase-and-retry rather than a single shot.
#
#   .github/scripts/commit-data.sh "countries 2/6"

set -euo pipefail

label="${1:-crawl}"

git config user.name "commitgraph-crawler"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git add --all data

if git diff --cached --quiet; then
  echo "No data changes for ${label}."
  exit 0
fi

files=$(git diff --cached --name-only | wc -l | tr -d ' ')
git commit -m "data: ${label} $(date -u +%Y-%m-%d)" -m "${files} file(s) changed by the scheduled crawl."

for attempt in 1 2 3 4 5; do
  if git push; then
    echo "Pushed ${files} file(s) for ${label}."
    exit 0
  fi
  echo "Push rejected (attempt ${attempt}); rebasing onto the branch tip."
  git pull --rebase --autostash
  sleep $((attempt * 5))
done

echo "::error::Could not push the ${label} snapshot after five attempts."
exit 1
