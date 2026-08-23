# -*- coding: utf-8 -*-
"""Generates one og:image per lab, in the house style.

Every lab currently shares one of four category images, so 22 security tools
post the identical preview card. A shared link therefore says "Labs" instead of
saying which tool it is, which is a real click-through loss on the pages most
likely to be shared.

Hand-designing 62 cards is not realistic; generating them is. The layout below
follows og-resume-maker.jpg — dark navy ground with a faint grid, the domain in
mono, a letterspaced eyebrow, a large white headline, a muted subline — with a
category-tinted monogram panel on the right in place of the hand-made product
mockup.

The two hand-made maker cards and the wish generator's are left alone: they are
better than anything this can produce, because they show the actual product.

NOT PART OF THE BUILD. Vercel runs `node scripts/build.js` and never touches
this file; a .py sitting in scripts/ is inert there, and served as a static
text file exactly like build.js already is (noindex via vercel.json).

It is the one thing in this repository that needs something outside Node:

    pip install Pillow

That is a deliberate exception, and the alternative was worse. The site itself
still has zero runtime dependencies — this is a dev-time image generator that
runs by hand, perhaps twice a year, when a lab is added. Writing a PNG encoder
by hand to preserve a "Node only" rule would have been a far worse trade than
one pip install. It also reads Segoe UI and Consolas from C:/Windows/Fonts,
so it is Windows-specific as written; point F at another font directory to run
it elsewhere.

Run:
    python scripts/make-lab-og.py             # write images, leave HTML alone
    python scripts/make-lab-og.py --apply     # write images AND update og:image
    python scripts/make-lab-og.py timestamp   # just one lab, by slug
"""
import io
import os
import re
import sys
import html as htmlmod
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = 'C:/Users/Krunalkumar Shah/Downloads/Krunalkumar'
OUT = ROOT + '/assets/images'
F = 'C:/Windows/Fonts/'
W, H = 1200, 630

# Pages that keep what they have.
SKIP = {
    'resume-maker.html',      # hand-made, shows the real product
    'biodata-maker.html',     # hand-made
    'wish-generator.html',    # purpose-built earlier in this change
    'hacklab-guestbook.html', # sandboxed document inside an iframe, never shared
    'index.html',             # the hub itself; og-labs.jpg is correct for it
}

BG = (18, 27, 44)
GRID = (26, 37, 58)
INK = (244, 247, 254)
MUTED = (150, 166, 190)
DIM = (120, 137, 163)
MONO_INK = (176, 196, 224)

# The eyebrow label and accent colour per category.
CATEGORY = {
    'security': ('SECURITY TOOL', (56, 189, 248), (10, 58, 92)),
    'viz':      ('VISUALISER',    (167, 139, 250), (52, 32, 96)),
    'network':  ('NETWORK TOOL',  (45, 212, 191), (10, 66, 62)),
    'hacklab':  ('HACKLAB',       (248, 113, 113), (86, 22, 30)),
    'tool':     ('FREE TOOL',     (93, 140, 214), (24, 44, 84)),
}

# WHICH LAB IS WHICH, FROZEN.
#
# This was originally inferred from the og:image each page already pointed at,
# which was elegant and wrong: this script OVERWRITES og:image, so the second
# run had nothing left to read and relabelled all 59 cards as the generic blue
# "FREE TOOL". A generator whose output destroys its own input is a trap, and
# it was caught only by running it twice.
#
# So the mapping is written down instead. It is not derivable from anything
# else — the JSON-LD applicationCategory is close but not one-to-one (it splits
# security into three sub-categories and puts the visualisers under
# EducationalApplication) — and it is a judgement about presentation rather
# than a fact about the page.
#
# A lab that is not listed here gets 'tool', which is the right default and the
# reason adding a lab does not require touching this table unless you want a
# different accent.
LAB_CATEGORY = {
    'algorithm-visualizer': 'viz',
    'api': 'tool',
    'archive-inspector': 'security',
    'breach-check': 'network',
    'bsd': 'tool',
    'buffer-overflow': 'viz',
    'c': 'tool',
    'cert-decoder': 'security',
    'certificate-forge': 'viz',
    'chat': 'network',
    'cipher': 'security',
    'cpp': 'tool',
    'cpu-simulator': 'viz',
    'cryptography': 'viz',
    'ct-log': 'network',
    'cvss': 'security',
    'dns': 'network',
    'dos': 'tool',
    'email-headers': 'security',
    'email-security': 'network',
    'encoding': 'security',
    'exif': 'security',
    'file-inspector': 'security',
    'fractal-explorer': 'viz',
    'hacklab': 'hacklab',
    'har-analyzer': 'security',
    'hash': 'security',
    'hash-cracker': 'viz',
    'index': 'tool',
    'javascript': 'tool',
    'jwt': 'security',
    'leak': 'security',
    'linux': 'tool',
    'lua': 'tool',
    'memory-strings': 'security',
    'os-algorithms': 'viz',
    'password': 'security',
    'pcap-analyzer': 'security',
    'perl': 'tool',
    'php': 'tool',
    'postgres': 'tool',
    'processor-explorer': 'viz',
    'python': 'tool',
    'rdap': 'network',
    'regex': 'security',
    'regex-engine': 'viz',
    'registry-viewer': 'security',
    'ruby': 'tool',
    'shader-playground': 'viz',
    'sql': 'tool',
    'sqlite-browser': 'security',
    'steganography': 'security',
    'subnet': 'security',
    'synth': 'tool',
    'tcp-congestion': 'viz',
    'timestamp': 'security',
    'typescript': 'tool',
    'typing': 'tool',
    'url-inspector': 'security',
    'word-cloud': 'viz',
}

