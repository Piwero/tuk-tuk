"""Voice tool roster, loaded from the file the MCP server and the browser also read (ADR 0014,
issue #364). One source of truth keeps the three sides from drifting; tests/test_contract.py pins it.

ponytail: `lk agent deploy` ships only `voice-agent/`, so the agent reads a vendored copy next to
this module; tests/test_contract.py asserts it equals `shared/voice-tool-roster.json` when that
file exists. Copy it over after editing the shared file. Upgrade path: a mise task that syncs it."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROSTER_PATH = Path(__file__).parent / "voice-tool-roster.json"


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
