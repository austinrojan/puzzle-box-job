#!/usr/bin/env python3
"""Targeted inpainting for M02 estate grounds map using FLUX.1 Pro Fill.

Crops a region from the base image, creates a mask for that crop,
runs FLUX.1 Pro Fill on the cropped region, then pastes the result
back into the full image. This avoids FLUX downscaling the full 3600x2700.

Usage:
    python inpaint_m02.py <region_name> [--prompt "custom prompt"] [--apply]

Regions:
    hedge_maze     - Right side: add visible labyrinth pattern
    carriage_loop  - Center: reshape drive into oval loop
    servants_alley - Right edge: add narrow passage
"""

import os
import sys
import fal_client
from PIL import Image, ImageDraw, ImageFilter
from io import BytesIO
import requests
import tempfile

BASE_IMAGE = "campaigns/puzzle-box/assets/maps/m02-estate-grounds.png"
W, H = 3600, 2700

# Each region defines:
#   crop_box: (x1, y1, x2, y2) — area to extract from full image
#   mask_box: (x1, y1, x2, y2) — inpaint zone WITHIN the crop (relative coords)
#             If None, the entire crop is inpainted
#   prompt: text describing what to fill
#   padding: extra context pixels around mask_box (included in crop but not masked)
REGIONS = {
    "hedge_maze": {
        "crop_box": (2200, 1100, 3500, 2350),
        "mask_box": None,  # inpaint the entire crop
        "prompt": "Top-down flat overhead view of formal gardens at night: a small hedge maze with visible labyrinth pattern of tight angular green hedge walls, adjacent to a glass conservatory with thin iron framing glowing faintly green-white from phosphorescent plants inside. Angular topiary hedges in geometric patterns separated by pale gravel walking paths. A circular stone fountain with dark water. Dark fantasy painterly, night atmosphere, deep blue-black tones, muted greens, warm amber lantern spots. No text, no labels, no grid, no characters.",
    },
    "carriage_loop": {
        "crop_box": (700, 800, 2900, 2300),
        "mask_box": None,
        "prompt": "Top-down flat overhead view of estate grounds at night: a thin pale cobblestone carriage drive forming a wide oval loop on dark green-black lawn. Small dark rectangular horse-drawn carriages parked along the loop edges. The oval loop is the main feature, surrounded by dark lawn with silver-blue moonlight. Small amber lanterns along the drive. Flat two-dimensional, zero perspective. Dark fantasy painterly, night atmosphere, muted palette. No text, no labels, no grid, no characters.",
    },
    "servants_alley": {
        "crop_box": (2800, 400, 3600, 2500),
        "mask_box": (600, 100, 800, 2000),
        "prompt": "A narrow dark servants' alley passage running vertically between a wrought-iron fence and a tall dark hedge row, seen from directly above at night. Thin shadowy gap with dark stone paving. Dark fantasy painterly, night atmosphere. No text, no labels, no grid, no characters.",
    },
    "gate_cleanup": {
        "crop_box": (1200, 1900, 2400, 2700),
        "mask_box": (200, 200, 1000, 600),
        "prompt": "Top-down flat overhead view of a cobblestone carriage drive meeting ornate iron gates at night. Pale cobblestone surface with small dark rectangular carriage shapes. Wrought-iron fence with stone pillars. Amber lantern glow. Dark fantasy painterly, night atmosphere. No text, no labels, no grid, no characters, no people, no figures.",
    },
}