seg = lambda s: ImageFont.truetype(F + 'segoeui.ttf', s)
segb = lambda s: ImageFont.truetype(F + 'segoeuib.ttf', s)
mono = lambda s: ImageFont.truetype(F + 'consola.ttf', s)
monob = lambda s: ImageFont.truetype(F + 'consolab.ttf', s)


def tracked(d, xy, text, font, fill, track=0):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill)
        x += d.textlength(ch, font=font) + track
    return x


def wrap(d, text, font, maxw):
    words, lines, line = text.split(), [], ''
    for w in words:
        t = (line + ' ' + w).strip()
        if d.textlength(t, font=font) > maxw and line:
            lines.append(line)
            line = w
        else:
            line = t
    if line:
        lines.append(line)
    return lines


def meta(src, prop):
    m = re.search(r'<meta\s+(?:property|name)="%s"\s+content="([^"]*)"' % re.escape(prop), src)
    return htmlmod.unescape(m.group(1)) if m else ''


def tool_name(src):
    """The tool's NAME, not its SEO headline.

    <title> is "Timestamp Converter — Unix & FILETIME | Krunalkumar Shah", so
    everything from the first separator onward is stripped. og:title is a
    marketing sentence ("One number, every epoch…") and is deliberately not
    used here — a preview card wants the noun, and the sentence goes in the
    subline where there is room for it.
    """
    m = re.search(r'<title>(.*?)</title>', src, re.S)
    t = htmlmod.unescape(m.group(1)).strip() if m else ''
    t = t.split('|')[0]
    for sep in ('\u2014', ' - ', '\u2013', ':'):
        t = t.split(sep)[0]
    return ' '.join(t.split())


# Words that carry no identity — a monogram built from them says nothing.
FILLER = {'online', 'free', 'the', 'a', 'an', 'and', 'of', 'for', 'in', 'your', 'my'}

# Words that name a KIND of tool rather than the tool. When one of these ends
# the name, the distinguishing word is the first one.
GENERIC = {
    'compiler', 'editor', 'terminal', 'prompt', 'shell', 'viewer', 'checker',
    'tester', 'analyzer', 'analyser', 'generator', 'calculator', 'visualiser',
    'visualizer', 'inspector', 'browser', 'playground', 'decoder', 'encoder',
    'converter', 'lookup', 'cracker', 'parser', 'simulator', 'explorer',
    'verifier', 'remover', 'extractor', 'builder', 'search', 'desk', 'test',
}


def slug_of(filename):
    return filename[:-5]


def monogram(name):
    """Two letters that actually identify the tool.

    Filler is dropped first, so "Online Python Compiler" gives PC rather than
    OP. A single CamelCase word is split on the case change — HackLab is HL,
    not HA. Everything else falls back to the first two characters.
    """
    words = [w for w in re.split(r'[\s/&\-—]+', name) if w]
    words = [w for w in words if w.lower() not in FILLER] or words

    # "Online Python Compiler", "Online Perl Compiler" and "Online PHP
    # Compiler" all reduce to PC on initials, which tells a reader nothing on
    # three different cards. When the trailing word is a generic type noun the
    # identity is in the FIRST word, so take two letters from that instead:
    # PY, PE, PH. Only when the first word is long enough to give two.
    if len(words) >= 2 and words[-1].lower().rstrip('s') in GENERIC:
        head = re.sub(r'[^A-Za-z0-9]', '', words[0])
        if len(head) >= 2:
            return head[:2].upper()

    if len(words) >= 2:
        return (words[0][0] + words[1][0]).upper()

    if words:
        parts = re.findall(r'[A-Z][a-z]*|[a-z]+', words[0])
        if len(parts) >= 2:
            return (parts[0][0] + parts[1][0]).upper()
        return words[0][:2].upper()

    return name[:2].upper()


