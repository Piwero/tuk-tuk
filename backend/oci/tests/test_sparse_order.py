from app.models import SORT_GAP
from app.sparse_order import append_order


def test_append_order_starts_at_gap_for_empty_collection() -> None:
    assert append_order(None) == SORT_GAP


def test_append_order_adds_gap_to_last_sibling() -> None:
    assert append_order(1024) == 1024 + SORT_GAP
