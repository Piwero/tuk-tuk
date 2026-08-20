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

    def test_matches_a_candidate_wrapped_in_extra_words(self) -> None:
        assert resolve_name_phrase("my errands list", ["Errands", "Work"]) == "Errands"
        assert (
            resolve_name_phrase("my list-2-no-folder list", ["list-2-no-folder"])
            == "list-2-no-folder"
        )

    def test_does_not_match_a_substring_of_a_larger_word(self) -> None:
        assert resolve_name_phrase("concatenate the docs", ["cat"]) is None

    def test_prefers_the_longest_containment_match(self) -> None:
        assert resolve_name_phrase("my work errands list", ["Errands", "Work Errands"]) == (
            "Work Errands"
        )
