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
| `services.html`       | Service lines — automation/AI, development, security, personal cyber help, coaching, research — with FAQ (FAQPage JSON-LD) |
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
├── robots.txt                    Crawl rules + sitemap pointer
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

**Add a blog post**
1. Copy an existing `blog/*.html` post and replace the article content and the whole `<head>`
   metadata set: `<title>`, meta description, canonical (`/blog/<slug>`, extensionless), OG/Twitter
   tags pointing at the post's own share image, ISO-dated `article:published_time` /
   `article:modified_time`, and the BlogPosting + BreadcrumbList JSON-LD (matching dates). Keep the
   `feed.xml` / `atom.xml` `<link rel="alternate">` tags. Write the static "In this article" TOC
   (`.post-toc`) to match the post's `h2` headings — `blog-toc.js` only builds one when the static
   TOC is missing.
2. Add the post's card — a `.post-card` inside `.blog-grid` — to `blog/index.html`, with a
   `data-category` attribute so the filter chips pick it up
   (`blog-index.js` shows the first six and hides the rest behind Show more, so newest goes first).
3. Update the "From the blog" column if the post should be one of the seven highlighted there — in
   `partials/footer.html` AND the static footer copies in every page.
4. Add an extensionless `<url>` entry to `sitemap.xml`.
5. Add an `<item>` to `feed.xml` and an `<entry>` to `atom.xml`.

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
2. The raised-surface fills — **22 `background` declarations in `main.css`** (grep the values —
   solids and gradient stops both) **and 3 in `blog.css`** (`.post-body pre`, `.post-toc`, and
   `.blog-filter`): `rgba(31, 44, 63, …)`, `rgba(46, 62, 80, …)`, `rgba(24, 36, 57, …)`, and the
   button hexes `#1f2c3f` / `#212d3c`. Only `background` declarations — never a `box-shadow` that
   happens to use the same numbers.
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

## SEO

Per-page meta descriptions, canonicals, Open Graph/Twitter cards pointing to a dedicated 1200×630
share image (`assets/images/og-image.jpg`; blog posts have their own under
`assets/images/blog/og/`), and JSON-LD structured data (Person, WebSite, BreadcrumbList,
ProfessionalService on the home page — the business entity, carrying the Udyam/MSME registration
number and linked to the Person node by `@id`; ScholarlyArticle on the research page, BlogPosting on
blog posts); `sitemap.xml` + `robots.txt` +
RSS/Atom feeds (`feed.xml` / `atom.xml`, advertised via `<link rel="alternate">` on blog pages);
custom 404 with `noindex`; security headers via `vercel.json`. Since the static-header change, nav and footer
links are present in the raw HTML — crawlers discover pages without JavaScript — but keep
`sitemap.xml` accurate anyway; it remains the authoritative index request.

