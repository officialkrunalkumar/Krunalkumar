# v86 — the x86 emulator behind `/labs/linux`, `/labs/dos` and `/labs/bsd`

An x86 CPU emulated in WebAssembly, well enough to boot real operating systems. This is the
only directory in the vendor tree that carries four separate licences, because it ships three
distinct things: the emulator, the BIOS ROMs it needs to start, and the disk images it boots.

|            |                                                                        |
| ---------- | ---------------------------------------------------------------------- |
| Project    | v86                                                                    |
| Version    | **0.5.432**                                                            |
| Upstream   | <https://github.com/copy/v86>                                          |
| SPDX       | `BSD-2-Clause`                                                         |
| Full text  | `LICENSE` — upstream's own file, "Copyright (c) 2012, The v86 contributors" |

**How that was established.** `libv86.js` and `v86.wasm` are both byte-identical (SHA-256) to
`v86@0.5.432`'s `build/` files. That pair is what pins the version: `v86.wasm` alone is
unchanged across 0.5.428–0.5.432, and `libv86.js` alone is unchanged from 0.5.432 through
0.5.442, so only 0.5.432 satisfies both.

## The rest of the tree is not v86's

`bios/` holds SeaBIOS ROMs under the LGPLv3 and `images/` holds three bootable disk images that
are mostly GPLv2. Each of those directories carries its own licence text and its own note —
see `bios/README.md` and `images/NOTICE.md`. Nothing under `bios/` or `images/` is covered by
the `LICENSE` in this directory, and treating them as if it were is exactly the mistake this
file exists to prevent.
