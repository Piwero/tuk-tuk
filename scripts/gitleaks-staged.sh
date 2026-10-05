#!/usr/bin/env bash
# Scan staged changes for secrets with gitleaks.
#
# Deliberately not pre-commit's own gitleaks hook. That hook builds the
# binary from source with cgo, and on macOS with Go 1.22 and the current
# Xcode linker the result is a Mach-O binary carrying no LC_UUID, which
# dyld refuses to exec at all (SIGABRT) -- so the hook cannot run, and a
# secret scan that cannot run is worse than one that is merely absent,
# because it looks installed. A prebuilt binary has no such problem, so
# this prefers whatever is on PATH and says how to get one if nothing is.
set -euo pipefail

if command -v gitleaks >/dev/null 2>&1; then
  # --staged matches what is about to be committed rather than the whole
  # history; --redact keeps any finding out of the terminal and the CI log.
  exec gitleaks git --staged --redact
fi

cat >&2 <<'MSG'
gitleaks not found on PATH, so staged changes were not scanned for secrets.

Install it:
  macOS   brew install gitleaks
  Linux   https://github.com/gitleaks/gitleaks/releases

Or skip this one hook for a commit you know is clean:
  SKIP=gitleaks git commit ...
MSG
exit 1
