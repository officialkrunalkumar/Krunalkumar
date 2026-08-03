# Krunalkumar Shah — Portfolio

Personal portfolio of **Krunalkumar Shah** — researcher, engineer, and cybersecurity-focused professional.

**Live site:** <https://krunalkumar.vercel.app>

Built with plain HTML, CSS, and JavaScript. No frameworks, no build step, no dependencies — any static
web server can host it, and any computer with a browser can develop it.

---

## Pages

| Page                  | Purpose                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `index.html`          | Home — hero, expertise cards, certifications, online presence               |
| `about.html`          | Profile — education (with ranks), skills, community work, memberships       |
| `projects.html`       | Featured project spotlight + paginated gallery of 35+ GitHub repositories   |
| `research.html`       | Published paper on fork bomb defense, with summary cards and flowchart      |
| `client-reviews.html` | LinkedIn recommendations — featured quote + browsable carousel              |
| `internships.html`    | Internship tracks and an application form that submits via WhatsApp         |
| `contact.html`        | Direct contact links and a WhatsApp-backed contact form                     |
| `404.html`            | Custom "page not found" (served automatically by Vercel / GitHub Pages)     |

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
├── sitemap.xml                   Search-engine sitemap — update when adding pages
├── robots.txt                    Crawl rules + sitemap pointer
└── .claude/launch.json           Local preview server config (Claude Code)
```

---

## Architecture

### Shared header & footer (runtime partials)

Every page contains two placeholders instead of a copied header/footer:

```html
<div id="header-placeholder"></div>
...
<div id="footer-placeholder"></div>
```

On load, `assets/js/include-partials.js` fetches `partials/header.html` and `partials/footer.html`,
swaps them in, and marks the current page's nav link with `class="active"` and `aria-current="page"`
based on the URL. When both partials are in place it fires a `partials:loaded` event, which
`particle-bg.js` waits for before wiring up nav behavior.

**To change the nav or footer: edit the file in `partials/` and refresh. Never edit the header/footer
markup inside individual pages — there is none.**

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
`wa.me/<number>` message from the fields and opens WhatsApp. The number appears in
`contact.html`, `internships.html`, and `partials/footer.html` — search-and-replace all three to
change it.

### Visual layer

`particle-bg.js` renders the interactive particle canvas (respects `prefers-reduced-motion`),
scroll-reveal animations via IntersectionObserver, and the floating back-to-top button.
`main.css` is a single file organized into 13 numbered sections with a table of contents at the top.

---

## Local development

Pages must be served over HTTP — the partials are fetched at runtime, and browsers block `fetch()`
on `file://` URLs. Any static server works:

```bash
python -m http.server 8137
```

Then open <http://localhost:8137>. (VS Code's Live Server extension works too.)

## Deployment

Hosted on **Vercel**, deployed automatically on push to `main`. Everything in the repository is
served as-is — there is no build step. `404.html` at the root is picked up automatically for
unmatched URLs.

---

## Common tasks

**Add a page**
1. Copy an existing page and replace `<main>` content, `<title>`, meta description, canonical URL, and Open Graph tags.
2. Add its link to `partials/header.html` (nav) and `partials/footer.html` (Explore column).
3. Add a `<url>` entry to `sitemap.xml`.

**Add a project** — append an object (`title`, `description`, `link`, `category`) to the `projects`
array in `projects.html`. To make it eligible for the Featured spotlight, also add its title to the
`spotlightTitles` set.

**Add a recommendation** — append to the `recommendations` array in `client-reviews.html`.

**Change internship tracks** — edit the tag list and the `<select>` options in `internships.html`.

**Update the resume** — replace the PDF in `assets/pdf/` (keep the filename, or update the links on
`index.html`).

## Conventions

- Every image needs `alt`, `width`/`height`, and (below the fold) `loading="lazy" decoding="async"`.
- Every indexed page needs a unique `<title>`, meta description, canonical, and OG tags; keep
  `sitemap.xml` lastmod fresh when content changes meaningfully.
- One `<h1>` per page; sections use `<h2>`/`<h3>`.
- The site is dark-theme only by design (`color-scheme: dark`).
- `.claude/` is git-ignored — never commit or deploy it.

## SEO

Per-page meta descriptions, canonicals, Open Graph/Twitter cards, and JSON-LD structured data
(Person, WebSite, BreadcrumbList, ScholarlyArticle on the research page); `sitemap.xml` +
`robots.txt`; custom 404 with `noindex`. Note: nav/footer links are JavaScript-injected, so the
sitemap carries crawl discovery — keep it accurate.
