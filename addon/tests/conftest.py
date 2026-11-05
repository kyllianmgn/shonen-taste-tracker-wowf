import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from harness import WowGame  # noqa: E402


@pytest.fixture
def wow() -> WowGame:
    """A fresh simulated client with the WoW stubs loaded and no addon yet."""
    return WowGame()
