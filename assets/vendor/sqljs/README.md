# sql.js — the SQLite engine behind `/labs/sql` and the SQLite browser

SQLite compiled to WebAssembly with a small JavaScript API over it. At ~700 KB it is the
lightest runtime in this tree by two orders of magnitude.

|            |                                                                        |
| ---------- | ---------------------------------------------------------------------- |
| Project    | sql.js                                                                 |
| Version    | **1.13.0**, carrying **SQLite 3.49.1** (2025-02-18)                     |
| Upstream   | <https://github.com/sql-js/sql.js>                                     |
| SPDX       | `MIT` (sql.js); SQLite itself is public domain                          |
| Full text  | `LICENSE` — upstream's own file, which carries both the sql.js notice and the separate notice for the Makefile portions taken from Ryusei Yamaguchi |

**How that was established.** `sql-wasm.js` is byte-identical (SHA-256) to
`sql.js@1.13.0`'s `dist/sql-wasm.js`; the 1.11.0 and 1.12.0 files differ, so the match picks out
one release. The engine version comes from the binary: `sql-wasm.wasm` contains the
`sqlite_source_id` string `3.49.1` alongside
`2025-02-18 13:38:58 873d4e274b4988d260ba8354a9718324a1c26187a4ab4c1cc0227c03d0f10e70`.

**Why there is no `LICENSE.sqlite`.** There is nothing to reproduce. SQLite's authors have
dedicated the code and documentation to the public domain — "Anyone is free to copy, modify,
publish, use, compile, sell, or distribute the original SQLite code, either in source code form
or as a compiled binary, for any purpose, commercial or non-commercial, and by any means"
(<https://www.sqlite.org/copyright.html>). A public-domain dedication imposes no attribution
condition, so a licence file here would be inventing terms rather than honouring them. The
attribution above is offered because it is right, not because it is required.
