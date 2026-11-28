#!/usr/bin/env python3
"""Seeded camera composites of the cached official scans.

Each condition is deterministic for (seed, card id, condition).
Ground truth is the card quad in the output frame, plus card id, game, and size class.
Output stays in the gitignored cache. Nothing here turns a feature flag on.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import struct
import sys
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / 'manifest.json'
CACHE = HERE / 'cache'
FRAMES = CACHE / 'synth'
SEED = 856
CANVAS = (320, 426)
CARD_H = 250
CONDITIONS = ('clean', 'perspective', 'blur', 'light', 'cover')
SIZE_MM = {
    'yugioh': (59.0, 86.0),
    'standard-tcg': (63.0, 88.0),
}

BACKGROUNDS = {
    'clean': (176, 176, 176),
    'perspective': (46, 110, 72),
    'blur': (128, 86, 54),
    'light': (6, 8, 15),
    'cover': (214, 214, 216),
}


def rng_for(card_id, condition):
    return random.Random(f'{SEED}:{card_id}:{condition}')


def solve8(matrix, target):
    rows = [list(row) + [target[i]] for i, row in enumerate(matrix)]
    n = 8
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(rows[r][col]))
        if abs(rows[pivot][col]) < 1e-10:
            raise RuntimeError('perspective matrix is singular')
        rows[col], rows[pivot] = rows[pivot], rows[col]
        scale = rows[col][col]
        for j in range(col, n + 1):
            rows[col][j] /= scale
        for r in range(n):
            if r == col:
                continue
            factor = rows[r][col]
            for j in range(col, n + 1):
                rows[r][j] -= factor * rows[col][j]
    return [rows[i][n] for i in range(n)]


def perspective_coeffs(src, dst):
    """Map output pixels at dst back to src. dst and src are TL, TR, BR, BL."""
    matrix = []
    target = []
    for (x, y), (u, v) in zip(dst, src):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        target.extend([u, v])
    return solve8(matrix, target)


def fit_card(image, size_class):
    width_mm, height_mm = SIZE_MM[size_class]
    target_h = CARD_H
    target_w = max(1, round(target_h * width_mm / height_mm))
    image = image.convert('RGB')
    scale = min(target_w / image.width, target_h / image.height)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    edge = resized.getpixel((0, 0))
    canvas = Image.new('RGB', (target_w, target_h), edge)
    canvas.paste(resized, ((target_w - resized.width) // 2, (target_h - resized.height) // 2))
    return canvas


def shift(corners, dx, dy):
    return [(x + dx, y + dy) for x, y in corners]


def rotate(corners, degrees):
    cx = sum(p[0] for p in corners) / 4
    cy = sum(p[1] for p in corners) / 4
    angle = math.radians(degrees)
    ca, sa = math.cos(angle), math.sin(angle)
    out = []
    for x, y in corners:
        dx, dy = x - cx, y - cy
        out.append((cx + dx * ca - dy * sa, cy + dx * sa + dy * ca))
    return out


def project_corners(card_w, card_h, pitch, yaw, ox, oy):
    """Pinhole image of a rectangle. Both axes tilt so the aspect can be rectified."""
    focal = 780.0
    depth = focal
    tp = math.radians(pitch)
    ty = math.radians(yaw)
    cx = CANVAS[0] / 2 + ox
    cy = CANVAS[1] / 2 + oy
    points = []
    for X, Y in ((-card_w / 2, -card_h / 2), (card_w / 2, -card_h / 2), (card_w / 2, card_h / 2), (-card_w / 2, card_h / 2)):
        x1 = X * math.cos(ty)
        z1 = -X * math.sin(ty)
        y2 = Y * math.cos(tp) - z1 * math.sin(tp)
        z2 = Y * math.sin(tp) + z1 * math.cos(tp)
        distance = depth + z2
        points.append((cx + focal * x1 / distance, cy + focal * y2 / distance))
    return points


def taper(corners, amount):
    tl, tr, br, bl = corners
    return [
        (tl[0] + amount, tl[1] + amount * 0.25),
        (tr[0] - amount, tr[1] + amount * 0.25),
        br,
        bl,
    ]


def place_corners(card_w, card_h, condition, rng):
    ox = oy = 0.0
    angle = 0.0
    pinch = 0.0
    if condition == 'perspective':
        pitch = rng.uniform(12, 22)
        yaw = rng.uniform(8, 16) * rng.choice((-1, 1))
        ox = rng.uniform(-10, 10)
        oy = rng.uniform(-8, 8)
        return project_corners(card_w, card_h, pitch, yaw, ox, oy)
    if condition == 'blur':
        angle = rng.uniform(-3, 3)
    elif condition == 'light':
        ox = rng.uniform(-16, 16)
        oy = rng.uniform(-12, 12)
    elif condition == 'cover':
        ox = rng.choice((-48, 46))
        oy = rng.choice((-36, 32))
        angle = rng.uniform(-4, 4)
    x0 = (CANVAS[0] - card_w) / 2 + ox
    y0 = (CANVAS[1] - card_h) / 2 + oy
    corners = [(x0, y0), (x0 + card_w, y0), (x0 + card_w, y0 + card_h), (x0, y0 + card_h)]
    corners = rotate(corners, angle)
    if pinch:
        corners = taper(corners, pinch)
    return corners


def warp(card, corners):
    src = [(0, 0), (card.width - 1, 0), (card.width - 1, card.height - 1), (0, card.height - 1)]
    coeffs = perspective_coeffs(src, corners)
    rgba = card.convert('RGBA')
    return rgba.transform(CANVAS, Image.Transform.PERSPECTIVE, coeffs, Image.Resampling.BICUBIC, fillcolor=(0, 0, 0, 0))


def motion_blur(image, radius):
    base = image.convert('RGB')
    pixels = list(base.get_flattened_data() if hasattr(base, 'get_flattened_data') else base.getdata())
    width, height = base.size
    acc = [0] * (width * height * 3)
    count = radius * 2 + 1
    for dx in range(-radius, radius + 1):
        for i, (r, g, b) in enumerate(pixels):
            x = min(width - 1, max(0, (i % width) + dx))
            y = i // width
            sr, sg, sb = pixels[y * width + x]
            j = i * 3
            acc[j] += sr
            acc[j + 1] += sg
            acc[j + 2] += sb
    out = [(acc[i] // count, acc[i + 1] // count, acc[i + 2] // count) for i in range(0, len(acc), 3)]
    blurred = Image.new('RGB', base.size)
    blurred.putdata(out)
    return blurred


def add_noise(image, rng, sigma):
    pixels = image.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y][:3]
            pixels[x, y] = tuple(max(0, min(255, int(channel + rng.gauss(0, sigma)))) for channel in (r, g, b))


def draw_sleeve(base, corners, kind):
    overlay = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    xs = [p[0] for p in corners]
    ys = [p[1] for p in corners]
    pad = 10 if kind == 'sleeve' else 16
    box = [min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad]
    fill = (255, 255, 255, 48 if kind == 'sleeve' else 36)
    draw.rounded_rectangle(box, radius=8, fill=fill, outline=(255, 255, 255, 150), width=2)
    draw.line([(box[0] + 6, box[1] + 8), (box[2] - 8, box[3] - 12)], fill=(255, 255, 255, 110), width=3)
    return Image.alpha_composite(base, overlay)


def draw_occlusion(base, corners):
    overlay = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    bl = corners[3]
    br = corners[2]
    draw.polygon(
        [(bl[0] - 8, bl[1] + 6), (bl[0] + 36, bl[1] - 28), (br[0] * 0.45 + bl[0] * 0.55, bl[1] + 8), (bl[0] + 8, bl[1] + 18)],
        fill=(70, 48, 40, 230),
    )
    return Image.alpha_composite(base, overlay)


def draw_glare(base, corners):
    overlay = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    xs = [p[0] for p in corners]
    ys = [p[1] for p in corners]
    box = [min(xs) + 8, min(ys) + 6, (min(xs) + max(xs)) / 2, min(ys) + (max(ys) - min(ys)) * 0.42]
    draw.ellipse(box, fill=(255, 255, 255, 150))
    return Image.alpha_composite(base, overlay)


def composite(card, condition, rng):
    corners = place_corners(card.width, card.height, condition, rng)
    warped = warp(card, corners)
    base = Image.new('RGBA', CANVAS, BACKGROUNDS[condition] + (255,))
    base.alpha_composite(warped)
    kind = None
    if condition == 'cover':
        kind = 'toploader' if rng.random() < 0.5 else 'sleeve'
        base = draw_sleeve(base, corners, kind)
        if rng.random() < 0.65:
            base = draw_occlusion(base, corners)
    if condition == 'light':
        if rng.random() < 0.5:
            base = draw_glare(base, corners)
            light = 'glare'
        else:
            base = ImageEnhance.Brightness(base).enhance(0.38)
            add_noise(base, rng, 14)
            light = 'low-light'
    else:
        light = None
    rgb = base.convert('RGB')
    if condition == 'blur':
        if rng.random() < 0.5:
            rgb = motion_blur(rgb, 5)
            blur = 'motion'
        else:
            rgb = rgb.filter(ImageFilter.GaussianBlur(radius=1.6))
            blur = 'defocus'
    else:
        blur = None
    return rgb, corners, {'sleeve': kind, 'light': light, 'blur': blur}


def write_frame(path, image):
    raw = image.convert('RGBA').tobytes()
    payload = zlib.compress(raw, 6)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('wb') as handle:
        handle.write(b'CDFX')
        handle.write(struct.pack('<HHI', image.width, image.height, len(payload)))
        handle.write(payload)


def read_frame(path):
    blob = path.read_bytes()
    if blob[:4] != b'CDFX':
        raise RuntimeError(f'not a frame {path}')
    width, height, size = struct.unpack_from('<HHI', blob, 4)
    raw = zlib.decompress(blob[12:12 + size])
    return Image.frombytes('RGBA', (width, height), raw).convert('RGB')


def cache_file(card):
    folder = CACHE / 'official' / card['game']
    matches = list(folder.glob(safe_id(card['card_id']) + '.*'))
    return matches[0] if matches else None


def safe_id(card_id):
    return ''.join(ch if ch.isalnum() or ch in '-_' else '_' for ch in card_id)


def render_card(card, source):
    image = Image.open(source)
    fitted = fit_card(image, card['size_class'])
    labels = []
    for condition in CONDITIONS:
        rng = rng_for(card['card_id'], condition)
        frame, corners, extra = composite(fitted, condition, rng)
        case_id = f'{card["game"]}/{card["card_id"]}/{condition}'
        dest = FRAMES / card['game'] / safe_id(card['card_id']) / f'{condition}.bin'
        write_frame(dest, frame)
        labels.append({
            'case_id': case_id,
            'game': card['game'],
            'card_id': card['card_id'],
            'set': card.get('set') or '',
            'number': card.get('number') or '',
            'size_class': card['size_class'],
            'condition': condition,
            'width': CANVAS[0],
            'height': CANVAS[1],
            'corners': [{'x': round(x, 3), 'y': round(y, 3)} for x, y in corners],
            'extra': extra,
            'frame': str(dest.relative_to(HERE)),
            'synthetic': True,
        })
    return labels


def red_box_check():
    card = Image.new('RGB', (30, 40), (220, 20, 20))
    corners = [(40, 50), (100, 50), (100, 130), (40, 130)]
    warped = warp(card, corners)
    base = Image.new('RGBA', CANVAS, (20, 40, 200, 255))
    base.alpha_composite(warped)
    rgb = base.convert('RGB')
    pixels = rgb.load()
    xs, ys = [], []
    for y in range(CANVAS[1]):
        for x in range(CANVAS[0]):
            r, g, b = pixels[x, y]
            if r > 160 and g < 80 and b < 80:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise SystemExit('warp produced no red pixels')
    box = (min(xs), min(ys), max(xs), max(ys))
    if abs(box[0] - 40) > 2 or abs(box[1] - 50) > 2 or abs(box[2] - 100) > 2 or abs(box[3] - 130) > 2:
        raise SystemExit(f'warp box {box}')


def self_test():
    red_box_check()
    card = Image.new('RGB', (40, 56), (240, 240, 240))
    fake = {'card_id': 'self', 'size_class': 'standard-tcg'}
    fitted = fit_card(card, fake['size_class'])
    a, corners_a, _extra = composite(fitted, 'perspective', rng_for('self', 'perspective'))
    b, corners_b, _extra = composite(fitted, 'perspective', rng_for('self', 'perspective'))
    if list(a.getdata()) != list(b.getdata()) or corners_a != corners_b:
        raise SystemExit('synth is not deterministic')
    other, _corners, _extra = composite(fitted, 'perspective', rng_for('other', 'perspective'))
    if list(a.getdata()) == list(other.getdata()):
        raise SystemExit('different ids collided')
    path = CACHE / 'self-test.bin'
    write_frame(path, a)
    again = read_frame(path)
    digest = hashlib.sha256(a.tobytes()).hexdigest()
    if hashlib.sha256(again.tobytes()).hexdigest() != digest:
        raise SystemExit('frame roundtrip')
    path.unlink()
    print('synth self-test ok')


def main(argv):
    if '--self-test' in argv:
        self_test()
        return 0
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    labels = []
    missing = 0
    for index, card in enumerate(manifest['cards'], start=1):
        source = cache_file(card)
        if source is None:
            missing += 1
            continue
        labels.extend(render_card(card, source))
        if index % 25 == 0:
            print(f'rendered {index}', flush=True)
    FRAMES.mkdir(parents=True, exist_ok=True)
    (FRAMES / 'labels.jsonl').write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in labels), encoding='utf-8')
    print(f'frames {len(labels)} missing_sources {missing}')
    return 0 if missing == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
