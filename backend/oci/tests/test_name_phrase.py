from app.name_phrase import resolve_name_phrase


class TestResolveNamePhrase:
    def test_matches_case_insensitively_and_returns_candidate_casing(self) -> None:
        assert resolve_name_phrase("errands", ["Errands", "Work"]) == "Errands"
        assert resolve_name_phrase("ERRANDS", ["Errands", "Work"]) == "Errands"

    def test_strips_surrounding_whitespace(self) -> None:
        assert resolve_name_phrase("  Work  ", ["Work"]) == "Work"

    def test_returns_none_when_nothing_matches(self) -> None:
        assert resolve_name_phrase("groceries", ["Errands", "Work"]) is None

    def test_returns_none_against_an_empty_candidate_list(self) -> None:
        assert resolve_name_phrase("Errands", []) is None
