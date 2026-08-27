# TypeScript — the compiler behind `/labs/typescript`

The official `tsc` compiler, unmodified, run in a Web Worker. The lab type-checks with the real
compiler and then runs the JavaScript it emits, which is why the `lib/` folder of `.d.ts` files
has to travel with it.

|            |                                                                        |
| ---------- | ---------------------------------------------------------------------- |
| Project    | TypeScript                                                             |
| Version    | **5.9.2**                                                              |
| Upstream   | <https://github.com/microsoft/TypeScript>                              |
| SPDX       | `Apache-2.0`                                                           |
| Full text  | `LICENSE` — upstream's `LICENSE.txt`, copied byte-for-byte including its CRLF line endings and the Microsoft copyright line at the head |

**How that was established.** `typescript.js` is byte-identical (SHA-256) to
`typescript@5.9.2`'s `lib/typescript.js`, all 9,111,680 bytes of it. The file also states its
own version internally as `version = "5.9.2"` and `versionMajorMinor = "5.9"`.

**`lib/` is part of the same release.** The 45 `lib.*.d.ts` files plus `index.json` are the
standard library declarations the compiler loads to answer questions about `Array`, `Promise`
and the DOM. They ship under the same Apache-2.0 terms as the compiler and are covered by the
same `LICENSE`.
