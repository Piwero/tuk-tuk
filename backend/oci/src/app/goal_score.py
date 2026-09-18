"""Key Result ratio and Goal Score — computed on read, never stored (ADR
0012, except the final_score snapshot frozen at close). Pure, stdlib only.
"""


def key_result_ratio(start: float, target: float, current: float) -> float:
    """A Key Result's progress: how far `current` has travelled from `start`
    toward `target`, clamped to 0.0-1.0. Guards the degenerate `target ==
    start` (undefined direction) by returning 1.0 once `current` reaches
    it, else 0.0. Clamping is load-bearing: an uncapped overshoot on one Key
    Result would mask a 0.0 on another once averaged into the Score.
    """
    if target == start:
        return 1.0 if current >= target else 0.0
    ratio = (current - start) / (target - start)
    return max(0.0, min(1.0, ratio))


def goal_score(ratios: list[float]) -> float | None:
    """The unweighted mean of Key Result ratios, rounded to two places. A
    Goal with no Key Results has no Score (null, not zero) — "0%" would read
    as failure when it just means unmeasured.
    """
    if not ratios:
        return None
    return round(sum(ratios) / len(ratios), 2)
