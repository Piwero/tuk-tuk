from app.priority_phrase import resolve_priority_phrase


class TestResolvePriorityPhrase:
    def test_high_priority_phrase(self) -> None:
        assert resolve_priority_phrase("high priority") == "high"
        assert resolve_priority_phrase("urgent") == "high"
        assert resolve_priority_phrase("ASAP") == "high"

    def test_medium_priority_phrase(self) -> None:
        assert resolve_priority_phrase("medium priority") == "medium"
        assert resolve_priority_phrase("normal") == "medium"

    def test_low_priority_phrase(self) -> None:
        assert resolve_priority_phrase("low") == "low"

    def test_returns_none_for_an_unrecognized_phrase(self) -> None:
        assert resolve_priority_phrase("whenever") is None

    def test_returns_none_for_an_empty_phrase(self) -> None:
        assert resolve_priority_phrase("") is None
        assert resolve_priority_phrase("   ") is None
