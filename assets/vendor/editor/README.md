# editor — the code editor every lab types into

Two small projects, not one. CodeJar turns a `contenteditable` element into an editor;
Prism paints the syntax highlighting it asks for. Neither is a runtime — they are the
front end that the eleven language runtimes sit behind.

|            |                                                                          |
| ---------- | ------------------------------------------------------------------------ |
| `codejar.js` | **CodeJar 4.2.0** — <https://github.com/antonmedv/codejar> — `MIT` — text in `LICENSE.codejar` |
| `prism.js`, `prism-langs.js`, `prism.css` | **Prism 1.29.0** — <https://prismjs.com> — `MIT` — text in `LICENSE.prism` |

**How the versions were established.** `prism.js` and `prism.css` are byte-identical
(SHA-256) to `prismjs@1.29.0`'s `prism.js` and `themes/prism-tomorrow.css`. `prism-langs.js`
is byte-identical to that release's minified components for `c`, `cpp`, `python`, `sql`,
`lua`, `typescript`, `bash`, `perl`, `markup-templating`, `ruby` and `php` concatenated in
that order, each followed by `;` and a newline — the file can be rebuilt from upstream
exactly. `codejar.js` is `codejar@4.2.0`'s `dist/codejar.js` with one change: the `export`
keyword on `function CodeJar` was removed so the file loads as a classic script rather than a
module. That single-token difference is the whole diff against upstream.

**Two licence files, not one.** Both projects are MIT but the copyright holders differ —
Anton Medvedev for CodeJar, Lea Verou for Prism — so each notice is kept verbatim under its
own name instead of being merged into one `LICENSE` that would belong to neither.
