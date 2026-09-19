#!/usr/bin/env bash
set -euo pipefail

npm run check
npm run format:check
npm run build
cargo fmt --all -- --check
cargo test -p markdesk
cargo clippy -p markdesk --all-targets -- -D warnings

echo "MarkDesk verification passed."
