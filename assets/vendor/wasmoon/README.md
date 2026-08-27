# Wasmoon — the Lua interpreter behind `/labs/lua`

Lua 5.4 compiled to WebAssembly with a JavaScript bridge over it. The whole runtime is about
420 KB, which is why the Lua lab starts instantly and the C++ one does not.

|            |                                                                        |
| ---------- | ---------------------------------------------------------------------- |
| Project    | Wasmoon                                                                |
| Version    | **1.16.0**, carrying **Lua 5.4**                                       |
| Upstream   | <https://github.com/ceifa/wasmoon>                                     |
| SPDX       | `MIT` (Wasmoon) and `MIT` (Lua, PUC-Rio — a different copyright holder) |
| Full text  | `LICENSE` (Gabriel Francisco), `LICENSE.lua` (Lua.org, PUC-Rio)        |

**How that was established.** Both shipped files are byte-identical (SHA-256) to
`wasmoon@1.16.0`'s `dist/index.js` and `dist/glue.wasm`. `index.js` also states its own version
inline — `version = '1.16.0'`, used to build the unpkg fallback URL for the wasm.

**The Lua patch level is inferred, not recorded.** `glue.wasm` contains the string `Lua 5.4`
and nothing more precise: Wasmoon builds the library without `lua.c`, so `LUA_COPYRIGHT` — the
one string that would carry the exact release and year — is never linked in. Wasmoon 1.16.0 was
published on 2023-12-08 and pulls Lua from a Git submodule of `lua/lua`, which at that date was
at 5.4.6 (2023-05-02); 5.4.7 did not exist yet. `LICENSE.lua` therefore reproduces the notice
from Lua 5.4.6's `lua.h`, `Copyright (C) 1994-2023 Lua.org, PUC-Rio`. The permission text is
Lua's standard MIT wording and is identical across the whole 5.4 series, so only the year range
depends on that inference. If Wasmoon is ever re-vendored, take the copyright line from the
`lua.h` of whatever release the new build pins.
