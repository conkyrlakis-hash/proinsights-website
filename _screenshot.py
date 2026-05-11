"""One-shot script: render the anonymized hero sample to a PNG screenshot.

Outputs:  hero-screenshot.png  (~1100px wide, ~860px tall, retina-quality)

Run from within proinsights-website/ directory:
    python _screenshot.py
"""
import sys
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Install playwright first:  pip install playwright && playwright install chromium")
    sys.exit(1)

HERE = Path(__file__).resolve().parent
INPUT = HERE / "sample-anonymous-hero.html"
OUTPUT = HERE / "hero-screenshot.png"

if not INPUT.exists():
    print(f"Missing input: {INPUT}")
    sys.exit(1)

# Render at 2x for retina, the hero card is ~650px wide in the template.
# Capture the top portion (header + AI brief + executive summary + a few rows).
VIEWPORT = {"width": 720, "height": 1400}
DEVICE_SCALE = 2

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(
        viewport=VIEWPORT,
        device_scale_factor=DEVICE_SCALE,
    )
    page = ctx.new_page()
    page.goto(INPUT.as_uri())
    page.wait_for_load_state("networkidle")
    # Take a screenshot of just the top 880px of the body content.
    # The email is 650px wide centred inside a 720px viewport, so trim
    # the white margins by using a clip rect.
    page.screenshot(
        path=str(OUTPUT),
        clip={"x": 35, "y": 20, "width": 650, "height": 860},
    )
    browser.close()

size_kb = OUTPUT.stat().st_size / 1024
print(f"Wrote {OUTPUT.name} ({size_kb:.1f} KB) at {VIEWPORT['width']}x880 @ {DEVICE_SCALE}x")
