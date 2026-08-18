# Krunalkumar Shah — Portfolio

Personal portfolio of **Krunalkumar Shah** — researcher, engineer, and cybersecurity-focused professional.

**Live site:** <https://krunalkumar.dpdns.org>

Built with plain HTML, CSS, and JavaScript. No frameworks, no build step, no dependencies — any static
web server can host it, and any computer with a browser can develop it.

---

## Pages

| Page                  | Purpose                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `index.html`          | Home — hero (with availability pill), expertise cards, selected work, blog teasers, certifications. 🥚 Six quick taps on the hero portrait toggle "dance mode" — the brand name's gradient animations speed up (wired in `particle-bg.js`; nothing stored, reload resets, inert under reduced motion) |
| `about.html`          | Profile — education (with ranks), career timeline, skills, community work, memberships |
| `services.html`       | Service lines — automation/AI, development, security, personal cyber help, coaching, corporate training, research — with FAQ (FAQPage JSON-LD) |
| `projects.html`       | Case studies, featured spotlight + paginated gallery of 35 repositories     |
| `research.html`       | Published paper on fork bomb defense, with summary cards and flowchart      |
| `blog/`               | Blog — `/blog` index (15 articles, first six visible + Show more) and one file per post, each with a static table of contents, article dates, and BlogPosting JSON-LD. Cards carry `data-category` (one of `security` / `automation-ai` / `career-mentorship` / `business`) powering the filter chips on the index; filtered views deep-link as `/blog#security` etc. New post = card in `blog/index.html` with a `data-category`, entries in `sitemap.xml` + `feed.xml` + `atom.xml`. Categories stay few and fixed; one can graduate to its own landing page once it holds ~8–10 posts |
| `client-reviews.html` | LinkedIn recommendations — featured quote + browsable carousel. The nav and footer labels are **Recommendations** (renamed from "Client Reviews" — labels only; the URL stays `/client-reviews`) |
| `internships.html`    | Two tracks — free selective internship + paid mentorship (₹4,999/mo, scholarships) — with application form and FAQ (FAQPage JSON-LD) |
| `contact.html`        | Direct contact links (email, WhatsApp, call booking) and a contact form     |
| `verify.html`         | Certificate verification — looks up completion-certificate IDs in `assets/data/certificates.json` (client-side, no backend). QR codes on certificates deep-link here as `/verify?id=…`. Offer letters are deliberately not verifiable online — institutions email instead. The generator lives in a private repo; `/generate` redirects to it (see `vercel.json`) |
| `privacy.html`        | Privacy policy — data collected, analytics, third parties, DPDP Act 2023 rights |
| `terms.html`          | Terms of service — engagement ground rules, payments, IP, liability, governing law |
| `refund.html`         | Refund policy — formalizes the mentorship first-week guarantee and consulting refund terms |
| `404.html`            | Animated space scene, random headlines & rocket flight paths (noindex)      |
| `terminal.html`       | 🥚 Hidden easter egg — fake Linux terminal with a fork-bomb demo of the research paper. Not in the nav or sitemap, `noindex`; `/admin`, `/secret`, and `/hack` redirect here (see `vercel.json`), and the browser console on regular pages drops a hint |
| `teapot.html`         | 🫖 Hidden easter egg #3 — HTTP 418 as an animated cartoon tea party (`/teapot`). Unlisted everywhere except the terminal's `teapot` command and a hint in `magic`; `noindex`, not in the sitemap; animations stop under reduced motion |
| `google46d0a7ad3f01b5a6.html` | ⚠️ **Do not delete or rename.** Google Search Console ownership proof — Google re-checks it periodically, and removing it eventually breaks Search Console access (search data, indexing, sitemaps). Invisible to visitors; unrelated to analytics/GTM |

## Project structure

```
├── index.html, about.html, ...   Pages (content only — header/footer are injected)
├── 404.html                      Custom not-found page (noindex)
├── favicon.ico                   Favicon, served from the site root
├── blog/
│   ├── index.html                Blog index — static card grid of every post
│   └── *.html                    One file per article (15 posts), static TOC in the markup
├── sw.js                         Service worker — caches /assets/vendor only (see Labs)
├── labs/
│   ├── index.html                Labs hub — language grid, OS grid, security tools, FAQ
│   ├── javascript.html, typescript.html, python.html, c.html, cpp.html, sql.html, lua.html
│   │                             One page per language; all share the same lab app
│   └── linux.html                Real Linux (v86) — a separate app, not a language page
├── partials/
│   ├── header.html               ★ Single source of truth for the navigation
│   └── footer.html               ★ Single source of truth for the footer
├── assets/
│   ├── css/main.css              All styles — organized into 13 numbered sections (see its table of contents)
│   ├── css/blog.css              Blog-only styles (index cards + post layout), loaded by blog pages
│   ├── js/boot.js                Head bootstrap: js-detect, partials-failure timer, GA4 loader
│   ├── js/include-partials.js    Loads header/footer into every page at runtime
│   ├── js/particle-bg.js         Particle canvas, reveal animations, nav behavior, back-to-top, auto year
│   ├── js/wa-form.js             Shared WhatsApp form handler (contact + internship forms)
│   ├── js/projects.js            Projects gallery pager + featured-card rotation
│   ├── js/client-reviews.js      Recommendations carousel + featured-card rotation
│   ├── js/blog-index.js          Blog index category filter chips + "Show more" reveal
│   ├── js/blog-toc.js            Fallback TOC builder for posts that lack a static one
│   ├── js/blog-share.js          Copy-link button in the post share row (the network links need no JS)
│   ├── js/verify.js              Certificate lookup on /verify
│   ├── js/terminal.js            Terminal easter-egg logic
│   ├── js/teapot.js              /teapot tap-to-pour logic + discovery event
│   ├── js/404.js                 404 rocket flight-path & headline randomizer
│   ├── data/certificates.json    Public record backing the /verify certificate lookup — update when issuing or revoking
│   ├── images/                   Portrait, logo, certification badges, OG share images, research flowchart (SVG)
│   ├── images/blog/              Blog post cover art (SVG) + og/ share images
│   └── pdf/                      Resume
├── .well-known/security.txt      RFC 9116 security contact file
├── site.webmanifest              Web app manifest (install metadata + icons; theme tracks --bg-base)
├── sitemap.xml                   Search-engine sitemap — update when adding pages or posts
├── feed.xml / atom.xml           RSS + Atom feeds for the blog — update when adding posts
├── llms.txt                      Curated link index for AI crawlers/assistants — update when adding pages or posts
├── llms-full.txt                 Full plain-text knowledge base (bio, career, research, projects, policies) for AI crawlers
├── robots.txt                    Crawl rules (incl. explicit AI-crawler allowlist) + sitemap pointer
└── vercel.json                   Clean URLs + security headers (strict CSP, HSTS, X-Frame-Options, nosniff, etc.) + Cache-Control for assets (no-cache for /assets/data) + noindex on the resume PDF, /partials, and /assets/data
```

