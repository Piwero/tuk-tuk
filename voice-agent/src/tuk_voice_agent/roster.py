"""Voice tool roster, loaded from the file the MCP server and the browser also read (ADR 0014,
issue #364). One source of truth keeps the three sides from drifting; tests/test_contract.py pins it.

ponytail: resolves `shared/` relative to the repo checkout. `lk agent deploy` only ships
`voice-agent/`, so before the deploy story (T4/T9) the file must be copied or vendored into the
package build; swap this path then."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROSTER_PATH = Path(__file__).parents[3] / "shared" / "voice-tool-roster.json"


@dataclass(frozen=True)
class Tool:
    name: str
    kind: str  # "read" | "write"
    args: dict[str, Any]


def _load() -> tuple[int, dict[str, Tool]]:
    contract = json.loads(ROSTER_PATH.read_text())
    tools = {
        t["name"]: Tool(t["name"], t["kind"], t["args"])
        for t in contract["tools"]
        if "voice" in t["clients"]
    }
    return int(contract["contract_version"]), tools


CONTRACT_VERSION, VOICE_TOOLS = _load()
