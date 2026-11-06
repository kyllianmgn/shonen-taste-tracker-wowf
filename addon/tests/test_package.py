"""tools/package-addon.ps1: builds ForeverTracker-<version>.zip, ready to unzip into Interface/AddOns."""

import re
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "tools" / "package-addon.ps1"
ADDON_DIR = REPO / "addon" / "ForeverTracker"

POWERSHELL = shutil.which("powershell") or shutil.which("pwsh")
pytestmark = pytest.mark.skipif(POWERSHELL is None, reason="PowerShell not available")


def run_script(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPT), *args],
        capture_output=True,
        text=True,
        timeout=120,
    )


def toc_version(addon_dir: Path) -> str:
    text = (addon_dir / "ForeverTracker.toc").read_text(encoding="utf-8")
    return re.search(r"^## Version:\s*(\S+)", text, re.M).group(1)


def toc_files(addon_dir: Path) -> list[str]:
    lines = (addon_dir / "ForeverTracker.toc").read_text(encoding="utf-8").splitlines()
    return [line.strip() for line in lines if line.strip() and not line.startswith("#")]


def test_builds_zip_named_after_toc_version(tmp_path):
    result = run_script("-OutDir", str(tmp_path))
    assert result.returncode == 0, result.stderr + result.stdout

    zip_path = tmp_path / f"ForeverTracker-{toc_version(ADDON_DIR)}.zip"
    assert zip_path.exists()
    assert str(zip_path.name) in result.stdout


def test_zip_holds_the_addon_folder_with_forward_slashes(tmp_path):
    run_script("-OutDir", str(tmp_path))
    zip_path = next(tmp_path.glob("ForeverTracker-*.zip"))

    with zipfile.ZipFile(zip_path) as archive:
        names = [n for n in archive.namelist() if not n.endswith("/")]
        assert archive.testzip() is None

    assert all("\\" not in n for n in names)
    assert all(n.startswith("ForeverTracker/") for n in names)
    for path in toc_files(ADDON_DIR):
        assert f"ForeverTracker/{path}" in names
    assert "ForeverTracker/ForeverTracker.toc" in names
    assert "ForeverTracker/libs/LibDeflate/LICENSE.txt" in names


def test_zip_matches_the_sources_byte_for_byte(tmp_path):
    run_script("-OutDir", str(tmp_path))
    zip_path = next(tmp_path.glob("ForeverTracker-*.zip"))

    expected = {
        "ForeverTracker/" + p.relative_to(ADDON_DIR).as_posix(): p.read_bytes()
        for p in ADDON_DIR.rglob("*")
        if p.is_file() and "__pycache__" not in p.parts and not p.name.startswith(".")
    }
    with zipfile.ZipFile(zip_path) as archive:
        actual = {n: archive.read(n) for n in archive.namelist() if not n.endswith("/")}
    assert actual == expected


def test_skips_dev_leftovers(tmp_path):
    addon = tmp_path / "src" / "ForeverTracker"
    shutil.copytree(ADDON_DIR, addon)
    (addon / ".DS_Store").write_bytes(b"x")
    (addon / "__pycache__").mkdir()
    (addon / "__pycache__" / "x.pyc").write_bytes(b"x")
    out = tmp_path / "out"

    result = run_script("-AddonDir", str(addon), "-OutDir", str(out))
    assert result.returncode == 0, result.stderr + result.stdout

    with zipfile.ZipFile(next(out.glob("*.zip"))) as archive:
        names = archive.namelist()
    assert not any(".DS_Store" in n or "__pycache__" in n for n in names)


def test_refuses_when_core_version_differs_from_toc(tmp_path):
    addon = tmp_path / "src" / "ForeverTracker"
    shutil.copytree(ADDON_DIR, addon)
    core = addon / "Core.lua"
    core.write_text(
        re.sub(r'ns\.VERSION = "[^"]*"', 'ns.VERSION = "9.9.9"', core.read_text(encoding="utf-8")),
        encoding="utf-8",
        newline="\n",
    )
    out = tmp_path / "out"

    result = run_script("-AddonDir", str(addon), "-OutDir", str(out))

    assert result.returncode != 0
    assert "9.9.9" in result.stderr + result.stdout
    assert not list(out.glob("*.zip")) if out.exists() else True


def test_replaces_an_existing_zip(tmp_path):
    zip_path = tmp_path / f"ForeverTracker-{toc_version(ADDON_DIR)}.zip"
    zip_path.write_bytes(b"stale")

    result = run_script("-OutDir", str(tmp_path))

    assert result.returncode == 0, result.stderr + result.stdout
    assert zipfile.is_zipfile(zip_path)