def inpaint_region(region_name, custom_prompt=None):
    """Crop region, create mask, run FLUX.1 Pro Fill, paste back."""
    cfg = REGIONS[region_name]
    crop_box = cfg["crop_box"]
    prompt = custom_prompt or cfg["prompt"]

    cx1, cy1, cx2, cy2 = crop_box
    crop_w = cx2 - cx1
    crop_h = cy2 - cy1

    print(f"\n{'='*60}")
    print(f"Inpainting region: {region_name}")
    print(f"Crop box: {crop_box} ({crop_w}x{crop_h})")
    print(f"Prompt: {prompt[:100]}...")
    print(f"{'='*60}")

    # Load and crop the base image
    base = Image.open(BASE_IMAGE)
    assert base.size == (W, H), f"Expected {W}x{H}, got {base.size}"
    crop = base.crop(crop_box)

    # Create mask for the crop — white = inpaint area
    if cfg.get("mask_box"):
        mx1, my1, mx2, my2 = cfg["mask_box"]
        mask = Image.new("RGB", (crop_w, crop_h), (0, 0, 0))
        draw = ImageDraw.Draw(mask)
        draw.rectangle([mx1, my1, mx2, my2], fill=(255, 255, 255))
        # Soft edges for blending
        mask = mask.filter(ImageFilter.GaussianBlur(radius=15))
    else:
        # Entire crop is the inpaint zone, but feather the outer edges
        # so it blends with the surrounding base image
        mask = Image.new("RGB", (crop_w, crop_h), (255, 255, 255))
        draw = ImageDraw.Draw(mask)
        feather = 40
        # Draw black border that feathers inward
        draw.rectangle([0, 0, crop_w, feather], fill=(0, 0, 0))
        draw.rectangle([0, crop_h - feather, crop_w, crop_h], fill=(0, 0, 0))
        draw.rectangle([0, 0, feather, crop_h], fill=(0, 0, 0))
        draw.rectangle([crop_w - feather, 0, crop_w, crop_h], fill=(0, 0, 0))
        mask = mask.filter(ImageFilter.GaussianBlur(radius=feather))

    # Save crop and mask to temp files for upload
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        crop_path = f.name
        crop.save(crop_path, "PNG")
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        mask_path = f.name
        mask.save(mask_path, "PNG")

    # Also save for debugging
    crop.save(f"/tmp/m02-crop-{region_name}.png")
    mask.save(f"/tmp/m02-mask-{region_name}.png")
    print(f"  Crop saved: /tmp/m02-crop-{region_name}.png ({crop_w}x{crop_h})")
    print(f"  Mask saved: /tmp/m02-mask-{region_name}.png")

    # Upload to fal
    print("  Uploading crop...")
    crop_url = fal_client.upload_file(crop_path)
    print(f"  Crop URL: {crop_url}")

    print("  Uploading mask...")
    mask_url = fal_client.upload_file(mask_path)
    print(f"  Mask URL: {mask_url}")

    # Call FLUX.1 Pro Fill
    print("  Running FLUX.1 Pro Fill...")
    result = fal_client.subscribe(
        "fal-ai/flux-pro/v1/fill",
        arguments={
            "prompt": prompt,
            "image_url": crop_url,
            "mask_url": mask_url,
            "output_format": "png",
            "safety_tolerance": "5",
        },
    )

    # Download result
    image_url = result["images"][0]["url"]
    print(f"  Result URL: {image_url}")

    response = requests.get(image_url)
    response.raise_for_status()
    result_img = Image.open(BytesIO(response.content))
    print(f"  Result dimensions: {result_img.size}")

    # Resize back to crop dimensions if FLUX changed them
    if result_img.size != (crop_w, crop_h):
        print(f"  Resizing from {result_img.size} to ({crop_w}, {crop_h})...")
        result_img = result_img.resize((crop_w, crop_h), Image.LANCZOS)

    # Paste result back into full image
    composite = base.copy()
    composite.paste(result_img, (cx1, cy1))

    # Save result
    output_path = f"/tmp/m02-versions/m02-{region_name}-fill.png"
    composite.save(output_path, "PNG", optimize=True)
    size_kb = os.path.getsize(output_path) / 1024
    print(f"  Saved composited result: {output_path} ({size_kb:.0f} KB)")

    # Cleanup temp files
    os.unlink(crop_path)
    os.unlink(mask_path)

    return output_path


def apply_to_base(inpaint_path, region_name):
    """Copy the inpainted result as the new base image."""
    from shutil import copy2
    backup = f"/tmp/m02-versions/m02-before-{region_name}.png"
    copy2(BASE_IMAGE, backup)
    print(f"  Backed up base to: {backup}")
    copy2(inpaint_path, BASE_IMAGE)
    print(f"  Applied inpaint to: {BASE_IMAGE}")


def main():
    api_key = os.environ.get("FAL_KEY")
    if not api_key:
        raise RuntimeError("FAL_KEY not set — source ~/.zshrc first")

    if len(sys.argv) < 2:
        print("Usage: python inpaint_m02.py <region_name> [--prompt 'text'] [--apply]")
        print(f"Regions: {', '.join(REGIONS.keys())}")
        sys.exit(1)

    region_name = sys.argv[1]
    custom_prompt = None
    should_apply = "--apply" in sys.argv

    if "--prompt" in sys.argv:
        idx = sys.argv.index("--prompt")
        custom_prompt = sys.argv[idx + 1]

    if region_name not in REGIONS:
        print(f"Unknown region: {region_name}. Available: {', '.join(REGIONS.keys())}")
        sys.exit(1)

    result_path = inpaint_region(region_name, custom_prompt)

    if should_apply and result_path:
        apply_to_base(result_path, region_name)
        print("\nApplied! Base image updated.")
    else:
        print(f"\nPreview at: {result_path}")
        print("Re-run with --apply to overwrite base image.")


if __name__ == "__main__":
    main()