---

## Architecture

### Shared header & footer (static copies + runtime upgrade)

Every page ships a complete **static** header and footer — visible from the first paint, so there
is no flash or pop-in — rendered without the JS-only extras. On load, `assets/js/include-partials.js`
(deferred in the `<head>`, with the partials preloaded) fetches `partials/header.html` and
`partials/footer.html` and swaps the static copies for the canonical versions, adding the hamburger
and the More dropdown, then marks the current page's nav link with `class="active"` and
`aria-current="page"`. When both partials are in place it fires a `partials:loaded` event, which
`particle-bg.js` waits for before wiring up nav behavior. Visitors with JavaScript disabled simply
keep the static copies — same look, minus the JS-only controls.

**To change the nav or footer: edit the file in `partials/` (the canonical markup), then update the
static copies in every page to match.** They are plain duplicates — a search-and-replace across
pages handles it — and the static header keeps each page's own link pre-marked active.

### One head bootstrap, zero inline scripts

`assets/js/boot.js` is the single `<head>` script on every page — loaded synchronously (no
`defer`) right before `main.css` so the `js` class lands before first paint. It consolidates what
each page used to carry as three inline blocks: JS detection, the partials-failure fallback timer,
and the GA4 analytics loader. Because of it, **no page ships
any executable inline script or inline event-handler attribute**, and the CSP in `vercel.json`
drops `'unsafe-inline'` from `script-src` — an inline script would simply be blocked, so keep new
behavior in external files loaded with `defer` (see the per-page files under `assets/js/`).
`<script type="application/ld+json">` blocks are data, not executable code, and are CSP-exempt.
(A GTM container used to load here too; it was published empty and removed — GA4 alone remains.)

### Clean URLs & domains

Pages live on disk as `about.html`, `services.html`, … but are **served extensionless**: `/about`,
`/services`. `"cleanUrls": true` in `vercel.json` makes Vercel resolve `/about` to `about.html` and
308-redirect `/about.html` → `/about`, so the `.html` form never appears in the address bar or the
search index. Files are never renamed — the mapping happens at request time. Because of this:

- **Internal links, canonicals, OG URLs, JSON-LD, and the sitemap always use the extensionless
  form** — `href="/about"`, never `href="about.html"`; home is `href="/"`.
- `include-partials.js` marks the active nav link by matching `location.pathname` (e.g. `/about`)
  against nav hrefs, normalizing `/index.html`, `.html` suffixes, and trailing slashes.
- The local dev server must resolve clean URLs too — see **Local development**.

The primary domain is **<https://krunalkumar.dpdns.org>**. `krunalkumar.vercel.app` and
`www.krunalkumar.dedyn.io` 308-redirect to it in one hop (configured in the Vercel dashboard, not
in this repo — the old `CNAME` file was removed; Vercel manages the domain, so no file in the
repo is involved). Every absolute URL in the codebase — canonicals, `og:url`, JSON-LD, `sitemap.xml`,
`robots.txt`, `.well-known/security.txt` — must use the primary domain: redirects and canonicals
must always agree, or search engines get mixed signals.

### Responsive "priority+" navigation

The navbar shows as many links as fit at the current width and moves the rest into a **More ▾**
dropdown, recalculating on load, resize, and font load:

- **Wide screens** — all links visible, no More button
- **Medium widths** — trailing links collapse into More one by one (rightmost first)
- **≤ 640px** — hamburger menu with all links flat

If the current page's link is inside More, the More button takes the active highlight. Logic lives in
`particle-bg.js` (`updateNavOverflow`), mobile breakpoint in both `main.css` and the
`mobileNavQuery` constant — change them together.

### Auto-updating copyright year

The footer year updates itself in three layers: static `2026` in the partial (no-JS fallback) → the
visitor's clock on load → the server's `Date` response header (authoritative, tamper-proof). No
annual edit needed.

### WhatsApp forms

The contact and internship forms don't need a backend: on submit, JavaScript builds a prefilled
`wa.me/<number>` message from the fields and opens WhatsApp. When the visitor returns to the tab,
the page asks whether the message went through — "yes" thanks them and clears the form, "not yet"
keeps their details for a retry. Both forms share one handler, `assets/js/wa-form.js`, wired
declaratively (no inline script): mark the `<form>` with `data-wa-form` and it self-initialises on
DOMContentLoaded. Five `data-*` attributes configure it, all required — `data-wa-fields`
(space-separated required field names, in display order), `data-wa-message-template` (the WhatsApp
message with `{field}` placeholders and `\n` for line breaks), `data-wa-analytics-prefix` (gtag
event prefix — `contact_form` fires `contact_form_submit` / `contact_form_confirmed`),
`data-wa-followup-question` (asked when the visitor returns from WhatsApp), and
`data-wa-confirmed-message` (success copy). Tel inputs inside such forms are filtered to
`[0-9+ ]` as the visitor types — pair them with a visible `.form-hint`. See the header comment in
`wa-form.js` for the full contract and a worked example.

A floating WhatsApp chat bubble (injected by `particle-bg.js`,
stacked under the back-to-top button) offers the same direct line from every page; its × hides it
for the rest of the tab session (kept in `sessionStorage` — no localStorage, no cookies — so the
bubble returns on a fresh visit) and back-to-top drops into its corner. The number
appears in every page's static footer, both form pages, the terminal easter egg, `refund.html`,
`assets/js/particle-bg.js`, `assets/js/terminal.js`, and `assets/js/wa-form.js` (`WA_NUMBER`) — to
change it, search-and-replace `8200713617` across the whole repo rather than editing files from a
list.

### Analytics events

