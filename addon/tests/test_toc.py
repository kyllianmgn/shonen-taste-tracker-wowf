from harness import ADDON_DIR, TOC_PATH, read_toc

# docs/01-spec-addon-companion.md, section "TOC".
EXPECTED_TOC = """\
## Interface: 16001
## Title: ForeverTracker
## Notes: Suit tes personnages pour le bot Discord
## Version: 0.1.0
## SavedVariables: ForeverTrackerDB
Locales/enUS.lua
Locales/frFR.lua
Core.lua
Collect.lua
Journal.lua
Sync.lua
Commands.lua
Bindings.xml
"""


def test_toc_matches_spec_exactly():
    assert TOC_PATH.read_text(encoding="utf-8") == EXPECTED_TOC


def test_toc_metadata():
    metadata, _ = read_toc()
    assert metadata["Interface"] == "16001"
    assert metadata["SavedVariables"] == "ForeverTrackerDB"
    assert metadata["Version"] == "0.1.0"


def test_every_toc_file_exists():
    _, files = read_toc()
    assert files, "TOC lists no file"
    for rel in files:
        assert (ADDON_DIR / rel).is_file(), rel