def build(name, subtitle, label, accent, glowcol, path):
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    for x in range(0, W, 40):
        d.line([(x, 0), (x, H)], fill=GRID)
    for y in range(0, H, 40):
        d.line([(0, y), (W, y)], fill=GRID)

    glow = Image.new('RGB', (W, H), BG)
    ImageDraw.Draw(glow).ellipse([800, 90, 1280, 570], fill=glowcol)
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(120)), 0.6)
    d = ImageDraw.Draw(img)

    d.text((75, 92), 'krunalkumar.dpdns.org', font=mono(23), fill=MONO_INK)
    tracked(d, (75, 132), 'LABS \u00b7 ' + label, monob(19), accent, track=2.6)

    # Headline size steps down as the name gets longer, so a three-word tool
    # name never wraps to three lines where two would do.
    size = 76 if len(name) <= 18 else 64 if len(name) <= 28 else 54
    lines = wrap(d, name, segb(size), 660)[:3]
    y = 210 if len(lines) > 1 else 236
    for ln in lines:
        d.text((72, y), ln, font=segb(size), fill=INK)
        y += size + 12

    y = max(y + 14, 396)
    # Two lines maximum. If the description did not fit, the cut has to be
    # visible — "…HFS+ and" reads as a bug, "…HFS+ and…" reads as a summary.
    sublines = wrap(d, subtitle, seg(27), 640)
    clipped = len(sublines) > 2
    sublines = sublines[:2]
    if clipped and sublines:
        last = sublines[-1].rstrip(' ,;:')
        while last and d.textlength(last + '…', font=seg(27)) > 640:
            last = last.rsplit(' ', 1)[0].rstrip(' ,;:')
        sublines[-1] = last + '…'
    for ln in sublines:
        d.text((75, y), ln, font=seg(27), fill=MUTED)
        y += 38

    d.text((75, 540), 'Runs in your browser \u00b7 nothing uploaded', font=seg(23), fill=DIM)

    # Monogram panel, in place of the hand-made mockup the maker cards carry.
    px, py, ps = 838, 175, 280
    panel = Image.new('RGBA', (ps, ps), (0, 0, 0, 0))
    pd = ImageDraw.Draw(panel)
    pd.rounded_rectangle([0, 0, ps - 1, ps - 1], 52, fill=(255, 255, 255, 16),
                         outline=accent + (150,), width=3)
    img.paste(Image.alpha_composite(
        img.crop((px, py, px + ps, py + ps)).convert('RGBA'), panel).convert('RGB'), (px, py))

    d = ImageDraw.Draw(img)
    mg = monogram(name)
    f = monob(118)
    tw = d.textlength(mg, font=f)
    d.text((px + (ps - tw) / 2, py + 66), mg, font=f, fill=accent)
    # The prompt caret ties the card to the KS_ wordmark.
    d.text((px + ps / 2 - 26, py + 196), '_', font=monob(52), fill=accent)

    img.save(path, 'JPEG', quality=86, optimize=True, progressive=True)


def main():
    apply_html = '--apply' in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith('--')]
    made = []

    for fn in sorted(os.listdir(ROOT + '/labs')):
        if not fn.endswith('.html') or fn in SKIP:
            continue
        if only and fn.replace('.html', '') not in only:
            continue

        path = ROOT + '/labs/' + fn
        src = io.open(path, encoding='utf-8').read()

        label, accent, glowcol = CATEGORY[LAB_CATEGORY.get(slug_of(fn), 'tool')]

        name = tool_name(src)
        desc = meta(src, 'og:description') or meta(src, 'description')
        # First sentence only, and short enough to sit on two lines.
        sub = re.split(r'(?<=[.!?])\s', desc)[0] if desc else ''
        if len(sub) > 118:
            sub = sub[:115].rsplit(' ', 1)[0] + '\u2026'

        slug = fn[:-5]
        out = OUT + '/og-lab-' + slug + '.jpg'
        build(name, sub, label, accent, glowcol, out)
        made.append((slug, name, label, os.path.getsize(out)))

        if apply_html:
            newurl = 'https://krunalkumar.dpdns.org/assets/images/og-lab-' + slug + '.jpg'
            src2 = re.sub(r'(<meta property="og:image" content=")[^"]*(")', r'\1' + newurl + r'\2', src, count=1)
            src2 = re.sub(r'(<meta name="twitter:image" content=")[^"]*(")', r'\1' + newurl + r'\2', src2, count=1)
            src2 = re.sub(r'(<meta property="og:image:alt" content=")[^"]*(")',
                          r'\1' + htmlmod.escape(name) + r'\2', src2, count=1)
            if src2 != src:
                io.open(path, 'w', encoding='utf-8', newline='').write(src2)

    total = sum(m[3] for m in made)
    for slug, name, label, size in made[:8]:
        print('  %-26s %-30s %-14s %5.1f KB' % (slug, name[:30], label, size / 1024.0))
    print('\n%d cards, %.1f MB total%s' % (len(made), total / 1048576.0,
                                           ', HTML updated' if apply_html else ', HTML NOT touched'))


main()
