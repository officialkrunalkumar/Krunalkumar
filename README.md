# Krunalkumar Shah — Portfolio

Personal portfolio of **Krunalkumar Shah** — researcher, engineer, and cybersecurity-focused professional.

**Live site:** <https://krunalkumar.dpdns.org>

Built with plain HTML, CSS, and JavaScript. No frameworks, no dependencies — any static
web server can host it, and any computer with a browser can develop it. There is one deploy-time
pass (`scripts/build.js`), it runs only on Vercel, and it only strips CSS comments and freshens the
sitemap dates — the pages in this repository are the pages that get served. See **Deployment**.

---

## Pages

| Page                  | Purpose                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `index.html`          | Home — hero (with availability pill), expertise cards, selected work, blog teasers, certifications. 🥚 Six quick taps on the hero portrait toggle "dance mode" — the brand name's gradient animations speed up (wired in `particle-bg.js`; nothing stored, reload resets, inert under reduced motion) |
| `about.html`          | Profile — education (with ranks), career timeline, skills, community work, memberships |
| `services.html`       | Service lines — automation/AI, development, security, personal cyber help, coaching, corporate training, research — with FAQ (FAQPage JSON-LD) |
| `projects.html`       | Case studies, featured spotlight + paginated gallery of 51 repositories     |
| `research.html`       | Published paper on fork bomb defense, with summary cards and flowchart      |
| `blog/`               | Blog — `/blog` index (17 articles, first six visible + Show more) and one file per post, each with a static table of contents, article dates, and BlogPosting JSON-LD. Cards carry `data-category` (one of `security` / `automation-ai` / `career-mentorship` / `business`) powering the filter chips on the index; filtered views deep-link as `/blog#security` etc. New post = card in `blog/index.html` with a `data-category`, entries in `sitemap.xml` + `feed.xml` + `atom.xml`. Categories stay few and fixed; one can graduate to its own landing page once it holds ~8–10 posts |
| `client-reviews.html` | LinkedIn recommendations — featured quote + browsable carousel. The nav and footer labels are **Recommendations** (renamed from "Client Reviews" — labels only; the URL stays `/client-reviews`) |
| `internships.html`    | Two tracks — free selective internship + paid mentorship (₹4,999/mo, scholarships) — with application form and FAQ (FAQPage JSON-LD) |
| `contact.html`        | Direct contact links (email, WhatsApp, call booking) and a contact form     |
| `verify.html`         | Certificate verification — looks up completion-certificate IDs in `assets/data/certificates.json` (client-side, no backend). QR codes on certificates deep-link here as `/verify?id=…`. Offer letters are deliberately not verifiable online — institutions email instead. The generator lives in a private repo; `/generate` redirects to it (see `vercel.json`) |
| `buddha.html`         | 🪷 A still place (`/buddha`) — a cross-legged Buddha drawn in inline SVG, a verse from the Pali Canon that changes on load and on every tap, and a 4s-in / 6s-out breathing guide whose words are an easter egg. Every one of the 684 verses carries its citation: most "Buddha quotes" in circulation are modern fabrications, so anything added here must be checked against suttacentral.net or accesstoinsight.org first. He breathes on a 10s cycle, and every 9s opens his eyes and grins for 1.8s. Tapping him bounces him, bursts 14 sparkles and turns the verse over. A fullscreen button hands the whole screen to the scene. The sound control, the fullscreen button and **Another verse** all withdraw after ~3.2s of stillness and return on any sign of a person — a moved pointer, a tap, a Tab key — so the page can be sat with rather than used; a control the keyboard is focused on is never the one that disappears. 🥚 The breath words ("Breathe in / Breathe out") are hidden until you press `m`, and `m` again puts them away. Nothing is stored and a reload hides them again. Only the *words* are gated — the figure, his aura and the halo keep pacing the breath either way, and the screen-reader description of it never goes away. Documented in the terminal's `magic` page. Styles in `assets/css/buddha.css`, behaviour in `assets/js/buddha.js`; all motion is transform/opacity only and stops dead under `prefers-reduced-motion` |
| `privacy.html`        | Privacy policy — data collected, analytics, third parties, DPDP Act 2023 rights |
| `terms.html`          | Terms of service — engagement ground rules, payments, IP, liability, governing law |
| `refund.html`         | Refund policy — formalizes the mentorship first-week guarantee and consulting refund terms |
| `birthday.html`       | 🎂 A birthday card, rendered from `/birthday?name=…` and built by `/labs/wish-generator`. Chromeless and `noindex`, not in the sitemap or search index — it has no content of its own, so a crawled copy shows no name. Optional `&theme=` (candlelight · confetti · balloons · starlit · blossom · neon) and `&from=`. A missing name redirects to the generator. See [Wishes](#wishes-labswish-generator-birthday-festival) |
| `festival.html`       | 🎉 The same machine for festivals — `/festival?name=Diwali`. 92 festivals, each with the greeting people actually use and its own palette, motif and decoration. No theme picker by design: the festival **is** the theme, and a second dial would make it possible to send Yom Kippur in neon. Chromeless, `noindex`, same redirect rule |
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
│   └── *.html                    One file per article (17 posts), static TOC in the markup
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
├── scripts/build.js              Deploy-time pass — strips CSS comments, dates sitemap <lastmod> from git, checks its own output. Runs on Vercel, never on the repo (see Deployment)
├── .well-known/security.txt      RFC 9116 security contact file
├── site.webmanifest              Web app manifest (install metadata + icons; theme tracks --bg-base)
├── sitemap.xml                   Search-engine sitemap — update when adding pages or posts
├── feed.xml / atom.xml           RSS + Atom feeds for the blog — update when adding posts
├── llms.txt                      Curated link index for AI crawlers/assistants — update when adding pages or posts
├── llms-full.txt                 Full plain-text knowledge base (bio, career, research, projects, policies) for AI crawlers
├── robots.txt                    Crawl rules (incl. explicit AI-crawler allowlist) + sitemap pointer
├── package.json                  Zero dependencies. Exists to name `npm run build` / `npm run check` (both are scripts/build.js) and an engines floor of Node 18
├── .gitignore                    node_modules/, package-lock.json, .vercel/ — package.json makes these possible, none of them belong in the repo
└── vercel.json                   Build command + output directory + clean URLs + security headers (strict CSP, HSTS, X-Frame-Options, nosniff, etc.) + Cache-Control for assets (no-cache for /assets/data) + noindex on the resume PDF, /partials, and /assets/data
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

GA4 (gtag) is loaded by `boot.js`. **Note the endpoint is `googletagmanager.com/gtag/js` but there
is no GTM container** — one was published empty, cost ~314KB a view for nothing, and was removed.
`privacy.html` claimed both were loaded until that was corrected.

Beyond page views, Google Analytics receives conversion
events: `book_call_click`, `email_click`, `whatsapp_link_click`, `resume_download` (and
`pdf_download` for non-resume PDFs) via the global click listener in `particle-bg.js` — mirrored
on `/terminal` by `terminal.js` — plus `*_form_submit` / `*_form_confirmed` from `wa-form.js`,
`certificate_verified` from `verify.js`, and the easter-egg events `easter_egg_terminal`,
`fork_bomb_triggered`, `easter_egg_dance`, `easter_egg_teapot`, `easter_egg_teapot_cmd`, and `easter_egg_teapot_pour`.

| event | parameters | from | answers |
| --- | --- | --- | --- |
| `theme_change` | `theme: light \| dark` | `theme.js` | does anyone actually use light mode? |
| `search_open` | — | `site-search.js` | is the search icon found at all? |
| `site_search` | `results: <count>` | `site-search.js` | how often does a search return nothing? |
| `search_result_click` | `destination: <path>` | `site-search.js` | does search lead anywhere useful? |
| `chat_peer_connected` | — | `labs/chat.js` | do two people ever actually connect? |
| `media_start` | `media: voice \| video` | `labs/chat.js` | is the call feature used? |
| `media_blocked` | `reason: permissions_policy \| NotAllowedError \| …` | `labs/chat.js` | is something stopping it? |

`theme_change` fires on the **press**, never on the theme a page loads in — otherwise every page
view by a light-theme visitor would count as a change and the number would mean nothing.

`site_search` is debounced 900ms so "pyth" and "pytho" do not each count, and it reports **only the
result count, never the query**. `llms-full.txt` tells readers "no search query is ever sent
anywhere" and that has to stay true; a zero-result count still flags a content gap without turning
the search box into a log of what people typed. Sending `search_term` would make GA's built-in
search reporting light up, and would make that published claim false — do not add it without
changing the claim first.

`media_blocked` exists because of a bug worth not repeating: `vercel.json` shipped
`Permissions-Policy: camera=(), microphone=()`, and an **empty allowlist denies the feature to
every origin including this one**. The browser refused `getUserMedia` in ~34ms without ever
prompting, so the lab reported "permission denied" and no amount of granting permission helped.
The value is now `camera=(self), microphone=(self)`. Had this event existed, GA would have shown
`reason: permissions_policy` on every attempt.

### Visual layer

`particle-bg.js` renders the interactive particle canvas (respects `prefers-reduced-motion`),
scroll-reveal animations via IntersectionObserver, and the floating back-to-top button. It
watches `data-theme` on `<html>` and repaints on change — its gradient and particle
lightness are both theme-derived and baked into canvas paint, which CSS cannot restyle
afterwards (see "The canvas has to be told the theme changed").
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

Hosted on **Vercel**, deployed automatically on push to `main`. `vercel.json` sets
`"framework": null` (there is no framework to detect), `"buildCommand": "node scripts/build.js"`
and `"outputDirectory": "."` — the repository root *is* the deploy output, so every page is still
served as the file you see here. `404.html` at the root is picked up automatically for unmatched
URLs.

### The deploy-time pass (`scripts/build.js`)

Vercel clones the repo into a throwaway container, runs the script there, uploads the result and
discards the container. Nothing is written back to git. It performs two transformations and deliberately
nothing else, then checks its own output before letting the deploy succeed:

1. **Strips CSS comments.** 244 KB of stylesheet across the four files becomes 146 KB — 40% off,
   most of it from `main.css`, which is render-blocking on the 89 pages that load it. It does
   **not** collapse whitespace: that would save a little more and make every deploy-preview diff
   unreadable, which is a bad trade at this size.
2. **Rewrites `sitemap.xml` `<lastmod>` per file from git**, instead of the single hardcoded date
   every URL shares in the repo — which tells a crawler nothing and is wrong the day after it is
   written. A shallow deploy clone can only date the files touched inside the fetched history; the
   rest keep the date they already carry, and the script logs that that is what happened.

**Why the stripping happens at deploy time and not in the repo.** The comments in `main.css` are
the documentation — they carry the measurements ("`#008f34` measured 2.83:1 on the teal end of the
`.lab-cta` gradient"), the reason a value is what it is, and what breaks if it changes. Several
sections of this README are downstream of them. Deleting them by hand to save bytes would trade
the most valuable prose in the codebase for a few KB. Doing it in a container keeps both: git keeps
every comment, visitors get the smaller file.

**It is safe to run locally.**

```bash
npm run check    # dry run — prints what would change, writes nothing
npm run build    # the same work, in place
```

`build` is idempotent — a second run finds no comments left and writes identical bytes — so a stray
local run is not a problem to clean up. Every write is gated on the stylesheet still describing the
same rules: the ordered list of selectors must come out unchanged, braces must stay balanced, and
the output must not grow. Any of those failing throws instead of writing. (Comparing raw brace
counts is *not* a valid check and was the first attempt — `main.css` has a comment quoting a CSS
rule, braces and all, and the check flagged it as corruption. The scanner is comment-aware
throughout, which is also why a `content: "/*"` string cannot be mistaken for a comment.)

It finishes by checking its own output: 17 critical files present and above a size floor, nine of
them also matched against an expected marker, and at least 80 HTML pages on disk. Vercel keeps serving the
previous deployment when a build exits non-zero, so **failing the deploy is always safer than
publishing the damage** — that is what the throw at the end is for.

`package.json` exists only to name those two scripts and an `engines` floor of Node 18. It has
**zero dependencies**, and `.gitignore` (previously empty) now covers the things `npm install`
would create anyway — `node_modules/`, `package-lock.json` — plus `.vercel/`. Nothing generated is
committed.

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

**Never hand-edit the colophon's numbers** — `colophon.html` carries them in
`<span data-colophon="key">` placeholders and `scripts/build.js` rewrites every one at deploy.
The prose is hand-written and stays that way; the committed figures are the last deploy's, so the
page still reads correctly without a build. Add a fact by adding a placeholder and a key in
`colophonFacts()`.

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

### Theme toggle and site search

Two icon buttons sit in the header, positioned in the flow at phone widths and
absolutely in the corner from 641px up (above that the nav is a column, so a
third flex child would add a whole row).

**Theme.** `assets/js/theme.js` handles the press; `assets/js/boot.js` restores the
choice. Light is **opt-in only** — an earlier version followed
`prefers-color-scheme`, which handed a light site to anyone with a light desktop
without their asking. The listener is delegated from `document`, because
`include-partials.js` replaces the header after scripts run and would destroy a
directly bound handler.

The restore has to live in `boot.js`, not here: `theme.js` is `defer`red, so by
the time it runs the page has already painted in the default dark and a returning
visitor would see the wrong theme flash first. `boot.js` is synchronous and sits
above the stylesheet link, so `data-theme` is on `<html>` before the CSS is even
fetched. `particle-bg.js` reads that attribute when it builds its first canvas
frame, which is a convenient way to prove the ordering: if the first painted frame
comes out light, the attribute was set before paint.

Three details that were each a bug:

- **Only a press persists.** `apply()` takes a `persist` flag. The two calls on
  load exist to sync the address-bar colour and the button label; when they also
  wrote to storage, every page load rewrote the key with whatever the page started
  as — always dark. Combined with nothing reading the key back, a choice of light
  survived exactly until the next click on a link.
- **The key is `site.theme`, not `lab.theme`.** The labs namespace their storage
  under `lab.`, and `lab-app.js`'s "clear saved code and settings" button removes
  every `lab.*` key — which took the theme with it. `boot.js` still reads the old
  key as a fallback so an existing choice is not lost.
- **It is written to both `localStorage` and `sessionStorage`.** localStorage
  carries the choice to future visits; sessionStorage keeps the current tab
  working even where localStorage is blocked or gets cleared, so the theme cannot
  reset underneath someone mid-session.

**Search.** `assets/js/site-search.js` with a prebuilt index at
`assets/data/search-index.json` (88 pages, ~80 KB brotli on the wire, fetched only when the overlay opens). It opens a full-screen
overlay rather than a dropdown — roomier, and identical on a phone and a laptop.
The index is generated from the pages by `scripts/search-index.js`, and `scripts/build.js` rebuilds
it on every deploy, so it cannot describe content the site no longer has. Run
`node scripts/search-index.js --check` to see what would change, or without the flag to rewrite the
committed copy. This used to be a manual step documented here as "regenerate it when page content
changes", which is precisely the kind of instruction that gets skipped: when the generator was first
run, 75 of the 88 entries had drifted — three policy pages recorded as having no `<h1>`, the HackLab
heading still spelled with a hyphen the page had long since replaced with an em dash.

#### How the light theme was checked

Not by looking at pages one at a time — that is how the hero ended up invisible.
Every visible element with text is walked, its painted colour and real ground are
resolved, and anything under the WCAG AA floor is listed. Three things that pass
of the audit had to get right, each of which produced a confident wrong answer
first:

- **Read after the transition finishes.** Flipping `data-theme` animates colour
  through `transition: all 0.2s`. Reading mid-flight returns the *old* value, which
  reported every nav link as near-white on white. Disable transitions before
  measuring.
- **Gradient-clipped text has no `color`.** The brand is painted by a gradient with
  `background-clip: text` and a transparent fill, so `color` is `rgba(0,0,0,0)`.
  Resolve the gradient stops instead, or the headline elements are skipped as
  invisible-by-intent.
- **Compare the two themes, not light alone.** Most "failures" in a light-only run
  are dark-mode issues or by-design dimming (a disabled button at 0.45, a locked
  HackLab row, a ghosted TCP segment). Only what is *worse* in light is a
  regression worth fixing.
- **The ground is the canvas, not `body`.** `#bg-canvas` is `position: fixed` with
  `z-index: -1`, which paints it above `body`'s background and below every bit of
  content — so the pixels behind any text are the canvas gradient, not
  `getComputedStyle(body).backgroundColor`. An audit that models the background
  from CSS alone is reading a surface the visitor never sees. Sample the canvas
  with `getImageData` instead.

#### The canvas has to be told the theme changed

This one produced a completely invisible homepage headline and is worth stating
plainly, because the same shape can recur anywhere JS paints.

`particle-bg.js` builds its background gradient from CSS custom properties:

```js
backgroundGradient.addColorStop(1, cssColor('--bg-base', '#121b2c'));
```

`cssColor` reads the property **once**, and `buildGradients()` only ran at init and
on resize. CSS restyles itself when `data-theme` flips; a `CanvasGradient` baked
from those values does not. Toggling to light therefore repainted the entire
viewport in dark navy while the text above it went near-black — measured at
**1.01:1**. The fix is a `MutationObserver` on `data-theme` that rebuilds the
gradient and forces `drawFrame(0)`, a pure repaint. The repaint cannot be left to
the animation loop: it returns early while paused, and under
`prefers-reduced-motion` the canvas is a single static frame that would otherwise
keep the old theme for the rest of the visit.

The rule this generalises to: **anything JS paints from a theme value — a canvas,
an injected `<style>` string, an inline style, an SVG attribute — needs an explicit
repaint on `data-theme`, because CSS cannot reach back into it.**

Two corollaries, both found by auditing for that shape:

- **An inline style cannot follow the theme at all.** `processor.js` painted its
  build-failure notice with `msg.style.cssText = '...color:#fca5a5...'`. That
  paragraph is appended to the viz root, not the mount, so its ground goes light —
  and the pink that reads at 8.4:1 on the dark card is 1.68:1 on paper, hiding the
  one message that explains why the visualiser is blank. It is a class now
  (`.lab-viz-error`), styled in `labs.css` with a light counterpart.
- **Scope injected widget CSS by root id, not by class.** The light-theme rule that
  keeps the viz mounts dark ends in
  `:is(span, div, …):not([class]) { color: inherit }`. The `:not([class])` is
  load-bearing: without it the rule sits at (0,3,1) and outranks a widget's own
  class-scoped rules, so every label, hint and status tag in the multi-shell labs
  flattened to one ink — still readable, but the colour coding those labs teach
  with was gone. `os-algo.js` scopes its rules as `#osalgoviz .oa-field-label`,
  which outranks the site rule, and never flattened; `multi-shell.js` scopes by
  class and did. Class-less elements are the ones that genuinely need the site's
  ink, since they have no widget colour of their own.

Widgets that are dark instruments by design — the terminals, the editor, the
visualiser mounts, HackLab's fake corporate portal — re-pin the dark tokens rather
than being re-inked, so they render the same either way. The viz treatment is
scoped to the mounts, not `.lab-viz`: that root also holds ordinary site chrome
which is meant to go light.

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
4. The `theme-color` meta in all 89 chrome-bearing pages — it tracks `--bg-base`, since the mobile
   address bar sits flush above the page-tinted sticky header. Grep for the current hex rather than
   trusting that count. `terminal.html` is the one page that does not track it: it is standalone,
   has its own inline `<style>`, and its `#020617` is deliberately not the site palette — leave it.
   `teapot.html` is standalone too but DOES track the site palette — shift its
   `theme-color`, its body gradient, and the `#121b2c`/`#1b2735`-family hexes in its inline scene.
   `boot.js` rewrites this meta at load for a stored light theme, but only when it already holds
   `#121b2c` or `#f5f8fc`, which is what keeps `terminal.html` out of it. Change those two hexes
   there as well, or the address bar stops matching the page.
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
- Every indexed page needs a unique `<title>`, meta description, canonical, and OG tags; add its
  `<url>` to `sitemap.xml`. The `<lastmod>` on a new entry is a placeholder — `scripts/build.js`
  overwrites it at deploy time with the file's own last commit date (see **Deployment**), so it is
  the commit that has to be meaningful, not the date typed into the XML.
- One `<h1>` per page; sections use `<h2>`/`<h3>`.
- **The site works with JavaScript off.** Every page outside `/labs` is readable and navigable
  without it: the header and footer ship static (see "Shared header & footer"), the blog cards,
  post TOCs, projects gallery and recommendations are all static HTML that JS only filters or
  paginates, the three network share links on a post are plain `<a>`s, and `#bg-canvas` carries the
  same gradient in CSS that `particle-bg.js` would paint. Adding a feature means asking what it
  degrades to. The labs are the honest exception — a WebAssembly runtime cannot run without a
  script — so all 58 lab pages carry a `<noscript>` block (`.lab-noscript`, styled in `labs.css`)
  that says so plainly, explains that the work happens on the visitor's own machine which is why it
  cannot fall back to a server, and links to the blog, rather than presenting a dead editor.
- The site is dark by default, with an **opt-in** light theme behind the header toggle. Light is
  never applied automatically — `prefers-color-scheme` is deliberately ignored. Adding a colour
  means adding its light counterpart too; see "Theme toggle and site search" above for how that
  is verified.
- **Escape `<` in prose.** `<algorithm>`, `<?php` and `</dev/null` were each written literally in
  page copy, and the parser ate them: the C++ page read "so  and lambdas work", the PHP FAQ read
  "Do I need the ", and the cert-decoder's `openssl` command was truncated mid-line so anyone
  copying it got a broken command. Write `&lt;`. This does **not** apply inside
  `<script type="application/ld+json">` — script content is not HTML-parsed, and escaping there
  would put a literal `&lt;` into the structured data.
- Changing the page darkness means editing four things together — see
  [Changing the page darkness](#changing-the-page-darkness). Editing `--bg-base` alone leaves the
  cards behind and flattens the site.
- No inline scripts, ever: `boot.js` is the only `<head>` bootstrap; everything else is an external
  file loaded with `defer`, and no element carries an inline event handler (`onclick=` etc.). The
  CSP has no `'unsafe-inline'` for scripts, so violations are blocked, not just frowned upon.
  `style-src` **does** keep `'unsafe-inline'`, deliberately: pages use inline `style=""` attributes
  (the synth's black-key positions, for one) and hashes cannot cover attributes — a low-risk
  residual since inline styles cannot execute script.
- `connect-src` is scoped by path: site-wide it allows only same-origin and the GA beacon hosts,
  while `/labs/(.*)` gets `https:` — the network labs follow RDAP referrals to arbitrary registry
  hosts and the request tool fetches whatever URL the visitor types, so only the lab pages carry
  that grant. A new lab that talks to the internet works as-is; a new ROOT page that needs an
  external endpoint must add its host to the site-wide `connect-src` in `vercel.json`.
- `vercel.json` sets Cache-Control on `/assets/` (1 day, with a week of stale-while-revalidate;
  images get 30 days; **JS and CSS get 1 hour with a day of stale-while-revalidate**) —
  cache-sensitive changes to an asset may warrant a new filename. Note that separate files expire
  independently, so a change spanning several of them can be seen half-applied by a returning
  visitor; prefer making one file the source of truth over keeping copies in sync.
- **Exception:** `/assets/data/` is served with a 1-hour max-age (plus a day of
  stale-while-revalidate), but `verify.js` fetches `certificates.json` with `cache: 'no-cache'`,
  which forces revalidation regardless of that header. A verification page must never answer from
  a stale copy — a revoked certificate would keep reading "valid", and a newly issued ID would be
  called fake. The request-side `no-cache` is what guarantees that; keep it if the data-directory
  caching is ever revisited.
- `/partials/` and `/assets/data/` are served with `X-Robots-Tag: noindex` (like the resume PDF)
  so fetched fragments and raw JSON never appear in search results.

## A loud place (`/party`)

The counterpart to `/buddha`, and built to the same rules: its own scene palette in both
themes, controls that withdraw when idle, a fullscreen mode, and sound that is **synthesised,
never a file** (`party-sound.js` — see the header comment there for why). The music is a
thirty-two bar house arrangement rather than a loop, and it emits `party:beat` so `party.js`
can move the lighting with it; `party.js` runs its own clock at the same tempo when the sound
is off, so the room is never a still image.

Photosensitivity is a hard constraint here: every pulse is locked to the beat at 124 BPM
(2.07 flashes a second, under the WCAG 2.3.1 ceiling of three), no full-area flash swings a
large luminance step, and `prefers-reduced-motion` stops the room entirely.

## A still place (`/buddha`)

The generated sound has **four settings, cycled with `T`** — the same key as `/party`, so the pair
is learned once. Bhairavi at dawn, Yaman at dusk, Bhupali in the evening, and a sustained Om that
drops the flute entirely for a lower tonic and a formant-synth voice. Each track carries its own
drone tuning, tanpura, scale, bowl set and — the part that matters most for calm — its own pacing;
a slower setting is one where the silences are longer, not one that is quieter. Changing setting
slides the drone to the new tonic rather than cutting, and `m` still belongs to the breath words.

A quiet page, deliberately unlike the rest of the site.

**The verses.** 684 of them, in `assets/js/buddha.js`, one picked at random on load
and again on every tap, never the same one twice running. Each carries its
citation — the largest share from the Dhammapada, the rest from the Samyutta,
Anguttara and Majjhima Nikayas, the Itivuttaka, Udana, Sutta Nipata, Theragatha, Therigatha and
the Karaniya Metta Sutta. That constraint is load-bearing: a large share of the
"Buddha quotes" in circulation were never said by him. "Holding on to anger is
like grasping a hot coal", "what you think, you become" and "peace comes from
within" are all modern inventions, and the first draft of this file contained one
before it was checked. **Add nothing here without a citation verified against
suttacentral.net or accesstoinsight.org.**

**The figure.** Inline SVG, not an image — the site's CSP is `img-src 'self'`, so
an off-origin picture would be blocked outright, and vector stays sharp from a
phone to a 5K display. Drawn cute on purpose: the page should work for a child as
well as an adult.

**The motion.** Four idle cycles on deliberately different periods so they never
sync up and start looking mechanical — he breathes on 10s hinged at the lotus,
the aura pulses with him, the light in his hands twinkles on 3.2s, the halo rays
turn once every 90s. Every 9s he opens his eyes and breaks into an open smile for
1.8s. An earlier version opened them for 0.65s in every 13s, which meant you
could watch for a minute and never catch it.

**Tapping him** bounces the figure, flashes the aura, bursts 14 sparkles and
turns the verse over, with a 900ms guard so a fast second tap cannot start a
second bounce mid-flight.

**Layout.** Above 900px the verse sits beside him and the whole scene fits one
screen without scrolling. That needs the scene's own offset from the top of the
document, measured into `--b-header` by `buddha.js` — a plain `100svh` hero sits
below the site header and always hangs its last ~140px past the fold. Narrower
than 900px it stacks, and scrolling there is fine.

**Fullscreen.** The button fullscreens the scene only, so the header and the
section below are absent rather than hidden, and `--b-header` drops to 0 while it
is active. Hidden entirely where element fullscreen is unavailable (iOS Safari).

All motion is transform/opacity only, and the whole thing goes still under
`prefers-reduced-motion` — leaves and motes are removed rather than frozen,
because a leaf stopped halfway down the screen looks broken rather than peaceful.

## Wishes (`/labs/wish-generator`, `/birthday`, `/festival`)

A link generator and the two cards it builds. **The generator is the indexed page; the cards are
not** — everything on a card arrives in the query string, so a crawled copy would be a blank
greeting and three pages would compete for one query. `birthday.html` and `festival.html` are in
`NOINDEX_PAGES` **and** `CHROMELESS` in `scripts/build.js` and in `EXCLUDE` in
`scripts/search-index.js`. All three, or a gate fails the deploy.

```
/birthday?name=Riya&theme=starlit&from=Krunal
/festival?name=Diwali&from=Krunal
```

`name` is the only hard gate — without it there is nothing to say, so the page redirects to the
generator (not the home page: someone who opened `/birthday` wants to send a birthday wish, and the
generator completes that intent). `theme` is birthday-only and takes one of six; an unknown value
falls back rather than failing. `from` is optional on both.

**Files.** `celebrate-guard.js` (synchronous, in `<head>`) · `celebrate.css` · `celebrate.js` ·
`birthday.js` · `festival.js` · `festival-data.js` · `labs/tools/wish-generator.js`.

### Ten things here are decisions, not accidents

**The guard is a separate synchronous file.** A visitor with no `?name=` has to be redirected
*before* anything paints, or the page flashes a nameless greeting and then jumps. A deferred script
cannot do that, and an inline `<script>` is unavailable — `vercel.json` sets `script-src 'self'`
with no `'unsafe-inline'`, and a birthday page is not a reason to weaken a site-wide security
header.

**`/birthday` and `/festival` opt out of the site-wide framing ban, and only they do.** The
generator's preview is the real card in a same-origin `<iframe>`, so the global
`X-Frame-Options: DENY` and `frame-ancestors 'none'` in `vercel.json` — correct for every other page
here — turn that panel into a *refused to connect* box. The fix is a `/(birthday|festival)` rule
that re-sends both headers as `SAMEORIGIN` and `frame-ancestors 'self'`: framed by this origin,
still not framed by anyone else, and nothing else on the site loosened. It is a **header** problem,
not a markup one — the iframe tag is fine, and no amount of editing it will help. Vercel applies
the last matching rule per header key, so the override must stay **below** the global `/(.*)` block;
`/labs/hacklab-guestbook` does the same thing for the same reason.

**The name is sanitised, and the threat is defacement, not XSS.** XSS is handled structurally —
nothing ever assigns `innerHTML` from a URL value, `textContent` only, everywhere. The character
whitelist exists for the other attack: `krunalkumar.dpdns.org/birthday?name=<something vile>` would
render that in 4rem type under this site's wordmark, and the screenshot would be indistinguishable
from something the site published. Names are letters, marks, digits and four joiners; no punctuation
to build a sentence with. Bidi overrides (U+202E) and zero-width characters are stripped outright —
this site publishes a Linux security paper and a lab that teaches that exact trick. Unicode is
handled with `\p{L}\p{M}\p{N}`, because an ASCII whitelist would mangle a large share of the names
this site's actual visitors have.

**The query string is wiped, and the link is not lost.** `replaceState` after render, so the card
reads as a page made for that person. That breaks the obvious re-share (copy the address bar,
forward it), so the card carries a **Copy link** button that rebuilds the full URL from the values
the guard parked on `window.KSWish`. That is why the guard keeps them instead of discarding them
after the redirect check.

**The cards are designed to be screenshotted.** Portrait-first for a 9:16 status; confetti settles
rather than looping, so a screenshot never catches debris mid-air; the `KS_` wordmark is part of the
composition rather than a watermark, because a screenshot travels without its URL. Under
`prefers-reduced-motion` the physics is stepped silently to its resting state and painted **once** —
the obvious "draw nothing" hands the people who asked for less motion a blank stage and a worse
birthday.

**Size the emoji motif with `font-size`, never `width`.** The festival glyph's span is
`inline-block` so its box shrink-wraps the character; the aura is then positioned against that box.
Any rule that puts a `width` back on it decouples the two and the emoji drifts off-centre from the
text. That is not hypothetical — the `@media (max-height: 34rem)` block did exactly this, because
`.c-motif { width: … }` is right for the birthday SVG and wrong for the glyph. It shipped to a
screenshot because it only appears on a SHORT viewport: a desktop window with toolbars hits it,
every phone is tall enough to miss it. **When testing this page, vary height as well as width** —
sweeping widths at a fixed tall height finds nothing.

**The festival's name is shown when the greeting does not contain it.** 39 of the 92 greetings are
phrases that never name the festival — `G'mar Chatima Tova`, `Saal Mubarak`, `Kai Po Che!`,
`Onashamsakal`, `Ganpati Bappa Morya`. Using the authentic greeting is right, but on its own it left
the recipient with words they might not recognise and no way to tell what was being wished. So
`scene()` returns a `label`, set only when the greeting does not already contain the name, rendered
as a small tracked eyebrow above it. "Happy Diwali" and "Merry Christmas" get none. It is also read
out first by the live region, and it is brighter on solemn observances — the muted palettes are
exactly where knowing what day it is matters most.

**Solemn observances are in the dataset, and dressed differently.** Yom Kippur, Muharram and Ashura,
Qingming and Obon carry `solemn` and render with no festoon lights, no breathing motif and muted
palettes. They are included rather than omitted *precisely so* typing "ashura" cannot fall through
to the generic confetti card. If you add an observance of mourning or atonement, match that
treatment.

**Save as image redraws the card, it does not screenshot it.** html2canvas is impossible here
(`script-src 'self'`, no bundler) and the `<foreignObject>` trick taints the canvas in Safari and
Firefox, so `toBlob` throws exactly where it is needed most — on a phone. So `exportCard()` in
`celebrate.js` draws the composition again natively at 1080×1920. That is a second implementation
of the layout and a real maintenance tax, taken deliberately: the output beats the screenshot it
replaces (exact dimensions, no status bar, no address bar, identical on every device). The two
things most likely to drift are *not* duplicated — the motif is the page's own `<svg>` serialised
with its CSS variables resolved, and the particles are the same `Scene` class run to rest on the
export canvas. It measures the whole block before drawing so the composition stays centred whatever
length the name and greeting run to.

**Festival matching is fuzzy on purpose.** Transliterated names have no canonical spelling — the
owner of this site writes "Bestu Varsh" where the dataset says "Bestu Varas" — so enumerating
variants by hand is a losing game. Exact match, then substring, then Levenshtein with a tolerance
that scales with length so short words cannot collide. `diwaly`, `crismas`, `navrati` and
`gujarati new year` all land right; anything genuinely unknown gets a warm generic card.

> **Editing `festival-data.js`:** it is generated, but the greetings were put through an adversarial
> cultural-accuracy pass and the corrections are baked in. Do not regenerate it from a model without
> repeating that pass. The failure mode is not a build error — it is greeting somebody incorrectly on
> their own holy day. "Happy Eid" is wrong; it is "Eid Mubarak".

## Lab preview images (`og:image`)

Every lab has its **own** `og:image` — `assets/images/og-lab-<slug>.jpg`, 1200×630. They used to
share four category images, so 22 security tools posted an identical preview card and a shared link
said "Labs" rather than saying which tool it was.

They are **generated**, not hand-made, because 62 hand-designed cards is not a thing anyone
maintains. The generator reads each page's `<title>` (the tool's name, not the SEO headline) and
`og:description` (its first sentence), and infers the category — and therefore the accent colour and
the eyebrow label — from whichever category image the page pointed at before, since that
categorisation was already made by hand once.

Four cards are deliberately excluded and keep what they have: `resume-maker` and `biodata-maker`
(hand-made, and they show the actual product, which no generator can), `wish-generator` (purpose-made
for the same reason), and `labs/index.html` (the hub, where `og-labs.jpg` is the correct image).

Regenerate with `scripts/make-lab-og.py`:

```bash
python scripts/make-lab-og.py --apply
```

Without `--apply` it writes the images but leaves the HTML alone; pass a slug to do just one lab.
It is **not part of the build** — Vercel only runs `node scripts/build.js` — and it is the single
thing in this repository that needs something outside Node (`pip install Pillow`). That exception is
deliberate: the site keeps its zero runtime dependencies, and this runs by hand about twice a year
when a lab is added. It reads Segoe UI and Consolas from `C:/Windows/Fonts`, so adjust `F` at the top
to run it on another platform.

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

### Peer-to-peer chat (`/labs/chat`)

The one lab that opens a network connection, and the only one not built on
`tool-shell.js` — whose header promises that nothing built on it ever does.
Keeping that promise true for the other 58 tools is why this has its own shell
and its own warning at the top of the page.

**What it teaches.** A browser cannot listen on a port. There is no API that
binds a socket and accepts a connection — `fetch`, `WebSocket`, `EventSource`
and `RTCPeerConnection` all dial out. That is deliberate: a page that could
listen would make every open tab a reachable server. So `nc -l -p 1234` has no
browser equivalent, both sides here are the dialling side, and the page shows
the ICE handshake happening so the difference is visible rather than asserted.

**Topology.** A star. Everyone connects to whoever opened the channel, and that
browser repeats what it hears. Three people is two code exchanges, not three —
a full mesh would need N(N-1)/2. Only the host relays, so a message cannot
circle the room. Guests never forward.

**The code.** `assets/js/labs/chat.js` does not send the SDP. Measured on a live
offer: 988 characters, of which 14 of the 21 lines are byte-identical on every
WebRTC connection ever made. Only the fields that vary go on the wire — ICE
ufrag, ICE password, the 32-byte DTLS fingerprint, and each address and port —
packed as raw bytes and rebuilt from a template on arrival. That took the
invitation from 805 characters to 243 and the reply from 803 to 147.

Gzip was tried first and only saved 19%: 56 of those bytes are cryptographic
randomness, and random data does not compress. Going below ~96 characters would
need deriving the ufrag and password from the fingerprint, which requires SDP
munging — Chrome has stated it will reject that and has been instrumenting it
since Chrome 82, so it is not worth building on.

**QR.** `assets/js/labs/qr.js` is a from-scratch ISO/IEC 18004 encoder (byte
mode, versions 1–20, EC level L) because the CSP is `script-src 'self'` and
there is no bundler to vendor a library with — `scripts/build.js` only strips CSS
comments, it does not resolve or package anything. A 243-character code lands at
version 10, a 57×57 grid.
Offered next to Copy rather than instead of it: the clipboard is faster on a
laptop, the camera is the only sane option between two phones.

**Files.** 16 KB chunks with real backpressure — the sender stops whenever the
channel's buffered amount passes 256 KB and waits for `bufferedamountlow`,
because a DataChannel accepts writes far faster than it can send them and the
excess queues in memory. Where `showSaveFilePicker` exists (Chrome, Edge) the
receiver chooses a destination first and every chunk goes straight to disk, so
there is **no size limit**. Elsewhere the chunks assemble into a Blob and the
cap is 512 MB, because a phone asked for a gigabyte-sized Blob dies.

**Voice and video are one-to-one only.** Relaying text is free; relaying video
is not — a browser cannot forward someone else's stream without re-encoding it,
which is what an SFU server is for. Group video would need a full mesh: three
people is 6 pastes, four is 12.

**STUN.** On one network it connects with nothing external. Across the internet
each side asks a STUN server what public address it appears to come from; no
message passes through it. Without TURN a minority of network pairs cannot be
connected at all, and the page says so instead of spinning.

### HackLab — the vulnerable app sandbox (`/labs/hacklab`)

The offensive counterpart to the defensive tools: a deliberately vulnerable app the visitor is meant to break. Forty-two challenges (the original six, plus the batch `hacklab.js` appends after them), each a live target with an objective, progressive hints, the full solution, and the real-world fix.

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

All sixteen are listed on the hub under **Cybersecurity & digital forensics tools** and share the
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

Twelve canvas/WebGL toys on their own tiny shell, `viz-shell.js` (not `tool-shell.js` — these are live loops, not request/response; `/labs/certificate-forge` is a thirteenth `viz-shell.js` page, listed with the security tools above because that is where it sits on the hub). The hash cracker runs its loop in a Blob-URL Web Worker so the page stays responsive and Stop works; the CPU simulator assembles with a real two-pass parser rather than `eval` (which the CSP forbids anyway); the shader and fractal labs compile GLSL on the GPU; the OS algorithm visualiser precomputes every frame up front so you can step backwards through a simulation as freely as forwards.

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

These are on the single site-wide rule on purpose, and the reason is Vercel's header semantics rather
than the browser's. **Vercel replaces per header key — the last matching `headers` rule wins — so a
response carries exactly one `Content-Security-Policy`, never two.** The often-quoted rule that a
browser receiving multiple CSP headers enforces their *intersection* is real, and simply never gets
the chance to apply here.

The trap that follows is the one worth remembering: **a scoped rule replaces the entire policy, not
only the directives it names.** Whatever it does not restate is gone on those paths.
`/labs/hacklab-guestbook` is the proof — it deliberately sends a short, tight policy, and the live
response carries eight directives where every other page carries fourteen: no `worker-src`, no
`object-src`, no `upgrade-insecure-requests`. Note that those do not all fail the same way: fetch
directives fall back to `default-src`, so `object-src` quietly relaxes from `'none'` to `'self'`,
while `upgrade-insecure-requests` has no fallback at all and is simply absent. Deliberate and
contained on that one lab target; the same omission on an ordinary page is an unnoticed regression.

So the site-wide rule is the canonical policy and every scoped rule is a **full copy of it with one
deliberate change**: `/labs/(.*)` widens `connect-src` to `https:` for the API tester,
`/(birthday|festival)` relaxes `frame-ancestors` to `'self'` so the wish generator can preview the
real card in an iframe. Add a directive to the global rule and propagate it — never bolt a partial
rule onto a path, because the thirteen directives you left out do not survive the override.

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
  pricing, counts ("50+ projects", "30 testimonials"), and registration numbers must match the
  pages they came from; when a page changes, re-check the corresponding claim here.
- **No HTML link is needed.** Like `robots.txt`, these are found by root-path convention, and both
  are listed in `sitemap.xml`. There is no registered `<link rel>` for llms.txt, so nothing in
  `partials/footer.html` or the page `<head>` needs to point at them.

