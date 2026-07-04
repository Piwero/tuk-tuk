"""Search: `search=` on GET /tasks matches titles, descriptions, and Check
Item titles, case-insensitively, and combines with the List / Tag / Priority /
completion filters. An empty query returns nothing — never a full dump.
"""

from fastapi.testclient import TestClient

from tests.conftest import make_task


def search(client: TestClient, query: str, extra: str = "") -> list[str]:
    response = client.get(f"/api/v1/tasks?search={query}{extra}")
    assert response.status_code == 200, response.text
    return [task["title"] for task in response.json()["items"]]


def test_the_query_matches_titles_case_insensitively(client: TestClient) -> None:
    make_task(client, "Buy groceries")
    make_task(client, "Write report")

    assert search(client, "GROCER") == ["Buy groceries"]


def test_the_query_matches_descriptions(client: TestClient) -> None:
    errand = make_task(client, "Errand")
    other = make_task(client, "Other")
    client.patch(f"/api/v1/tasks/{errand['id']}", json={"description": "pick up the dry cleaning"})
    client.patch(f"/api/v1/tasks/{other['id']}", json={"description": "nothing relevant"})

    assert search(client, "Dry Cleaning") == ["Errand"]


def test_the_query_matches_check_item_titles(client: TestClient) -> None:
    packing = make_task(client, "Pack bags")
    make_task(client, "Other")
    response = client.post(f"/api/v1/tasks/{packing['id']}/check-items", json={"title": "Passport"})
    assert response.status_code == 201, response.text

    assert search(client, "passport") == ["Pack bags"]


def test_an_empty_or_blank_query_returns_nothing(client: TestClient) -> None:
    make_task(client, "Anything")

    assert search(client, "") == []
    assert search(client, "%20%20") == []


def test_like_wildcards_in_the_query_are_literal(client: TestClient) -> None:
    make_task(client, "Save 50% on socks")
    make_task(client, "Save 500 dollars")

    assert search(client, "50%25") == ["Save 50% on socks"]
    assert search(client, "_") == []


def test_results_narrow_by_list_tag_priority_and_completion(client: TestClient) -> None:
    project: int = client.post("/api/v1/lists", json={"name": "Project"}).json()["id"]
    tag: int = client.post("/api/v1/tags", json={"name": "work"}).json()["id"]
    make_task(client, "Report draft", list_id=project, priority="high", tag_ids=[tag])
    make_task(client, "Report notes", list_id=project, priority="high")
    make_task(client, "Report inbox copy", priority="high")
    low = make_task(client, "Report backlog", list_id=project, priority="low")
    client.patch(f"/api/v1/tasks/{low['id']}", json={"completed": True})

    assert search(client, "report", f"&list_id={project}") == [
        "Report draft",
        "Report notes",
        "Report backlog",
    ]
    assert search(client, "report", f"&list_id={project}&priority=high") == [
        "Report draft",
        "Report notes",
    ]
    assert search(client, "report", f"&tag_id={tag}") == ["Report draft"]
    assert search(client, "report", f"&list_id={project}&completed=true") == ["Report backlog"]
    assert search(client, "report", f"&list_id={project}&completed=false&priority=low") == []


def test_priority_filters_without_a_query_too(client: TestClient) -> None:
    make_task(client, "Urgent", priority="high")
    make_task(client, "Whenever", priority="low")

    response = client.get("/api/v1/tasks?priority=high")

    assert response.status_code == 200, response.text
    assert [task["title"] for task in response.json()["items"]] == ["Urgent"]


def test_search_is_exclusive_with_computed_views(client: TestClient) -> None:
    for query in (
        "search=x&view=all",
        "search=x&range_start=2026-07-01&range_end=2026-07-31",
        "search=x&scheduled=false",
    ):
        response = client.get(f"/api/v1/tasks?{query}")

        assert response.status_code == 422, query
        assert response.json()["error"]["code"] == "validation_error"
