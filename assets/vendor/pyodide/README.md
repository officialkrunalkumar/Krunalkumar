# Pyodide — the CPython interpreter behind `/labs/python`

CPython itself compiled to WebAssembly, with its standard library shipped alongside as a zip
the runtime unpacks into an in-memory filesystem.

|            |                                                                        |
| ---------- | ---------------------------------------------------------------------- |
| Project    | Pyodide                                                                |
| Version    | **0.28.3**, carrying **CPython 3.13.2**                                |
| Upstream   | <https://github.com/pyodide/pyodide> — release artefacts from `https://cdn.jsdelivr.net/pyodide/v0.28.3/full/` |
| SPDX       | `MPL-2.0` (Pyodide) and `PSF-2.0` (the CPython it embeds)              |
| Full text  | `LICENSE` (Mozilla Public License 2.0), `LICENSE.cpython` (the CPython 3.13.2 licence stack — PSF, BeOpen, CNRI, CWI, and the third-party notices) |

**How that was established.** All five files here — `pyodide.js`, `pyodide.asm.js`,
`pyodide.asm.wasm`, `python_stdlib.zip` and `pyodide-lock.json` — are byte-identical (SHA-256)
to the published `v0.28.3` release. The version is also asserted twice inside the code:
`pyodide.js` carries `var ae="0.28.3"` and `pyodide.asm.js` sets `API.version="0.28.3"`, and the
loader throws unless the two agree.

**About `pyodide-lock.json` saying `0.28.0.dev0`.** Its `info.version` field reads
`0.28.0.dev0`, which looks like an unreleased development snapshot and is not one. The lock
file shipped here is byte-identical to the one in Pyodide's own `v0.28.3` release, so the stale
string is upstream's, not this repository's — the runtime that actually loads reports `0.28.3`.
Worth knowing before anyone re-vendors on the strength of that field alone.

**Two licences.** Pyodide's own code — the loader, the FFI, the package manager — is MPL-2.0.
The interpreter and standard library compiled into `pyodide.asm.wasm` and `python_stdlib.zip`
are CPython's, under the PSF Licence Agreement, which requires its own notice; that is what
`LICENSE.cpython` is, taken from the `v3.13.2` tag to match the version this build reports.
