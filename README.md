# Krunalkumar Shah — Portfolio

Personal portfolio of **Krunalkumar Shah** — researcher, engineer, and cybersecurity-focused professional.

**Live site:** <https://krunalkumar.dpdns.org>

Built with plain HTML, CSS, and JavaScript. No frameworks, no build step, no dependencies — any static
web server can host it, and any computer with a browser can develop it.

---

## Pages

| Page                  | Purpose                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `index.html`          | Home — hero (with availability pill), expertise cards, selected work, certifications |
| `about.html`          | Profile — education (with ranks), career timeline, skills, community work, memberships |
| `services.html`       | Service lines — automation/AI, development, security, personal cyber help, coaching, research — with FAQ (FAQPage JSON-LD) |
| `projects.html`       | Case studies, featured spotlight + paginated gallery of 35+ repositories    |
| `research.html`       | Published paper on fork bomb defense, with summary cards and flowchart      |
| `client-reviews.html` | LinkedIn recommendations — featured quote + browsable carousel              |
| `internships.html`    | Two tracks — free selective internship + paid mentorship (₹4,999/mo, scholarships) — with application form and FAQ (FAQPage JSON-LD) |
| `contact.html`        | Direct contact links (email, WhatsApp, call booking) and a contact form     |
| `privacy.html`        | Privacy policy — data collected, analytics, third parties, DPDP Act 2023 rights |
| `terms.html`          | Terms of service — engagement ground rules, payments, IP, liability, governing law |
| `refund.html`         | Refund policy — formalizes the mentorship first-week guarantee and consulting refund terms |
| `404.html`            | Animated space scene, random headlines & rocket flight paths (noindex)      |
| `terminal.html`       | 🥚 Hidden easter egg — fake Linux terminal with a fork-bomb demo of the research paper. Not in the nav or sitemap, `noindex`; `/admin`, `/secret`, and `/hack` redirect here (see `vercel.json`), and the browser console on regular pages drops a hint |

## Project structure

```
├── index.html, about.html, ...   Pages (content only — header/footer are injected)
├── 404.html                      Custom not-found page (noindex)
├── partials/
│   ├── header.html               ★ Single source of truth for the navigation
│   └── footer.html               ★ Single source of truth for the footer
├── assets/
│   ├── css/main.css              All styles — organized into 13 numbered sections (see its table of contents)
│   ├── js/include-partials.js    Loads header/footer into every page at runtime
│   ├── js/particle-bg.js         Particle canvas, reveal animations, nav behavior, back-to-top, auto year
│   ├── images/                   Portrait, certification badges, favicon, research flowchart (SVG)
│   └── pdf/                      Resume
├── .well-known/security.txt      RFC 9116 security contact file
├── sitemap.xml                   Search-engine sitemap — update when adding pages
├── robots.txt                    Crawl rules + sitemap pointer
├── vercel.json                   Clean URLs + security headers (CSP, X-Frame-Options, nosniff, etc.) + noindex on the resume PDF
└── .claude/
    ├── launch.json               Local preview server config (Claude Code)
    └── dev-server.py             Zero-dependency local server that mimics Vercel's clean URLs
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
in this repo). Every absolute URL in the codebase — canonicals, `og:url`, JSON-LD, `sitemap.xml`,
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
keeps their details for a retry. A floating WhatsApp chat bubble (injected by `particle-bg.js`,
stacked under the back-to-top button) offers the same direct line from every page; its × hides it
for the rest of the visit (sessionStorage) and back-to-top drops into its corner. The number
appears in `contact.html`, `internships.html`, `partials/footer.html`, and
`assets/js/particle-bg.js` — search-and-replace all four to change it.

### Analytics events

Beyond page views, Google Analytics receives conversion events: `book_call_click`, `email_click`,
`whatsapp_link_click`, `resume_download` (global click listener in `particle-bg.js`), plus
`*_form_submit` / `*_form_confirmed` from the two forms.

### Visual layer

`particle-bg.js` renders the interactive particle canvas (respects `prefers-reduced-motion`),
scroll-reveal animations via IntersectionObserver, and the floating back-to-top button.
`main.css` is a single file organized into 13 numbered sections with a table of contents at the top.

---

## Local development

Pages must be served over HTTP — the partials are fetched at runtime, and browsers block `fetch()`
on `file://` URLs — and the server must resolve clean URLs (`/about` → `about.html`). The repo
ships a zero-dependency server for exactly that (Python standard library only — no Node, no
packages):

```bash
python .claude/dev-server.py 8123
```

Then open <http://localhost:8123>. A plain `python -m http.server` will serve the pages only at
their `.html` paths, so every internal link would 404 on it — use the dev server instead.

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

**Add a project** — copy an existing `<a class="project-item">` card inside `#project-list` in
`projects.html` and edit its category, title, description, and href. The gallery is static HTML
(crawler-visible); the inline script only paginates it. Add the `data-spotlight` attribute to make
the project eligible for the Featured spotlight rotation.

**Add a recommendation** — copy an existing `.recommendation-card` block inside
`.recommendation-carousel` in `client-reviews.html` and edit the quote, author, role, and date.
All cards are static HTML; the inline script only shows one at a time. The featured recommendation
is a separate static block (`#featured-recommendation-shell`) — update it deliberately.

**Change internship tracks** — edit the tag list and the `<select>` options in `internships.html`.

**Change mentorship pricing** — the ₹ figure lives in `internships.html` in three places (track
card, the form's track `<select>` option, meta/OG descriptions); update all together. The refund
and scholarship terms in the "Straight answers" section are public commitments — keep the page in
sync with what is actually honored.

**Update the resume** — replace `assets/pdf/Krunalkumar-Shah-Resume.pdf` (keep the filename, or update
the link on `index.html`). The PDF path is served with `X-Robots-Tag: noindex` (see `vercel.json`) so
the file never outranks the homepage in search.

## Conventions

- Every image needs `alt`, `width`/`height`, and (below the fold) `loading="lazy" decoding="async"`.
- Every indexed page needs a unique `<title>`, meta description, canonical, and OG tags; keep
  `sitemap.xml` lastmod fresh when content changes meaningfully.
- One `<h1>` per page; sections use `<h2>`/`<h3>`.
- The site is dark-theme only by design (`color-scheme: dark`).

## SEO

Per-page meta descriptions, canonicals, Open Graph/Twitter cards pointing to a dedicated 1200×630
share image (`assets/images/og-image.jpg`), and JSON-LD structured data (Person, WebSite,
BreadcrumbList, ScholarlyArticle on the research page); `sitemap.xml` + `robots.txt`; custom 404
with `noindex`; security headers via `vercel.json`. Since the static-header change, nav and footer
links are present in the raw HTML — crawlers discover pages without JavaScript — but keep
`sitemap.xml` accurate anyway; it remains the authoritative index request.
