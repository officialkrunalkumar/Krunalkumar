# SeaBIOS — the firmware v86 boots

Two ROM images. `seabios.bin` is the system BIOS the emulated machine starts executing at
power-on; `vgabios.bin` is SeaVGABIOS, the video BIOS that gives it a screen. They are not part
of v86 and are not under v86's BSD licence.

|            |                                                                        |
| ---------- | ---------------------------------------------------------------------- |
| Project    | SeaBIOS (including SeaVGABIOS)                                         |
| Version    | **rel-1.16.2**                                                         |
| Upstream   | <https://www.seabios.org> — these exact ROMs from <https://github.com/copy/v86> (`bios/`) |
| SPDX       | `LGPL-3.0-or-later`                                                    |
| Full text  | `LICENSE` (GNU Lesser General Public License v3 — upstream's `COPYING.LESSER`), `LICENSE.gpl3` (GNU General Public License v3) |

**How that was established.** Both files are byte-identical (SHA-256) to `bios/seabios.bin` and
`bios/vgabios.bin` in `copy/v86`. The release comes from the ROM itself — `seabios.bin`
contains the printable string `rel-1.16.2-0-gea1b7a0` — and is corroborated by upstream's build
script, `bios/fetch-and-build-seabios.sh`, which checks out the tag `rel-1.16.2` before
building. `vgabios.bin` identifies itself as `SeaBIOS VBE Adapter`, `SeaBIOS Developers`.

**Why two licence files.** The LGPLv3 is not a standalone licence: its own text says it
"incorporates the terms and conditions of version 3 of the GNU General Public License,
supplemented by the additional permissions listed below". Shipping `LICENSE` without
`LICENSE.gpl3` would hand a reader half a document. Upstream v86 ships only `COPYING.LESSER`;
the GPLv3 text is added here so the pair is complete.

**Source availability.** These are unmodified upstream builds. The corresponding source is the
SeaBIOS tag `rel-1.16.2` at <https://git.seabios.org/seabios.git>, built with the `.config`
files `copy/v86` keeps beside the ROMs (`bios/seabios.config`). Anyone who needs the source to
exercise their LGPL rights can reproduce these exact bytes from those two inputs.
