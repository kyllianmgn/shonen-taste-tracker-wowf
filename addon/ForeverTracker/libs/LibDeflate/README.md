# LibDeflate (embedded)

- Source: https://github.com/SafeteeWoW/LibDeflate, tag `1.0.2-release`
  (`LibDeflate.lua` and `LICENSE.txt` from the repository root).
- License: zlib, see `LICENSE.txt` (C) 2018-2020 Haoqian He.
- SHA-256 of the original `LibDeflate.lua`:
  `76f2114e527c2be1ac5cf768a68084946a3e19f63592834640020b7c9b5a450f`.

## Modification

As the zlib license requires, this is an altered version: the end of `LibDeflate.lua` gets a short block,
marked "ForeverTracker modification", that stores the library in the addon's private table
(`ns.LibDeflate`). The client discards the value a TOC file returns, and the addon creates no global and
does not embed LibStub. Nothing else is changed.

When LibStub is loaded by another addon with LibDeflate 1.0.2 or newer, the file returns early and the block
does not run; `Share.lua` then takes the library from LibStub.

Used by `Share.lua` (`/ftr share`): `LibDeflate:CompressDeflate` (raw deflate, no zlib header).
