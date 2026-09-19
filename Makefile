.PHONY: install dev check test format rust-test

install:
	npm install

dev:
	npm run dev

check:
	npm run check
	npm run format:check

test:
	npm run test

format:
	npm run format

rust-test:
	cargo test -p markdesk
