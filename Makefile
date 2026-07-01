test_python:
	uv run ruff check
	uv run mypy
	uv run pytest --cov