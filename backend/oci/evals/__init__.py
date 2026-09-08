"""The Assistant's manual eval suite (ADR 0009; issue #190).

Not a test suite. It costs money, needs a real provider, and answers a
question CI structurally cannot: *is this model any good at planning a
day?* CI runs the Assistant against a localhost stub serving canned
completions, which proves the plumbing and says nothing about judgement —
and here the model's judgement is the product.

It lives outside `tests/` on purpose. Pytest's `testpaths = ["tests"]`
means nothing in this package is ever collected, by anyone, on any
machine — a structural exclusion rather than a marker someone has to
remember to deselect in CI.

Run it by hand when shopping for a model or changing the system prompt:

    uv run python -m evals --model gpt-4o-mini
    uv run python -m evals --model gpt-4o-mini --model gpt-5-nano   # side by side
"""

import os

# `app.main` builds a module-level app on import and refuses to exist
# without a master key (ADR 0008's fail-closed posture), so — exactly as
# `tests/conftest.py` does, and for the same reason — a throwaway one is
# set before the first app import. It encrypts nothing that outlives a
# scenario: every run gets its own temporary SQLite file, deleted when the
# run ends. `setdefault`, so a real environment is never overwritten.
os.environ.setdefault("APP_MASTER_KEY", "eval-master-key")
