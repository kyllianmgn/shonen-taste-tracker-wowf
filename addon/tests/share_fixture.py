"""Reference /ftr share code: contract/fixtures/share-code.sample.txt.

The server decodes this file (S-19), so it is produced by the addon itself on top of the stubs.
After a change of Share.lua or of this scenario, regenerate it from the repo root with:

    python addon/tests/share_fixture.py
"""

from __future__ import annotations

import base64
import json
import sys
import zlib
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from harness import FIXTURES_DIR, WowGame  # noqa: E402

SHARE_SAMPLE_PATH = FIXTURES_DIR / "share-code.sample.txt"
PREFIX = "FT1:"

LINK_HEAD = "|cff1eff00|Hitem:7720::::::::23:::::::|h[Coiffe en peau de « loup »]|h|r"
LINK_FEET = "|cffffffff|Hitem:2309::::::::23:::::::|h[Bottes en cuir \\ grossier]|h|r"


def decode_share_code(code: str) -> Any:
    """What the server does with /sync code: base64url, raw inflate, JSON."""
    assert code.startswith(PREFIX), code[:10]
    body = code[len(PREFIX):]
    raw = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
    return json.loads(zlib.decompress(raw, -15).decode("utf-8"))


def reference_session() -> WowGame:
    """A character with a guild, equipment and a few events, then /ftr share."""
    wow = WowGame()
    wow.set_state(
        zone="Vallée de Strangleronce",
        subZone="L'Éperon \"sud\"",
        guild="Les Éveillés",
        guildRank="Membre",
        inventory={1: LINK_HEAD, 8: LINK_FEET},
    )
    wow.load_addon()
    wow.fire("PLAYER_LOGIN")
    wow.advance(600)
    wow.fire("PLAYER_DEAD")
    wow.advance(600)
    wow.set_state(level=24)
    wow.fire("PLAYER_LEVEL_UP", 24)
    wow.fire("TIME_PLAYED_MSG", 82434, 0)
    wow.advance(60)
    wow.slash("/ftr share")
    return wow


def reference_code() -> str:
    return reference_session().ns.shareWindow.editBox.text


if __name__ == "__main__":
    code = reference_code()
    SHARE_SAMPLE_PATH.write_bytes(code.encode("ascii"))
    print(f"{SHARE_SAMPLE_PATH}: {len(code)} characters")
