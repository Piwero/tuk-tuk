"""Sparse sort_order helpers, shared by any ordered child collection
(Stand-up Bullets, and future Key Results) that appends new rows after the
current last sibling. Renumbering/insert-before math lives client-side
(frontend/oci/src/ordering.ts); the server only ever receives a final
sort_order to store, except for append, which the server computes itself
since a new row has no client-known position yet.
"""

from app.models import SORT_GAP


def append_order(last_sort_order: int | None) -> int:
    """Sparse sort_order for appending after the current last sibling
    (`last_sort_order`, or None if the collection is empty).
    """
    return (last_sort_order if last_sort_order is not None else 0) + SORT_GAP
