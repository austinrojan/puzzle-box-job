#!/usr/bin/env python3
"""Generate M06 warehouse battle map via FLUX.2 Pro single-image generation."""

import os
import fal_client
from PIL import Image
from io import BytesIO
import requests

OUTPUT = "campaigns/puzzle-box/assets/maps/m06-warehouse.png"
WIDTH = 2700
HEIGHT = 1800

PROMPT = """A dark stone warehouse interior seen from perfectly top-down bird's eye view, a fantasy tabletop RPG tactical battle map. The camera is directly overhead looking straight down at the floor.

Large five-pointed arcane star pattern inscribed into the stone floor in dark crimson ritual markings dominates the center of the warehouse. A binding circle surrounds the star on the floor. Faint glowing arcane energy traces parts of the star pattern. Dark crimson arcane residue spreads outward from the circle's center in thin tendrils across the grey-brown flagstones.

Thick dark stone perimeter walls form a wide rectangle around the entire warehouse, seen as thick dark bands from above. Wooden crates, barrels, and shipping boxes stacked one to two deep against all four walls. Large double wooden doors with iron bindings at the bottom center of the south wall, slightly ajar. A narrow side door gap in the right east wall. Wall-mounted iron sconces with warm amber torchlight along the perimeter walls, creating pools of orange warmth.

The center seventy percent of the warehouse floor is wide open worn grey-brown stone flagstones with thin dark mortar lines between them, clear combat space surrounding the arcane circle. Dark stains, scratches, and scuff marks on the ancient stone floor. Atmospheric shadows pool in the corners. The overall lighting is cinematic: warm amber from wall sconces along the edges, deep darkness in the far corners.

Dark fantasy painterly digital art, gothic atmosphere, rich saturated color palette of deep ambers, warm oranges, dark reds, and stone greys. Highly detailed textures on stone, wood, and metal. No braziers, no fire bowls, no standing objects on the open floor. No text, no labels, no grid lines, no borders, no characters or figures."""


def main():
    api_key = os.environ.get("FAL_KEY")
    if not api_key:
        raise RuntimeError("FAL_KEY not set — source ~/.zshrc first")

    print(f"Generating {WIDTH}x{HEIGHT} image via FLUX.2 Pro...")
    result = fal_client.subscribe(
        "fal-ai/flux-2-pro",
        arguments={
            "prompt": PROMPT,
            "image_size": {"width": WIDTH, "height": HEIGHT},
            "num_images": 1,
            "safety_tolerance": "5",
        },
    )

    image_url = result["images"][0]["url"]
    print(f"Image URL: {image_url}")

    response = requests.get(image_url)
    response.raise_for_status()
    img = Image.open(BytesIO(response.content))
    print(f"Raw dimensions: {img.size}")

    if img.size != (WIDTH, HEIGHT):
        print(f"Resizing from {img.size} to ({WIDTH}, {HEIGHT})...")
        img = img.resize((WIDTH, HEIGHT), Image.LANCZOS)

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    img.save(OUTPUT, "PNG", optimize=True)
    print(f"Saved to {OUTPUT} ({os.path.getsize(OUTPUT) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
