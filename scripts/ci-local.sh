#!/usr/bin/env bash
# Run the same steps a project's GitHub Actions CI job runs, locally.
# Used by the pre-push hooks in .pre-commit-config.yaml so a push only leaves
# the machine if CI would be green. Keep in step with .github/workflows/*-ci.yml.
#
# Usage: scripts/ci-local.sh <backend|cli|shared|mcp|voice-agent|frontend>
set -euo pipefail

root="$(git rev-parse --show-toplevel)"

python_ci() {
  cd "$root/$1"
  uv sync --locked
  uv run ruff check .
  uv run ruff format --check .
  uv run mypy src
  uv run pytest
}

case "${1:-}" in
  backend) python_ci backend/oci ;;
  cli) python_ci cli/oci ;;
  shared) python_ci shared/oci ;;
  mcp) python_ci mcp/oci ;;
  voice-agent) python_ci voice-agent ;;
  frontend)
    cd "$root/frontend/oci"
    # `npm ci` is slow; only reinstall when the lockfile moved.
    if [[ ! -d node_modules || package-lock.json -nt node_modules/.package-lock.json ]]; then
      npm ci
    fi
    npm run format:check
    npm run lint
    npm run typecheck
    npm test
    npm run build
    ;;
  *)
    echo "usage: $0 <backend|cli|shared|mcp|voice-agent|frontend>" >&2
    exit 2
    ;;
esac
