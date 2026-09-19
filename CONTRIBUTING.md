# Contributing

MarkDesk is shipping on a hackathon timeline, but correctness beats feature count.

## Workflow

1. Open or reference an issue with one measurable outcome.
2. Keep protocol math in pure functions with boundary tests.
3. Never add a mocked success state to the production UI.
4. Run `npm run check`, `npm run format:check`, and `cargo test -p markdesk` when Rust is available.
5. Document trust assumptions and incomplete integrations in the same pull request.

## Commit style

Use concise conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.

## Security-sensitive changes

Changes to authority checks, PDA seeds, quote math, token transfers, timestamp handling, or publisher key management require an explicit threat-model update and a second review before deployment.
