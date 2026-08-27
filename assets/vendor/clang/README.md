# wasm-clang — the C and C++ toolchain behind `/labs/c` and `/labs/cpp`

A real Clang front end and a real LLD linker, both compiled to WebAssembly, plus the
sysroot they compile against. Nothing here is a transpiler or a server call: the visitor's
browser runs the actual compiler.

|            |                                                                        |
| ---------- | ---------------------------------------------------------------------- |
| Project    | wasm-clang (the demo harness) — `clang.wasm`, `lld.wasm`, `memfs.wasm`, `sysroot.tar`, `shared.js` |
| Version    | tracks `binji/wasm-clang` `master`; the toolchain inside is **Clang/LLVM 8.0.1** (released 2019-07-19) |
| Upstream   | <https://github.com/binji/wasm-clang>                                  |
| SPDX       | `Apache-2.0` (harness) and `Apache-2.0 WITH LLVM-exception` (the LLVM binaries) |
| Full text  | `LICENSE` (Apache-2.0), `LICENSE.llvm` (LLVM's own file — Apache-2.0 with LLVM Exceptions, the third-party section, and the legacy NCSA terms) |

**How that was established.** `clang.wasm`, `lld.wasm`, `memfs.wasm` and `sysroot.tar` are
byte-identical to the files of the same name in `binji/wasm-clang`: their Git blob SHA-1s
(`git hash-object`) match the `sha` GitHub reports for those paths. The compiler version comes
from the binary itself — `clang version 8.0.1` and `LLVM 8.0.1` appear as printable strings in
`clang.wasm`, and `lld.wasm` carries the matching `LLVM 8.0.1`. `shared.js` is the one file here
that is not upstream byte-for-byte: it is upstream's file plus two local changes that thread a
`lang` option through `compile()` and `compileLinkRun()` so `/labs/c` compiles C rather than
being handed to the C++ front end. Both changes carry `// PATCHED` comments naming this site,
which is what Apache-2.0 §4(b) asks of a modified file — those markers need to stay.

**What else is inside.** `sysroot.tar` bundles wasi-libc, libc++ and libc++abi — all under the
same Apache-2.0 with LLVM Exceptions terms as LLVM — and one unrelated header, `include/ctre.hpp`
(Compile Time Regular Expressions), which carries the full Apache-2.0 text inline in its own
file and so needs nothing added here.

**Keeping this correct.** If the toolchain is ever rebuilt against a newer LLVM, the table above
and `LICENSE.llvm` both have to move with it: LLVM's licence changed during the 8.0 cycle and the
file shipped here is the one that matches these binaries.
