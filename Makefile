node_modules/.bin/pact-verifier: package-lock.json package.json backend/core-case-service/package.json
	npm ci

test_python: node_modules/.bin/pact-verifier
	uv run ruff check
	uv run mypy
	uv run pytest --cov

test_provider:
	npm run ci:provider
