#!/usr/bin/env bash
# Prints the next prerelease version (<next>-dev.<N>); N = $RUN_NUMBER, else commit count since the last stable tag.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

base=$(sed -n 's/.*"\.": *"\([^"]*\)".*/\1/p' .release-please-manifest.json)
[ -n "$base" ] || { echo "no version in .release-please-manifest.json" >&2; exit 1; }
IFS=. read -r major minor patch <<<"$base"

last=$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | grep -v -- '-' | head -n1 || true)
range=HEAD
[ -n "$last" ] && range="$last..HEAD"

breaking=0 feat=0 count=0
while IFS= read -r -d '' commit; do
  [ -n "$commit" ] || continue
  count=$((count + 1))
  subject=${commit%%$'\n'*}
  if [[ $subject =~ ^[a-z]+(\(.+\))?!: ]] || grep -q 'BREAKING CHANGE' <<<"$commit"; then breaking=1
  elif [[ $subject =~ ^feat(\(.+\))?: ]]; then feat=1; fi
done < <(git log -z --format=%B "$range")

if [ "$breaking" = 1 ]; then
  if [ "$major" = 0 ]; then minor=$((minor + 1)); patch=0; else major=$((major + 1)); minor=0; patch=0; fi
elif [ "$feat" = 1 ]; then minor=$((minor + 1)); patch=0
else patch=$((patch + 1)); fi

echo "$major.$minor.$patch-dev.${RUN_NUMBER:-$count}"
