.PHONY: help install install-backend install-frontend install-precommit \
        dev dev-backend dev-frontend \
        lint lint-backend lint-frontend \
        format format-backend format-frontend \
        test test-backend test-frontend \
        clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---- Install ----
install: install-backend install-frontend install-precommit ## Install everything

install-backend: ## Install python deps into venv
	cd backend && python -m venv .venv && \
		. .venv/bin/activate && \
		pip install --upgrade pip && \
		pip install -e ".[dev]"

install-frontend: ## Install node deps
	cd frontend && npm install

install-precommit: ## Install pre-commit hooks
	pip install pre-commit && pre-commit install

# ---- Dev ----
dev: ## Run backend and frontend in parallel
	@$(MAKE) -j 2 dev-backend dev-frontend

dev-backend: ## Run backend dev server
	cd backend && . .venv/bin/activate && \
		uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

dev-frontend: ## Run frontend dev server
	cd frontend && npm run dev

# ---- Lint ----
lint: lint-backend lint-frontend ## Lint everything

lint-backend:
	cd backend && . .venv/bin/activate && ruff check . && mypy src

lint-frontend:
	cd frontend && npm run lint

# ---- Format ----
format: format-backend format-frontend ## Format everything

format-backend:
	cd backend && . .venv/bin/activate && ruff format . && ruff check --fix .

format-frontend:
	cd frontend && npm run format

# ---- Test ----
test: test-backend test-frontend ## Run all tests

test-backend:
	cd backend && . .venv/bin/activate && pytest

test-frontend:
	cd frontend && npm test

# ---- Housekeeping ----
clean: ## Remove build artifacts and caches
	rm -rf backend/.venv backend/.pytest_cache backend/.mypy_cache backend/.ruff_cache
	rm -rf frontend/node_modules frontend/dist frontend/.vite
	find . -type d -name __pycache__ -exec rm -rf {} +
