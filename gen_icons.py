"""アイコン生成用の使い捨てスクリプト（アイコン生成後は削除して構わない）。"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

HERE = Path(__file__).parent
ICONS_DIR = HERE / "icons"
ICONS_DIR.mkdir(exist_ok=True)

BG = (21, 26, 35, 255)
ACCENT = (91, 140, 255, 255)
WHITE = (232, 236, 244, 255)


def draw_icon(size, padding_ratio=0.0):
    img = Image.new("RGBA", (size, size), BG)
    draw = ImageDraw.Draw(img)
    pad = int(size * padding_ratio)
    inner = size - pad * 2

    # 円形フレーム（写真/再生アイコン風）
    margin = int(inner * 0.12) + pad
    draw.ellipse([margin, margin, size - margin, size - margin], outline=ACCENT, width=max(2, size // 32))

    # 中央に再生三角(動画)+ 下に波形(音/画質) を簡易表現
    cx, cy = size / 2, size / 2
    tri_r = inner * 0.22
    p1 = (cx - tri_r * 0.6 + pad * 0, cy - tri_r)
    p2 = (cx - tri_r * 0.6, cy + tri_r)
    p3 = (cx + tri_r * 0.9, cy)
    draw.polygon([p1, p2, p3], fill=WHITE)

    # 品質低下を示す階段状バー
    bar_w = inner * 0.08
    base_y = size - margin - inner * 0.06
    heights = [0.18, 0.3, 0.45, 0.62]
    start_x = margin + inner * 0.08
    for i, h in enumerate(heights):
        x0 = start_x + i * (bar_w * 1.6)
        y0 = base_y - inner * h
        x1 = x0 + bar_w
        y1 = base_y
        draw.rectangle([x0, y0, x1, y1], fill=ACCENT)

    return img


def save_svg():
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="rgb{BG[:3]}"/>
  <circle cx="256" cy="256" r="180" fill="none" stroke="rgb{ACCENT[:3]}" stroke-width="16"/>
  <polygon points="216,176 216,336 336,256" fill="rgb{WHITE[:3]}"/>
  <rect x="120" y="380" width="28" height="40" fill="rgb{ACCENT[:3]}"/>
  <rect x="160" y="360" width="28" height="60" fill="rgb{ACCENT[:3]}"/>
  <rect x="200" y="330" width="28" height="90" fill="rgb{ACCENT[:3]}"/>
  <rect x="240" y="300" width="28" height="120" fill="rgb{ACCENT[:3]}"/>
</svg>"""
    (ICONS_DIR / "icon.svg").write_text(svg, encoding="utf-8")


save_svg()
draw_icon(192).save(ICONS_DIR / "icon-192.png")
draw_icon(512).save(ICONS_DIR / "icon-512.png")
draw_icon(512, padding_ratio=0.1).save(ICONS_DIR / "icon-maskable-512.png")
print("icons generated")
