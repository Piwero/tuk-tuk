"""The eval suite's entry point (issue #190).

    uv run python -m evals --model gpt-4o-mini
    uv run python -m evals --model gpt-4o-mini --model gpt-5-nano

Two models named means a side-by-side table: same eight scenarios, same
seeded weeks, one column each — so the cost/quality trade-off is read off
a table rather than argued from impressions.
"""

import argparse
import os
import sys
import time

from evals.checks import parse_model_arg
from evals.proxy import UsageProxy
from evals.runner import ProviderConfig, run_scenario, score
from evals.scenarios import Scenario, all_scenarios

_DEFAULT_BASE_URL = "https://api.openai.com/v1"
_PASS = "PASS"
_FAIL = "FAIL"


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m evals",
        description=(
            "Manual eval suite for the Assistant. Runs real, billed calls "
            "against a real provider — never run in CI."
        ),
    )
    parser.add_argument(
        "--model",
        action="append",
        required=True,
        help=(
            "A model to evaluate; repeat to compare models side by side. "
            "Give it its own prices as 'name:price_in:price_out' when two "
            "models don't cost the same."
        ),
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("EVAL_BASE_URL", _DEFAULT_BASE_URL),
        help=f"OpenAI-compatible base URL (default: $EVAL_BASE_URL or {_DEFAULT_BASE_URL})",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("EVAL_API_KEY", ""),
        help="Provider API key (default: $EVAL_API_KEY). Use any value for a local Ollama.",
    )
    parser.add_argument(
        "--price-in",
        type=float,
        default=0.0,
        help=(
            "USD per million input tokens for models that don't carry their "
            "own. Prices change; pass today's."
        ),
    )
    parser.add_argument(
        "--price-out",
        type=float,
        default=0.0,
        help="USD per million output tokens, for models that don't carry their own.",
    )
    parser.add_argument(
        "--only",
        action="append",
        help="Run only scenarios whose key matches (meetings/overloaded/overdue/packed).",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print each turn's prose and Suggestions, not just the verdicts.",
    )
    return parser.parse_args(argv)


def _selected(scenarios: list[Scenario], only: list[str] | None) -> list[Scenario]:
    if not only:
        return scenarios
    return [scenario for scenario in scenarios if scenario.key in only]


def _run_model(
    model: str,
    prices: tuple[float, float],
    args: argparse.Namespace,
    scenarios: list[Scenario],
) -> tuple[dict[str, bool], list[str], float, float]:
    """One model against every scenario. Returns per-check verdicts keyed by
    'scenario/language/check', the failure detail lines, the wall-clock
    seconds, and the pass's dollar cost at this model's own prices."""
    verdicts: dict[str, bool] = {}
    details: list[str] = []
    started = time.monotonic()
    with UsageProxy(args.base_url) as proxy:
        provider = ProviderConfig(
            base_url=proxy.base_url, model=model, api_key=args.api_key or "unused"
        )
        for scenario in scenarios:
            label = f"{scenario.key}/{scenario.language}"
            print(f"  {model}: {label} ...", flush=True)
            result = run_scenario(scenario, provider)
            if args.verbose:
                print(f"    message: {result.message}")
                for suggestion in result.suggestions:
                    print(f"    suggestion: {suggestion}")
            for name, failures in score(scenario, result):
                verdicts[f"{label}/{name}"] = not failures
                for failure in failures:
                    details.append(f"{model} {label} — {name}: {failure}")
        usage = proxy.usage
        cost = usage.cost_usd(*prices)
        elapsed = time.monotonic() - started
        print(
            f"  {model}: {usage.calls} provider call(s), "
            f"{usage.prompt_tokens} in / {usage.completion_tokens} out tokens"
            + (
                f", {usage.unreported_calls} call(s) reported no usage"
                if usage.unreported_calls
                else ""
            )
        )
        for error in usage.errors:
            print(f"  {model}: proxy error: {error}")
    return verdicts, details, elapsed, cost


def _print_table(models: list[str], results: dict[str, dict[str, bool]]) -> None:
    check_names = list(next(iter(results.values())).keys())
    width = max(len(name) for name in check_names)
    header = "  ".join(model.rjust(max(len(model), 6)) for model in models)
    print()
    print(f"{'check'.ljust(width)}  {header}")
    print("-" * (width + 2 + len(header)))
    for name in check_names:
        cells = "  ".join(
            (_PASS if results[model].get(name) else _FAIL).rjust(max(len(model), 6))
            for model in models
        )
        print(f"{name.ljust(width)}  {cells}")
    print("-" * (width + 2 + len(header)))
    totals = "  ".join(
        f"{sum(results[model].values())}/{len(check_names)}".rjust(max(len(model), 6))
        for model in models
    )
    print(f"{'passed'.ljust(width)}  {totals}")


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    scenarios = _selected(all_scenarios(), args.only)
    if not scenarios:
        print("No scenarios matched --only", file=sys.stderr)
        return 2

    priced_models = [parse_model_arg(value, args.price_in, args.price_out) for value in args.model]
    names = [name for name, _, _ in priced_models]
    print(
        f"Running {len(scenarios)} scenario(s) against {len(names)} model(s) "
        f"at {args.base_url}. These are real, billed calls."
    )
    results: dict[str, dict[str, bool]] = {}
    all_details: list[str] = []
    costs: dict[str, tuple[float, float]] = {}
    for name, price_in, price_out in priced_models:
        verdicts, details, elapsed, cost = _run_model(name, (price_in, price_out), args, scenarios)
        results[name] = verdicts
        all_details.extend(details)
        costs[name] = (elapsed, cost)

    _print_table(names, results)

    print()
    for name, (elapsed, cost) in costs.items():
        if cost > 0:
            # Four decimals would print a real sub-cent pass as "$0.0000",
            # which reads as free rather than as cheap — the one number
            # this suite exists to report honestly.
            priced = f"${cost:.4f}" if cost >= 0.001 else f"${cost * 100:.4f}c"
        else:
            priced = "unpriced (give the model prices as name:in:out, or pass --price-in/out)"
        print(f"{name}: {elapsed:.1f}s per full pass, {priced}")

    if all_details:
        print("\nFailures:")
        for detail in all_details:
            print(f"  - {detail}")

    # Always 0: this suite reports, it does not gate. A failing check is
    # information for whoever is shopping for a model, not a broken build —
    # and a non-zero exit is how a manual suite ends up wired into CI by
    # someone who assumed it was safe to.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