GA4 (gtag) is loaded by `boot.js`. Beyond page views, Google Analytics receives conversion
events: `book_call_click`, `email_click`, `whatsapp_link_click`, `resume_download` (and
`pdf_download` for non-resume PDFs) via the global click listener in `particle-bg.js` — mirrored
on `/terminal` by `terminal.js` — plus `*_form_submit` / `*_form_confirmed` from `wa-form.js`,
`certificate_verified` from `verify.js`, and the easter-egg events `easter_egg_terminal`,
`fork_bomb_triggered`, `easter_egg_dance`, `easter_egg_teapot`, `easter_egg_teapot_cmd`, and `easter_egg_teapot_pour`.

### Visual layer

`particle-bg.js` renders the interactive particle canvas (respects `prefers-reduced-motion`),
scroll-reveal animations via IntersectionObserver, and the floating back-to-top button.
`main.css` is a single file organized into 13 numbered sections with a table of contents at the top.

The page background is a **single token**: `--bg-base` in section 1 (with `--bg-base-rgb`, the
space-separated twin used by the `rgb(var(--bg-base-rgb) / <alpha>)` surfaces that tint with the
page — the header, dropdown, section cards, footer and mobile nav panel). It is currently
`#121b2c`. Changing it is a four-part edit, not a one-liner — see
[Changing the page darkness](#changing-the-page-darkness).

The `#bg-canvas` gradient in `main.css` and the canvas gradient `particle-bg.js` paints over it are
**the same three stops** — the CSS one shows before the first animation frame and, with JS off,
forever. They used to be hand-maintained copies, which was a live hazard: the two files sit in the
same 1-hour cache bucket (`/assets/(js|css)/`) but expire independently, so a returning visitor
could pair a fresh stylesheet with a stale script and get the whole viewport repainted in the old
shade. `buildGradients()` now reads `--bg-base`, `--bg-mid` and `--bg-glow` from the stylesheet at
runtime instead, which makes `main.css` the single source of truth and removes the drift entirely.
The hardcoded values left in that function are fallbacks for a failed stylesheet load only — don't
"fix" them to match a new palette.

---

## Local development

Pages must be served over HTTP — the partials are fetched at runtime, and browsers block `fetch()`
on `file://` URLs — and the server must resolve clean URLs (`/about` → `about.html`). Vercel's
`serve` does both out of the box (clean URLs are its default):

```bash
npx serve .
```

Then open the printed localhost URL. A plain `python -m http.server` will serve the pages only at
their `.html` paths, so every internal link would 404 on it — use `serve` instead.

## Deployment

Hosted on **Vercel**, deployed automatically on push to `main`. Everything in the repository is
served as-is — there is no build step. `404.html` at the root is picked up automatically for
unmatched URLs.

---

## Common tasks

**Add a page**
1. Copy an existing page and replace `<main>` content, `<title>`, meta description, canonical URL,
   and Open Graph tags — all URLs extensionless (`https://krunalkumar.dpdns.org/newpage`, never
   `newpage.html`).
2. Add its link — `href="/newpage"`, no `.html` — to `partials/header.html` (nav),
   `partials/footer.html` (Explore column), and the static header/footer copies in every page.
3. Add an extensionless `<url>` entry to `sitemap.xml`.
4. Add a bullet to the `## Summary` section of `llms.txt` (and, if the page carries facts worth
   quoting, a section in `llms-full.txt`).

**Add a blog post**
1. Copy an existing `blog/*.html` post and replace the article content and the whole `<head>`
   metadata set: `<title>`, meta description, canonical (`/blog/<slug>`, extensionless), OG/Twitter
   tags pointing at the post's own share image, ISO-dated `article:published_time` /
   `article:modified_time`, and the BlogPosting + BreadcrumbList JSON-LD (matching dates). Keep the
   `feed.xml` / `atom.xml` `<link rel="alternate">` tags. Write the static "In this article" TOC
   (`.post-toc`) to match the post's `h2` headings — `blog-toc.js` only builds one when the static
   TOC is missing.
2. Update the `.post-share` block (it sits between `.post-body` and `.related-reading`): the three
   network `href`s hard-code this post's canonical URL and its og:title, so a copied post would
   otherwise share the post it was copied from. Encode the URL and title with `encodeURIComponent`,
   and write the `&` between X's `text=` and `url=` params as `&amp;`. The copy-link `<button>`
   ships with the `hidden` attribute — `blog-share.js` unhides it, so a visitor without JavaScript
   sees three working links instead of a dead button. Keep the `<script defer
   src="/assets/js/blog-share.js">` tag next to `blog-toc.js` in the head.
3. Add the post's card — a `.post-card` inside `.blog-grid` — to `blog/index.html`, with a
   `data-category` attribute so the filter chips pick it up
   (`blog-index.js` shows the first six and hides the rest behind Show more, so newest goes first).
4. Update the "From the blog" column if the post should be one of the seven highlighted there — in
   `partials/footer.html` AND the static footer copies in every page.
5. Add an extensionless `<url>` entry to `sitemap.xml`.
6. Add an `<item>` to `feed.xml` and an `<entry>` to `atom.xml`.
7. Add the post to **both** `llms.txt` (under `## Technical Articles` or
   `## Career, Mentorship & Practice`) and section 6 of `llms-full.txt` (title, date, one-line
   summary, and the post URL). The two files list the same posts — keep them in step.

**Add a project** — copy an existing `<a class="project-item">` card inside `#project-list` in
`projects.html` and edit its category, title, description, and href. The gallery is static HTML
(crawler-visible); `assets/js/projects.js` only paginates it. Add the `data-spotlight` attribute to
make the project eligible for the Featured spotlight rotation.

**Add a recommendation** — copy an existing `.recommendation-card` block inside
`.recommendation-carousel` in `client-reviews.html` and edit the quote, author, role, and date.
All cards are static HTML; `assets/js/client-reviews.js` only shows one at a time. The featured
recommendation is a separate static block (`#featured-recommendation-shell`) — update it
deliberately.

**Change internship tracks** — edit the tag list and the `<select>` options in `internships.html`.

**Change mentorship pricing** — the ₹ figure lives in `internships.html` in three places (track
card, the form's track `<select>` option, meta/OG descriptions); update all together. The refund
and scholarship terms in the "Straight answers" section are public commitments — keep the page in
sync with what is actually honored.

**Update the resume** — replace `assets/pdf/Krunalkumar-Shah-Resume.pdf` (keep the filename, or update
the link on `index.html`). The PDF path is served with `X-Robots-Tag: noindex` (see `vercel.json`) so
the file never outranks the homepage in search.

### Changing the page darkness

Pick the new base, work out the **rgb delta** from the current `--bg-base` (`#121b2c` =
`rgb(18, 27, 44)`), then apply that same delta to everything in the "shift with it" list. Applying
it to the base alone is the mistake to avoid: card fills are ~80% opaque, so they barely move when
the page does, and the elevation gap closes almost 1:1. Measured, a ~4 L\* lift of the base alone
cut `.info-card`'s elevation from +5.4 L\* to +1.4 — cards stop reading as raised and survive only
on their borders.

Shift with it:

1. `--bg-base` and `--bg-base-rgb` in section 1 of `main.css` (keep the hex and the
   space-separated channels the same colour), plus `--bg-mid` if you want the gradient's midpoint
   to move with it. The `#bg-canvas` gradient and the canvas in `particle-bg.js` both read these,
   so neither needs editing.
2. The raised-surface fills — the `background` declarations in `main.css` (grep the values —
   solids and gradient stops both) **and 3 in `blog.css`** (`.post-body pre`, `.post-toc`, and
   `.blog-filter`): `rgba(31, 44, 63, …)`, `rgba(46, 62, 80, …)`, `rgba(24, 36, 57, …)`, and the
   secondary-button hexes `#1f2c3f` / `#212d3c` (`.btn-primary` is accent-filled via
   `--accent-dark` and does not shift with the surfaces). Only `background` declarations —
   never a `box-shadow` that happens to use the same numbers.
3. The artwork, which is anchored to the same palette: the gradient stops in every
   `*-cover.svg` under `assets/images/blog/` (15 today — count them, don't trust this number), and the inline `<svg>` figure panels inside blog posts
   (`#1b2735`). `.post-cover` has no background of its own, so a cover left behind prints as a
   visibly darker rectangle against the page.
4. The `theme-color` meta in all 29 chrome-bearing pages — it tracks `--bg-base`, since the mobile
   address bar sits flush above the page-tinted sticky header. Leave `terminal.html` alone: it is
   standalone, has its own inline `<style>`, and its palette is deliberately not the site palette.
   `teapot.html` is standalone too but DOES track the site palette — shift its `theme-color`,
   its body gradient, and the `#121b2c`/`#1b2735`-family hexes in its inline scene.
5. The `theme_color` and `background_color` in `site.webmanifest` — both track `--bg-base`, and the
   app icons (`assets/images/icon-*.png`, `apple-touch-icon.png`) plus the root `og-*.jpg` cards
   bake the palette into pixels, so regenerate them after any sizable shift.

Leave alone:

- **Box-shadows.** They keep their dark `rgba(2, 6, 23, …)` / `rgba(15, 23, 42, …)` values on
  purpose — a shadow has to stay darker than whatever the page becomes.
- **Dark ink on light surfaces** — `color: #0f172a` on accent pills, `:hover` states, and form
  inputs. That is text on a *light* background, so lightening it lowers contrast.

Then re-check contrast. The tightest values are the dim blog meta grey (`#94a3b8`, currently
7.2:1) and anything on the brightest corner of the gradient; body text should stay in the low
teens. Keep normal text at 4.5:1 or better. Going much lighter than about `#0d1729` also starts
crowding the raised surfaces even when you do shift them.

## Conventions

- Every image needs `alt`, `width`/`height`, and (below the fold) `loading="lazy" decoding="async"`.
- Every indexed page needs a unique `<title>`, meta description, canonical, and OG tags; keep
  `sitemap.xml` lastmod fresh when content changes meaningfully.
- One `<h1>` per page; sections use `<h2>`/`<h3>`.
- The site is dark-theme only by design (`color-scheme: dark`). There is no light mode and no theme
  toggle: the palette is still ~83% hardcoded literals (220 of them) against seven custom
  properties, so a second theme would mean tokenizing every colour first, not adding a button.
- Changing the page darkness means editing four things together — see
  [Changing the page darkness](#changing-the-page-darkness). Editing `--bg-base` alone leaves the
  cards behind and flattens the site.
- No inline scripts, ever: `boot.js` is the only `<head>` bootstrap; everything else is an external
  file loaded with `defer`, and no element carries an inline event handler (`onclick=` etc.). The
  CSP has no `'unsafe-inline'` for scripts, so violations are blocked, not just frowned upon.
- `vercel.json` sets Cache-Control on `/assets/` (1 day, with a week of stale-while-revalidate;
  images get 30 days; **JS and CSS get 1 hour with a day of stale-while-revalidate**) —
  cache-sensitive changes to an asset may warrant a new filename. Note that separate files expire
  independently, so a change spanning several of them can be seen half-applied by a returning
  visitor; prefer making one file the source of truth over keeping copies in sync.
- **Exception:** `/assets/data/` is served `no-cache, must-revalidate`, and `verify.js` fetches
  `certificates.json` with `cache: 'no-cache'`. A verification page must never answer from a stale
  copy — a revoked certificate would keep reading "valid", and a newly issued ID would be called
  fake. Keep both in place if that file's caching is ever revisited.
- `/partials/` and `/assets/data/` are served with `X-Robots-Tag: noindex` (like the resume PDF)
  so fetched fragments and raw JSON never appear in search results.

## Labs (`/labs`)

Eleven language playgrounds, three real operating systems, fifteen security and forensics
tools, a typing test and an API tester, all executing **on the visitor's machine**.
There is no compile server: every runtime is a WebAssembly build of the real interpreter, fetched
from `/assets/vendor/` and run inside a Web Worker. No user code is ever transmitted anywhere,
which is both the privacy claim on the pages and the reason the section costs nothing to operate.

| Route | Engine | First-load |
|---|---|---|
| `/labs/c` | Real clang + lld on WebAssembly | ~58 MB |
| `/labs/sql` | SQLite on WebAssembly (sql.js) | ~700 KB |
| `/labs/cpp` | Real clang + libc++ on WebAssembly | ~58 MB |
| `/labs/python` | CPython on WebAssembly (Pyodide) | ~12 MB |
| `/labs/lua` | Lua 5.4 on WebAssembly (Wasmoon) | ~420 KB |
| `/labs/php` | Real PHP 8.4 on WebAssembly | ~14 MB |
| `/labs/javascript` | The browser's own JS engine, in a blob Worker | 0 KB |
| `/labs/ruby` | Real CRuby on WebAssembly (ruby.wasm) | ~17 MB |
| `/labs/postgres` | The actual PostgreSQL server (PGlite) | ~17 MB |
| `/labs/typescript` | Official `tsc` — real type checking, then run | ~9.6 MB |
| `/labs/linux` | A real Linux kernel + BusyBox on x86 emulation (v86) | ~8 MB |
| `/labs/dos` | Real FreeDOS on x86 emulation (v86) | ~720 KB |
| `/labs/bsd` | Real OpenBSD on x86 emulation (v86) | ~1.4 MB |
| `/labs/perl` | Real Perl 5 on WebAssembly (WebPerl) | ~16 MB |
| `/labs/typing` | Typing speed test — code and prose | 0 KB |
| `/labs/api` | HTTP request tester — the browser's own fetch, no proxy | 0 KB |

### HackLab — the vulnerable app sandbox (`/labs/hacklab`)

The offensive counterpart to the defensive tools: a deliberately vulnerable app the visitor is meant to break. Six challenges, each a live target with an objective, progressive hints, the full solution, and the real-world fix.

The two that matter for safety:

- **SQL injection is real.** It runs against `sql.js` (loaded via a plain `<script>` ahead of `hacklab.js`, the same engine as `/labs/sql`) on a throwaway in-memory database. The injection genuinely executes; there is simply nothing behind it.
- **XSS is real, and sandboxed.** The victim page is an `<iframe sandbox="allow-scripts">` with **no** `allow-same-origin`, giving it a unique opaque origin: the injected script runs but cannot read the page, touch storage, or make a credentialed request. It signals success by `postMessage` back to the parent. This required widening the CSP `frame-src` to `'self' blob:` — and the srcdoc/inline-script interaction under the strict global CSP is exactly the kind of thing verified against `prodserve.js`, never assumed.

Traversal, command injection and IDOR run against in-memory fakes. `hacklab.js` makes no network calls, holding to the same rule as the offline tools even though it is not built on `tool-shell.js`. Progress is stored under `lab.hacklab.solved` on the device only.

### Security & digital forensics tools

Fifteen tools sharing one shell (`assets/js/labs/tool-shell.js`), each implemented as a single
module under `assets/js/labs/tools/`. They carry no runtime download at all — every one is
plain JavaScript plus `crypto.subtle`, so the whole suite adds about 130 KB to the repo and
nothing to first load.

The privacy claim here is stronger than it is for the compilers, and load-bearing: these tools
take evidence files, production tokens, passwords, photographs and raw mail headers. None of the
modules contains a `fetch`, an `XMLHttpRequest` or a `sendBeacon`. The only input path is
`FileReader` over a file the visitor picked, and the only output path is a blob URL download.

| Route | What it does |
|---|---|
| `/labs/hash` | MD5, SHA-1, SHA-256, SHA-384, SHA-512 and HMAC for text or files, plus checksum verification and hash identification. |
| `/labs/file-inspector` | Identifies a file from its magic bytes rather than its extension, and flags the mismatch. Hex dump, printable strings and an entropy graph. |
| `/labs/jwt` | Decodes a JSON Web Token, explains every claim, checks expiry and verifies HMAC signatures. The token is never transmitted. |
| `/labs/exif` | Reads the camera, timestamp, serial number and GPS coordinates inside a photo, then re-encodes a stripped copy. |
| `/labs/email-headers` | Parses the Received chain, reads SPF, DKIM and DMARC results, detects Reply-To spoofing and extracts the originating IP. |
| `/labs/url-inspector` | Takes a suspicious link apart without ever requesting it: homograph characters, buried domains, nested encoding, open redirects. |
| `/labs/password` | Real entropy plus offline crack times against MD5, SHA-256, bcrypt and Argon2id. Generator uses crypto.getRandomValues. |
| `/labs/cert-decoder` | Decodes an X.509 PEM without OpenSSL: subject, issuer, validity, key size, SANs, extensions and fingerprints. |
| `/labs/certificate-forge` | Generate a real keypair and hand-build a self-signed X.509 cert, a CSR and a chain of trust; the DER is shown and the PEM parses in openssl. |
| `/labs/encoding` | Base64, Base64url, Base32, Base58, hex, URL, HTML entities, binary, decimal, Morse and JSON, with automatic format detection. |
| `/labs/cipher` | Caesar, ROT13, Atbash, Vigenere and XOR — and automatic cryptanalysis that breaks all of them without a key. |
| `/labs/steganography` | Hides a message in the least significant bits of a PNG, extracts one, and amplifies the low-bit plane to reveal concealed data. |
| `/labs/regex` | Live matching with capture groups, plus an empirical catastrophic-backtracking test and a library of security-relevant patterns. |
| `/labs/cvss` | The official base score formula with every metric explained and its contribution shown. Parses and emits vector strings. |
| `/labs/subnet` | IPv4 ranges, masks in every notation, the binary breakdown, and RFC 1918 / CGNAT / reserved-range classification. |
| `/labs/timestamp` | Reads a value under Unix, Windows FILETIME, WebKit, Apple Cocoa, HFS+ and MS-DOS epochs at once to identify which system wrote it. |

All fifteen are listed on the hub under **Cybersecurity & digital forensics tools** and share the
`SoftwareApplication` + `FAQPage` + `BreadcrumbList` schema emitted by the page generator. Their
Open Graph card is `assets/images/og-labs-security.jpg`; the compilers and terminals use
`assets/images/og-labs.jpg`.

Languages are ordered by the year each first appeared, and every registry entry carries its
`year`, which the hub cards show. `/krun` and `/lab` redirect to `/labs`; `/linux` 301s to
`/labs/linux`.


### How a run works

1. `lab-runtimes.js` is the **single source of truth** for what exists — name, engine, first-load
   size, Prism grammar, execution mode and the starter program. Adding a language means an entry
   here plus a branch in `lab-worker.js`; nothing else in the UI changes.
2. `lab-app.js` owns the page: editor (CodeJar + Prism), terminal pane, consent gate, storage
   meter, watchdog, and the language picker, which swaps language via `pushState` without a reload.
3. Execution happens in a Worker, never on the main thread:
   - **WASM runtimes** (Python, SQL, Lua) go to `lab-worker.js`.
   - **JavaScript** becomes the *source of a Blob Worker*. That is deliberate: the CSP allows
     `'wasm-unsafe-eval'` but **not** `'unsafe-eval'`, so `eval()` and `new Function()` are both
     blocked. Making the program *be* the worker script sidesteps the question entirely.
   - **TypeScript** is type-checked by `ts.createProgram` (not `transpileModule`, which only strips
     annotations and would let `const n: number = "x"` run), then the emitted JS takes the
     JavaScript path. The `lib.*.d.ts` chain lives in `assets/vendor/typescript/lib/`; `lab-worker.js`
     injects an ambient declaration for exactly the globals the sandbox provides — no `lib.dom`,
     because there is no DOM in a Worker.

### Why a Worker, and what stops a runaway program

A tight `while (true) {}` cannot be interrupted from the inside. The only reliable remedy is
`worker.terminate()` from the main thread, which is why nothing runs on the main thread and the
Stop button always works. On top of that `lab-app.js` escalates rather than killing silently:
an amber banner with a loud Cancel after 8s, a warning if the JS heap climbs steeply, an
immediate stop past a 4 MB output cap, and a hard terminate at 60s.

### stdin, and why there is no interactive prompt

Input is supplied up-front in the Input panel rather than read interactively. Blocking reads from a
Worker need `SharedArrayBuffer` + `Atomics.wait`, which needs COOP/COEP headers, which would break
the embedded analytics. Pre-supplied stdin is how most online compilers work anyway and costs no
headers at all.

### `/labs/linux`

`v86` emulates a 32-bit x86 machine; a genuine Linux kernel boots on it with a 227-applet BusyBox
userland. The image boots with `console=ttyS0`, so the kernel talks over the emulated **serial
port** — `linux-app.js` renders the terminal itself from `serial0-output-byte` rather than using
v86's VGA screen, which is why the pane matches the site and why `clear`, backspace and arrow keys
are handled explicitly. Login is automated (`root`, no password) and `dmesg` is replayed on boot,
because the kernel log goes to the VGA console the user never sees.

`memory_size` is a ceiling the emulator enforces, so a fork bomb exhausts *its* 64 MB and nothing
else — which is what makes it safe to demonstrate. Note the shell is BusyBox `ash`, not bash: the
famous `:(){ :|:& };:` is rejected with `bad function name`, and the working form is `f(){ f|f& };f`.
The machine is also completely sealed — no network device, and no way to reach the WASM runtimes
used by the language pages, since those are JavaScript objects and this is a separate CPU.

### CSP and caching

### Digital forensics tools

Six file-drop analysis tools on `tool-shell.js`, each a from-scratch parser of a binary format (HAR JSON, the SQLite file header via sql.js, the ZIP central directory, PCAP/PCAPNG, raw memory, the `regf` registry hive). Same rule as the rest of the offline set: no network call, everything computed from the dropped bytes.

| Route | What it does |
|---|---|
| `/labs/har-analyzer` | Find the secrets in a browser network export - tokens, cookies, keys, PII - and download a redacted copy safe to share. |
| `/labs/sqlite-browser` | Open any SQLite database - Chrome history, WhatsApp, app data - browse tables, run SQL, timestamps decoded. |
| `/labs/archive-inspector` | Inspect a ZIP without extracting it: zip-slip paths, zip bombs, encrypted entries and disguised executables. |
| `/labs/pcap-analyzer` | Read a packet capture: top talkers, protocols, DNS and HTTP, and plaintext credentials from unencrypted traffic. |
| `/labs/memory-strings` | Pull strings (ASCII and UTF-16), URLs, keys, crypto addresses and embedded files out of a memory dump. |
| `/labs/registry-viewer` | Parse a Windows registry hive for autostart keys, USB history and recent activity. No Windows required. |

### Interactive visualisers

Seven canvas/WebGL toys on their own tiny shell, `viz-shell.js` (not `tool-shell.js` — these are live loops, not request/response). The hash cracker runs its loop in a Blob-URL Web Worker so the page stays responsive and Stop works; the CPU simulator assembles with a real two-pass parser rather than `eval` (which the CSP forbids anyway); the shader and fractal labs compile GLSL on the GPU; the OS algorithm visualiser precomputes every frame up front so you can step backwards through a simulation as freely as forwards.

| Route | What it does |
|---|---|
| `/labs/hash-cracker` | Watch a weak password hash fall in real time, with the guesses-per-second counter ticking. Off the main thread. |
| `/labs/algorithm-visualizer` | Sorting and pathfinding, animated and steppable. See why O(n log n) beats O(n2) instead of being told. |
| `/labs/cpu-simulator` | Write assembly and step through it one instruction at a time, watching registers, flags, stack and memory change. |
| `/labs/shader-playground` | Write a GLSL fragment shader and see it render live on your GPU. Time and mouse uniforms, errors with line numbers. |
| `/labs/fractal-explorer` | Zoom the Mandelbrot and Julia sets smoothly on your GPU. Hover to pick a Julia constant. |
| `/labs/processor-explorer` | Fly from the chip package down to a single transistor - six labelled levels of semantic zoom, with data pulsing through every one. |
| `/labs/word-cloud` | Paste text and get a frequency-sized word cloud packed into a heart, star or cloud shape, in colours you choose, downloadable as a PNG. No upload, no watermark. |
| `/labs/tcp-congestion` | Step the three-way handshake with real seq/ack numbers, walk the TCP state machine, and watch Reno congestion control draw its sawtooth. Simulated, checked against RFC 793. |
| `/labs/buffer-overflow` | Watch a string copy climb over the saved frame pointer into the return address on a real byte-addressed stack, then hijack control flow and watch a stack canary catch it. NX/ASLR limits shown honestly. |
| `/labs/regex-engine` | Parse, Thompson NFA, subset construction, backtracking and a measured ReDoS blowup. Differentially tested against JavaScript RegExp. |
| `/labs/cryptography` | Step AES-128 round by round, SHA-256 across 64 rounds, and RSA/Diffie-Hellman/ECDH with checkable numbers. Checked against the NIST FIPS vectors. |
| `/labs/os-algorithms` | Step CPU scheduling, page replacement, disk scheduling, memory allocation and the Banker safety check one unit of time at a time, then compare every algorithm on the same input. |

### Network lookup tools

Five tools that **do** make requests, kept deliberately separate from the fifteen offline ones.
They are built on `assets/js/labs/net-tool-shell.js` and never on `tool-shell.js`, because that
file's header promises nothing built on it opens a connection — and fifteen pages depend on that
being literally true.

The rule they follow is not "no network" but: the visitor must know **who** is being contacted and
**what they learn**, before anything fires. So the shell enforces that the vendor is named up
front, that nothing fires on page load or a keystroke (only an explicit press), that every request
is echoed into the output pane as it goes out, and that a running request count stays visible.
There is still no proxy — the browser contacts the vendor directly.

| Route | Vendor | What it does |
|---|---|---|
| `/labs/dns` | Google or Cloudflare | A, AAAA, MX, TXT, NS, SOA and CAA over DNS-over-HTTPS, with your choice of resolver. A browser cannot speak DNS directly - this is how it gets there. |
| `/labs/email-security` | Google Public DNS | Can somebody send mail pretending to be this domain? SPF, DKIM, DMARC, MTA-STS and BIMI, parsed and graded, from public DNS alone. |
| `/labs/ct-log` | SSLMate Cert Spotter | Every certificate ever logged for a domain, and the subdomains printed on them - discovered without sending a single packet to the target. |
| `/labs/rdap` | the authoritative registry | Registration date, expiry, transfer locks and DNSSEC. Classic WHOIS needs a raw TCP socket; RDAP speaks HTTPS, so there is no proxy in the path. |
| `/labs/breach-check` | Have I Been Pwned | Is this password in a known breach? Only five characters of its hash are sent, and the comparison happens in your tab. k-anonymity, not a promise. |

Every endpoint was verified from a real browser under the production CSP, not just with curl —
curl proves a server *sends* `Access-Control-Allow-Origin`, not that a browser *accepts* the
exchange. Two findings from that: HIBP's `Add-Padding` header triggers a preflight that does
succeed, and `crt.sh` timed out on every attempt, which is why CT search uses Cert Spotter.

### Two consent gates, two storage keys

Every lab stores its consent under `lab.consent`, because they all make the same promise —
nothing you type leaves the machine — so agreeing once reasonably covers all of them.

`/labs/api` is the exception and stores `lab.consent.network` instead. It makes the *opposite*
promise: the request genuinely goes out. While it shared the common key, a visitor who accepted
a "nothing you paste is uploaded" gate on any of the fifteen offline tools arrived at the API
tester with the network warning already dismissed, having never seen it — the one notice that
actually matters was the one almost nobody read. The asymmetry is deliberate and one-way:
accepting the network gate does not unlock the offline tools either.

Three site-wide additions in `vercel.json`, all needed by the runtimes and tools:

- `'wasm-unsafe-eval'` in `script-src` — permits `WebAssembly.instantiate` and **nothing else**;
  `eval()` and `new Function()` stay blocked.
- `worker-src 'self' blob:` — for the JavaScript/TypeScript blob Worker, and for the regex
  tester, which runs both its matching and its ReDoS probe in a terminable Worker so a pattern
  with catastrophic backtracking gets cancelled instead of freezing the tab.
- `img-src ... blob:` — the EXIF stripper and the steganography tool decode an image the visitor
  chose through a blob URL. Without this they fail silently in production while working fine
  against a server that sends no CSP at all, which is exactly why `scratchpad/prodserve.js`
  exists.

These are on the single site-wide rule on purpose. A browser receiving more than one CSP header
enforces the **intersection**, so a second, looser rule scoped to `/labs` would be ignored in
favour of the stricter global one and WebAssembly would still be blocked.

`/assets/vendor/*` is served `immutable, max-age=31536000`. Those files are version-pinned and never
change in place, so repeat visits cost zero bandwidth — which is what keeps the section inside a
Vercel Hobby allowance.

### The storage meter

The ring in the toolbar reports two figures, deliberately separated because only one is ours to
clear: bytes this lab wrote to `localStorage` (clearable in the panel), and the total size of the
runtimes downloaded so far. The second is tracked by recording each runtime as it loads rather than
asking `navigator.storage.estimate()` — the runtimes live in the browser's HTTP cache, which the
Storage API does not measure and no page may inspect, so `estimate()` reported `0 B` against a
1.9 GB quota no matter what had been fetched.

### Editing the pages

`labs/*.html` and `labs/linux.html` are **generated**. The generator lives outside the repo (see
the session notes); if you edit a lab page by hand, keep the change in the HTML — or regenerate and
re-apply. Structure is shared; all prose is authored per language on purpose, because near-identical
pages across a language set is exactly what gets read as thin content.

### C and C++ run a real clang

`/labs/c` and `/labs/cpp` share a genuine toolchain: clang and lld compiled to WebAssembly (the
wasm-clang project), linked against a real libc and libc++. The pipeline is the real one — clang
`-cc1` emits a wasm32-wasi object, lld links it, the resulting module is instantiated and run. That
is why the whole STL works: `vector`, `string`, `map`, `<algorithm>`, templates, lambdas, virtual
dispatch, `unique_ptr`.

It is ~58 MB, fetched only on the first Run. An earlier version used the JSCPP interpreter and was
removed after testing showed it could not compile `struct`, `enum`, `class`, `std::string` or
`std::vector` — worth remembering before swapping in any "lightweight" C++ engine.

`shared.js` carries two local patches, both marked `PATCHED` in the source: the language is a
caller option (upstream always compiles `-x c++`, which would silently change what C means), and
the emitted filename follows it so diagnostics read `main.c` rather than `main.cc`.

### The service worker (`sw.js`)

Runtimes are cached through the Cache API rather than being left to the HTTP cache, because the
HTTP cache is invisible and untouchable from JavaScript. Without this, `storage.estimate()`
reported `0 B` however much had been downloaded, and there was no way to offer a "remove the
downloaded runtimes" button at all.

The fetch handler returns early for anything that is not a same-origin `/assets/vendor/` request —
no HTML, CSS or site JS is intercepted, so there is no stale-page class of bug. It has to be a
service worker rather than a fetch wrapper because Pyodide fetches its own `.wasm` internally and
`importScripts()` bypasses any shim; only a service worker sees those requests.

The storage panel then reports two genuinely separate figures, each with its own button: code and
settings in `localStorage`, and runtimes in `caches`. Clearing one never touches the other.

### The absolute VENDOR url in lab-worker.js

`VENDOR` is `self.location.origin + '/assets/vendor/'`, not `/assets/vendor/`. Some Emscripten
builds hand the path from `locateFile()` to their own loader, which resolves it against the
emitting script rather than the document root. WebPerl silently failed that way — it initialised
with no standard library and then produced no output at all, with no error anywhere. An absolute
URL removes the ambiguity for every runtime, and is the single line to change if these assets ever
move to separate storage.

### Worker scripts are cached separately

`new Worker(url)` uses a store the normal HTTP cache and a page reload do not touch, so a deployed
fix can keep running the previous worker indefinitely. `lab-app.js` appends `?v=WORKER_VERSION` —
bump it whenever `lab-worker.js` changes.

### Never name a worker helper `out`

Emscripten builds declare `var out = Module["print"] || …` at global scope, and `importScripts()`
runs them in exactly that scope — so a function called `out` in `lab-worker.js` is silently
replaced the moment such a runtime loads. WebPerl does this. The symptom is brutal: the program
runs, the output is captured, and then nothing is ever posted to the page, with no error. Any
runtime loaded afterwards in the same worker loses its output too. The helper is called `labOut`
for this reason.

### The Linux terminal sends LF, not CR

The tty on that image does not map CR to NL. Sending `
` for Enter meant nothing reading stdin
ever saw a line ending — `cat >> file` swallowed every line into one — and the echo came back as a
lone CR, which simply overwrote the same row on screen. Backspace is a separate trap: the shell
erases with a backspace (`0x08`) followed by `ESC[J` (erase to end of display), so that sequence has to be handled
or the character stays on screen.

### DOS mode switching uses `screen-set-size`

This build of v86 emits only `screen-put-char` and `screen-set-size`. There is no
`screen-set-mode` event, so a listener for one is never called. The third element of the
`screen-set-size` payload is the bit depth, and `0` means text mode — that is the actual flag for
swapping between the text pane and the canvas.

### Not shipped, and why

- **R** — WebR was not attempted; it is the largest of the candidates by some distance.
### `/labs/bsd` — the Mac-flavour terminal

OpenBSD, booted from its 1.44 MB install floppy. macOS itself can never be offered by anyone: it
is licensed to Apple hardware, cannot be redistributed, and v86 emulates a 32-bit PC that could
not boot it regardless. But the macOS command line *is* BSD underneath, and this is real BSD.

The page is explicit that it is small, because it is: the installer's rescue ramdisk carries
nineteen commands (cat, chgrp, chmod, cp, cpio, dd, df, ed, ksh, ln, ls, mkdir, mv, pax, rm, sh,
sleep, stty, tar) and no grep, sed, awk or uname. It is there to *feel* BSD — `ls -G` rather than
`ls --color` — not to get work done; the Linux terminal next door has 227 BusyBox applets for
that.

`bsd-app.js` is derived from `dos-app.js` because both render VGA text via `get_text_row()` rather
than a serial stream. The one addition is a poll for the `(I)nstall, (U)pgrade or (S)hell?` prompt,
which answers `S` automatically — the other two options would start partitioning a disk.
- **Java** — needs either CheerpJ (a third-party CDN script, which would puncture the privacy
  claim, plus non-commercial licensing) or DoppioJVM (unmaintained, Java 8, ~40 MB).
- **Windows cmd** — Windows cannot be redistributed and is far too large; ReactOS boots under v86
  but is 500 MB+ and lands in a GUI. FreeDOS (~0.7 MB) is the honest equivalent and is the planned
  route for a real `C:\>` prompt.

## SEO

Per-page meta descriptions, canonicals, Open Graph/Twitter cards pointing to a dedicated 1200×630
share image (`assets/images/og-image.jpg`; blog posts have their own under
`assets/images/blog/og/`), and JSON-LD structured data (ProfilePage wrapping the Person node,
WebSite and ProfessionalService on the home page — the business entity, carrying the Udyam/MSME
registration number and linked to the Person node by `@id`; ScholarlyArticle on the research page,
BlogPosting on blog posts); `sitemap.xml` + `robots.txt` +
RSS/Atom feeds (`feed.xml` / `atom.xml`, advertised via `<link rel="alternate">` on blog pages);
custom 404 with `noindex`; security headers via `vercel.json`. Since the static-header change, nav and footer
links are present in the raw HTML — crawlers discover pages without JavaScript — but keep
`sitemap.xml` accurate anyway; it remains the authoritative index request.

Two rules worth keeping when adding a page:

- **Titles ≤ 60 characters, meta descriptions 140–160.** Longer ones are not penalised by Google,
  but they get truncated in the SERP and every third-party auditor (Semrush, Ahrefs, Sitebulb)
  counts them as a defect — which is what a "low SEO score" usually is. `og:description`,
  `twitter:description` and the JSON-LD `description` deliberately keep the longer text: no length
  rule applies there, and social cards and AI crawlers benefit from the detail.
- **Every page except the home page carries a breadcrumb**, both visible and as `BreadcrumbList`
  JSON-LD, and the two must use the same labels. Put the `<nav class="breadcrumbs">` first inside
  `.page-hero`, above the eyebrow. Styling lives in section 5 of `main.css` so blog, labs and the
  top-level pages all share one definition — do not re-declare it in `blog.css` or `labs.css`. The
  home page has none on purpose: a one-item trail is ignored by Google and says nothing.

### AI crawlers — `llms.txt` and `llms-full.txt`

Two plain-text files at the site root, aimed at LLM crawlers and assistants (ChatGPT, Claude,
Perplexity, Gemini) rather than search engines:

- **`llms.txt`** — a curated link index in the [llms.txt](https://llmstxt.org/) format: `#` title,
  a `>` blockquote summary, then `## ` sections of `- [Name](url): description` bullets. Sections
  are `Summary`, `Full Context`, `Technical Articles`, `Career, Mentorship & Practice`, and
  `Optional`.
- **`llms-full.txt`** — the whole story in one file: identity, career timeline, research detail,
  project catalog, program terms, and policies, so an assistant can answer without fetching pages.

Conventions worth keeping:

- **`## Optional` means "safe to skip."** In the llms.txt format that heading tells a crawler with a
  tight context budget to drop those links first. Only genuinely secondary things belong there
  (policies, the security contact) — never `llms-full.txt`, which is why it sits under its own
  `## Full Context` heading.
- **Every URL is absolute and extensionless**, matching `cleanUrls` in `vercel.json`
  (`https://krunalkumar.dpdns.org/about`, never `/about.html`).
- **Facts in `llms-full.txt` are load-bearing** — an assistant will quote them verbatim. Dates,
  pricing, counts ("35+ projects", "30 testimonials"), and registration numbers must match the
  pages they came from; when a page changes, re-check the corresponding claim here.
- **No HTML link is needed.** Like `robots.txt`, these are found by root-path convention, and both
  are listed in `sitemap.xml`. There is no registered `<link rel>` for llms.txt, so nothing in
  `partials/footer.html` or the page `<head>` needs to point at them.

