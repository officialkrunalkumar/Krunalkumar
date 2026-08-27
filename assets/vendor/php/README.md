# php-wasm — the PHP interpreter behind `/labs/php`

The real PHP interpreter compiled to WebAssembly, wrapped in a small ES-module runtime that
gives it a filesystem and an output buffer.

|            |                                                                        |
| ---------- | ---------------------------------------------------------------------- |
| Project    | php-wasm                                                               |
| Version    | **0.1.0**, carrying **PHP 8.4.1** (released 2024-11-21)                 |
| Upstream   | <https://github.com/seanmorris/php-wasm>                               |
| SPDX       | `Apache-2.0` (php-wasm) and `PHP-3.01` (the interpreter it embeds)      |
| Full text  | `LICENSE` + `NOTICE` (Apache-2.0, both upstream's own files), `LICENSE.php` (The PHP License, version 3.01) |

**How that was established.** Every file in this directory — `PhpBase.mjs`, `PhpWeb.mjs`,
`OutputBuffer.mjs`, `_Event.mjs`, `fsOps.mjs`, `resolveDependencies.mjs`,
`webTransactions.mjs`, `php8.4-web.mjs` and the hashed `e31ec3faf3e2323a2b4a448342b50307765b8217.wasm`
— appears at the same path, the same byte length and (spot-checked by SHA-256 on the two
largest) the same content in `php-wasm@0.1.0`. The wasm filename is upstream's own content
hash, which is why it looks like nothing in particular. The interpreter version comes from the
binary: `PHP/8.4.1` appears as a printable string inside it.

**Why `NOTICE` matters here.** Apache-2.0 §4(d) requires that a NOTICE file travelling with the
work be carried forward into redistributions. Upstream ships one naming Sean Morris as the
copyright holder; it is copied here unchanged rather than summarised.

**The interpreter is not Apache-2.0.** php-wasm's own wrapper code is; the PHP source compiled
into the `.wasm` is under The PHP License 3.01, whose clauses 3 and 4 restrict use of the names
"PHP" and "PHP Foundation" in derived products. `LICENSE.php` is the `LICENSE` file from the
`php-src` tag `PHP-8.4.1`, matching the interpreter that actually ships.
