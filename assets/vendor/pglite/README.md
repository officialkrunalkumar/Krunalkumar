# PGlite — the PostgreSQL server behind `/labs/postgres`

Not a PostgreSQL emulator and not a SQL parser: the actual PostgreSQL backend compiled to
WebAssembly, running single-user in the visitor's tab.

|            |                                                                        |
| ---------- | ---------------------------------------------------------------------- |
| Project    | PGlite (`@electric-sql/pglite`)                                        |
| Version    | **0.5.5**, carrying **PostgreSQL 18.3**                                |
| Upstream   | <https://github.com/electric-sql/pglite>                               |
| SPDX       | `Apache-2.0` (PGlite) and `PostgreSQL` (the server it embeds)          |
| Full text  | `LICENSE` (Apache-2.0), `LICENSE.postgresql` (the PostgreSQL licence and copyright) |

**How that was established.** `index.js` and `pglite.wasm` are byte-identical (SHA-256) to
`@electric-sql/pglite@0.5.5`'s `dist/index.js` and `dist/pglite.wasm`. The server version is
stated by the binary itself: `pglite.wasm` contains the `version()` string
`PostgreSQL 18.3 (PGlite 0.5.5) on wasm32-unknown-linux-gnu`, which pins both numbers at once.

**Two licences, deliberately.** PGlite's own code — the loader, the chunked JS, the OPFS and
node filesystem shims — is Apache-2.0. The PostgreSQL source it compiles is under the
PostgreSQL Licence, which is a separate permissive licence with its own required copyright
notice; `LICENSE.postgresql` reproduces that notice, and it applies to the bulk of the bytes
here (`pglite.wasm`, `pglite.data`, `initdb.wasm`).
