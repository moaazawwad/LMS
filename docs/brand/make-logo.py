"""Brightverse Academy logo files: mark, horizontal and stacked lockups, light and dark.

Writes the SVGs next to this file. The name is drawn as outlines from Plus
Jakarta Sans, so the files look the same everywhere without the font:
    npm i @fontsource/plus-jakarta-sans@5   (in any folder)
    JAKARTA_FONTS=<that folder>/node_modules/@fontsource/plus-jakarta-sans/files python3 make-logo.py
Needs fonttools (pip install fonttools).
"""
import math, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

HERE = os.path.dirname(__file__)
OUT = HERE
FONTS = os.environ.get('JAKARTA_FONTS', os.path.join(HERE, 'node_modules/@fontsource/plus-jakarta-sans/files'))

GREEN = '#1d6a50'
GREEN_DARK = '#123f30'
GOLD = '#f2b53a'
GOLD_DEEP = '#d99a1e'
INK = '#17211d'
WHITE = '#ffffff'

def star(cx, cy, R):
    r = R * math.cos(math.pi / 4) / math.cos(math.pi / 8)
    pts = []
    for i in range(16):
        a = -math.pi / 2 + i * math.pi / 8
        rad = R if i % 2 == 0 else r
        pts.append(f'{cx + rad * math.cos(a):.2f},{cy + rad * math.sin(a):.2f}')
    return 'M' + ' L'.join(pts) + ' Z'

def book():
    # Open book seen a little from above; the star rises out of its fold.
    left = 'M30.7 38.4 C25.2 34.6 17.6 33.4 9.5 34.9 L9.5 50.6 C17.6 49.1 25.2 50.2 30.7 54 Z'
    right = 'M33.3 38.4 C38.8 34.6 46.4 33.4 54.5 34.9 L54.5 50.6 C46.4 49.1 38.8 50.2 33.3 54 Z'
    return left, right

def mark_paths(page, star_fill):
    l, r = book()
    return (f'<path d="{l}" fill="{page}"/><path d="{r}" fill="{page}"/>'
            f'<path d="{star(32, 20.5, 11)}" fill="{star_fill}"/>')

def mark_svg(bg=GREEN, page=WHITE, star_fill=GOLD, size=64, rounded=True):
    rx = 15 if rounded else 0
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="{size}" height="{size}">'
            f'<rect width="64" height="64" rx="{rx}" fill="{bg}"/>{mark_paths(page, star_fill)}</svg>')

def text_path(text, weight, size, x, y, tracking=0.0):
    font = TTFont(os.path.join(FONTS, f'plus-jakarta-sans-latin-{weight}-normal.woff'))
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font['head'].unitsPerEm
    scale = size / upm
    pen = SVGPathPen(gs)
    cursor = 0.0
    for ch in text:
        name = cmap[ord(ch)]
        tp = TransformPen(pen, (scale, 0, 0, -scale, x + cursor, y))
        gs[name].draw(tp)
        cursor += gs[name].width * scale + tracking
    return pen.getCommands(), cursor - tracking

def lockup(theme='light'):
    """Mark on the left, name on the right."""
    word_fill = INK if theme == 'light' else WHITE
    sub_fill = GREEN if theme == 'light' else GOLD
    bg = GREEN if theme == 'light' else GREEN
    name, name_w = text_path('Brightverse', 800, 30, 78, 33)
    sub, sub_w = text_path('ACADEMY', 700, 11.5, 79, 52, tracking=3.6)
    w = 78 + max(name_w, sub_w) + 4
    panel = '' if theme == 'light' else f'<rect x="-16" y="-16" width="{w + 32:.0f}" height="96" rx="18" fill="{GREEN_DARK}"/>'
    vb = f'0 0 {w:.0f} 64' if theme == 'light' else f'-16 -16 {w + 32:.0f} 96'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">'
            f'{panel}<rect width="64" height="64" rx="15" fill="{bg}"/>{mark_paths(WHITE, GOLD)}'
            f'<path d="{name}" fill="{word_fill}"/><path d="{sub}" fill="{sub_fill}"/></svg>')

def stacked():
    name, name_w = text_path('Brightverse', 800, 30, 0, 0)
    sub, sub_w = text_path('ACADEMY', 700, 11.5, 0, 0, tracking=3.6)
    w = max(name_w, sub_w, 88)
    cx = w / 2
    name, _ = text_path('Brightverse', 800, 30, cx - name_w / 2, 120)
    sub, _ = text_path('ACADEMY', 700, 11.5, cx - sub_w / 2, 140, tracking=3.6)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} 146">'
            f'<g transform="translate({cx - 44:.2f} 0) scale(1.375)"><rect width="64" height="64" rx="15" fill="{GREEN}"/>{mark_paths(WHITE, GOLD)}</g>'
            f'<path d="{name}" fill="{INK}"/><path d="{sub}" fill="{GREEN}"/></svg>')

def mark_only_on_light():
    """No tile: green book, gold star, for places that already have a white ground."""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="6 8 52 48">{mark_paths(GREEN, GOLD_DEEP)}</svg>')

files = {
    'brightverse-mark.svg': mark_svg(),
    'brightverse-mark-plain.svg': mark_only_on_light(),
    'brightverse-logo.svg': lockup('light'),
    'brightverse-logo-dark.svg': lockup('dark'),
    'brightverse-logo-stacked.svg': stacked(),
    'favicon.svg': mark_svg(size=32),
}
for name, svg in files.items():
    with open(os.path.join(OUT, name), 'w') as f:
        f.write(svg + '\n')
print('\n'.join(f'{n} {len(s)}' for n, s in files.items()))
