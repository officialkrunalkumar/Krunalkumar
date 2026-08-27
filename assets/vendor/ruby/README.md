# ruby.wasm — the CRuby interpreter behind `/labs/ruby`

The reference Ruby implementation compiled to WebAssembly against WASI, plus the JavaScript
packages that give it a browser host.

|            |                                                                        |
| ---------- | ---------------------------------------------------------------------- |
| `browser.umd.js`, `index.umd.js` | **`@ruby/wasm-wasi` 2.10.1** — <https://github.com/ruby/ruby.wasm> — `MIT` — text in `LICENSE` |
| `ruby.wasm` | **CRuby 3.4.1** (2024-12-25, revision `48d4efcb85`), built for `wasm32-wasi` — <https://www.ruby-lang.org> — `Ruby OR BSD-2-Clause` — text in `LICENSE.ruby` and `LICENSE.ruby-bsdl` |

**How that was established.** `browser.umd.js` and `index.umd.js` are byte-identical (SHA-256)
to `@ruby/wasm-wasi@2.10.1`'s `dist/` files of the same name; earlier 2.7.x and 2.8.x releases
differ, so the match is specific rather than incidental. The interpreter version is stated by
the binary: `ruby.wasm` contains the printable string
`ruby 3.4.1 (2024-12-25 revision 48d4efcb85) [wasm32-wasi]`, along with
`Copyright (C) 1993-2024 Yukihiro Matsumoto`.

**The two halves are on different clocks.** The JavaScript wrappers are current; the
interpreter binary is the 3.4.1 point release from December 2024. That is a real gap and not a
transcription error — both were checked independently — so re-vendoring should refresh
`ruby.wasm` and this table together.

**Ruby's own licence is a choice of two.** `LICENSE.ruby` is Ruby's `COPYING` file, which lets a
redistributor take either the Ruby Licence or the two-clause BSD licence; `LICENSE.ruby-bsdl`
is the `BSDL` file that `COPYING` refers to. Both are reproduced because `COPYING` is not
self-contained without it. Both files are taken from the `v3_4_1` tag, matching the binary.
