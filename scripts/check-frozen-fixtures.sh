#!/usr/bin/env bash
# New golden replay files are allowed; existing files must remain byte-identical.
set -euo pipefail
base="${1:?Usage: check-frozen-fixtures.sh BASE_COMMIT}"
changed="$(git diff --no-renames --name-only --diff-filter=MDT "$base" -- packages/demo-games/fixtures/)"
if [[ -n "$changed" ]]; then
  echo 'Existing demo replay fixtures are immutable. Add a new fixture instead:' >&2
  echo "$changed" >&2
  exit 1
fi
