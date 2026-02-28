#!/usr/bin/env python3
"""Generate battle maps via FLUX.2 Pro single-image generation.

Usage:
    python generate_single.py           # generate all maps
    python generate_single.py M01 M03   # generate specific maps
"""

import os
import sys
import fal_client
from PIL import Image
from io import BytesIO
import requests

ASSET_DIR = "campaigns/puzzle-box/assets/maps"

# Map definitions: id → (filename, width, height, prompt)
MAPS = {
    "M01": {
        "file": "m01-dock-district.png",
        "width": 3600,
        "height": 2700,
        "prompt": """Wide aerial top-down view of an entire fantasy harbor district neighborhood, a tabletop RPG exploration map. Flat two-dimensional map illustration, perfectly overhead looking straight down. Zero perspective, zero vanishing points.

Thirty to forty small buildings arranged in city blocks separated by a network of cobblestone streets and narrow alleys. Every building is seen from above as a small rectangular or L-shaped shingled rooftop, each only a tiny fraction of the total map area. Wide cobblestone streets form a clear navigable grid pattern with a main north-south avenue running through the center and several cross streets branching east-west. The streets are the dominant visual feature, brighter grey stone contrasting against dark rooftops.

The bottom fifth is dark teal harbor water. A horizontal wooden dock boardwalk separates the water from the district. Three small wooden piers extend into the water with tiny fishing boats moored alongside. One slightly larger tavern building sits directly behind the boardwalk at center-left, identifiable by a small iron anchor sign on its dark roof — the only waterfront building with a lit entrance glowing warm amber.

In the middle-left area, a small courtyard between buildings is covered with bright colorful canvas tarps in red, gold, and blue forming a vivid patchwork visible from above — a hidden market square, the most colorful area on the entire map. In the middle-right area, a slightly smaller tavern with a damaged dark roof sits at a street corner.

The top edge has slightly nicer buildings with one small stone building featuring a visible chimney with warm amber smoke — a bakery near the ward boundary. Streets are wider and cleaner at the top.

Flickering lantern posts line the main streets casting tiny warm amber pools of light on wet cobblestones. Evening atmosphere. Dark fantasy painterly digital art, muted weathered browns, dark grey stone, dark teal water, warm amber light. No text, no labels, no grid lines, no borders, no characters or figures.""",
    },
    "M02": {
        "file": "m02-estate-grounds.png",
        "width": 3600,
        "height": 2700,
        "prompt": """Flat two-dimensional map illustration of a noble estate at night, perfectly overhead looking straight down. Zero perspective, zero vanishing points. Wide aerial top-down tabletop RPG infiltration map.

A wrought-iron fence with stone pillar caps encloses the entire estate along all four edges, thin dark iron bars with evenly spaced weathered grey stone posts.

The upper center shows a grand three-story mansion rooftop from directly above — dark blue-grey slate tiles in overlapping rows with visible ridge lines, copper-green weathered gutters, four tall brick chimney stacks, and peaked dormer windows. Thick dark ivy climbs the north and west walls visible creeping over roof edges. Warm amber light spills outward from window edges onto the wet cobblestone below in long golden rectangles. The mansion roof is roughly one-seventh of the total map area.

Below the mansion, a cobblestone carriage drive curves in a wide oval loop — each individual cobblestone visible as a small rounded grey stone with dark mortar gaps, the surface glistening wet from evening dew. A dozen horse-drawn carriages park along the loop, each a small dark lacquered wooden cab with thin spoked wheels and a horse team, casting tiny shadows. The drive connects to twin ornate wrought-iron gates at the bottom center, flanked by tall stone pillars topped with flickering amber lantern flames.

The left third features an old rough stone wall running north-south — thick weathered grey blocks with dark moss and climbing ivy tendrils, visibly taller and rougher than the iron perimeter fence. East of this wall, a wide open lawn of dark green grass with visible blade texture, scattered wildflower patches, silver-blue moonlight pooling in low areas, and subtle ground fog wisps drifting across the darkest sections. Fallen autumn leaves collect along the wall base.

The right third shows elaborate formal gardens: angular dark green topiary hedges trimmed into geometric diamond and spiral patterns, separated by pale cream gravel walking paths with visible individual pebble texture. Dark bronze statue pedestals at path intersections. A circular stone fountain with dark reflective water and a carved stone centerpiece sits at the garden center. In the far right, a glass conservatory with oxidized iron framing glows warm amber and faint green from exotic plants visible through the glass panels. Adjacent to the conservatory, a hedge maze of tight angular yew walls forms a visible labyrinth pattern from above, with a small stone bench at its center.

Flickering amber lanterns on wrought-iron posts line the carriage drive and main garden paths, each casting a warm pool of golden light on the wet ground below with visible light falloff into deep shadow. The open lawn areas between features are dark with silver-blue moonlight filtering through scattered clouds. Deep dramatic shadows fill garden corners, the space behind the hedge maze, and beneath the carriages. Wisps of evening mist curl around the fountain and along the base of the perimeter wall.

Night atmosphere with starry sky tone over all unlit areas. Dark fantasy painterly digital art in the style of a richly detailed oil painting, gothic aristocratic atmosphere. Rich saturated palette of deep midnight blues, warm burning ambers, aged pale stone, dark emerald greens, silver moonlight, and copper patina. Highly detailed textures on every surface — weathered stone, glistening cobblestone, trimmed hedge leaves, wrought iron scrollwork, wet grass. No text, no labels, no grid lines, no borders, no characters or figures.""",
    },
    "M03": {
        "file": "m03-mansion-ground.png",
        "width": 2250,
        "height": 1800,
        "prompt": """The ground floor interior of a grand noble mansion during an evening gala seen from perfectly top-down bird's eye view, a fantasy tabletop RPG tactical battle map. The camera is directly overhead looking straight down, with the roof removed to reveal the floor plan.

A vast ballroom dominates the left half with black-and-white marble tile flooring in geometric diamond patterns. Three massive crystal chandeliers hang from chains above casting prismatic light across the dance floor. Deep crimson curtains frame tall arched windows along the left wall. A raised stage platform in the far left corner holds a string quartet area. A grand sweeping marble staircase rises from the center toward the top of the map with an ornate carved banister.

The right half contains the main entry foyer with marble columns and polished stone floor. A formal dining hall with a long dark wood table occupies the upper right. The kitchen area in the lower right shows multiple cooking hearths, copper pots on hanging racks, wooden prep tables, and flour sack storage. A narrow servants' corridor runs along the far right connecting kitchen to foyer.

Warm golden candlelight fills the ballroom from chandeliers and wall sconces. The kitchen glows orange-red from hearth fires. Servants' corridors are dimmer with tallow candle sconces. Interior walls are thick pale stone seen as bands from above, with dark wood doorframes.

Dark fantasy painterly digital art, gothic aristocratic interior, rich palette of warm golds, deep crimsons, black-white marble, and dark polished wood. Highly detailed textures on marble, crystal, fabric, and copper. No text, no labels, no grid lines, no borders, no characters or figures.""",
    },
    "M04": {
        "file": "m04-mansion-second.png",
        "width": 2250,
        "height": 1800,
        "prompt": """The second floor interior of a grand noble mansion seen from perfectly top-down bird's eye view, a fantasy tabletop RPG tactical battle map. The camera is directly overhead looking straight down, with the roof removed to reveal the floor plan.

A wide upper landing at the center top where the grand staircase arrives from below, with ornate banister railing visible from above. Long carpeted corridors extend left and right from the landing, lined with closed dark wooden doors to guest rooms. Rich burgundy carpet runners line the hallway floors over dark hardwood.

A library occupies the lower left with floor-to-ceiling dark wood bookshelves lining all walls, volumes with silver and gold stamped spines visible from above, and a reading desk in the center. A private parlor sits in the lower right with plush seating furniture and a small side table. A locked reinforced door in the upper right leads to a narrow spiral staircase going up to the third floor.

Narrow whitewashed servants' passages run along the far right side with bare stone floors and tallow candle wall sconces. A small dumbwaiter hatch is visible in the wall near the kitchen passage. The lighting is dimmer than the ground floor: oil lamps in wall sconces along corridors, warmer reading light in the library from a desk lamp, and minimal light in servants' passages.

Dark fantasy painterly digital art, gothic aristocratic interior, muted palette of deep burgundy carpets, dark polished wood, warm oil lamp amber, and pale plaster walls. Highly detailed textures on wood, carpet, leather, and plaster. No text, no labels, no grid lines, no borders, no characters or figures.""",
    },
    "M05": {
        "file": "m05-mansion-third.png",
        "width": 2250,
        "height": 1800,
        "prompt": """The third floor private study level of a grand noble mansion seen from perfectly top-down bird's eye view, a fantasy tabletop RPG tactical battle map. The camera is directly overhead looking straight down, with the roof removed to reveal the floor plan.

A narrow corridor runs from the bottom center where a spiral staircase arrives from below, with deep bruised burgundy wallpaper on corridor walls visible from above. A single oil lamp wall sconce provides dim amber light in the hallway. The corridor leads to a heavy reinforced oak door with iron banding in the center of the map.

Beyond the door, a large scholarly study fills the upper portion of the map. Floor-to-ceiling dark wood bookshelves line all walls of the study, packed with leather-bound volumes. A heavy oak desk dominates the center of the study covered in scattered star charts and arcane diagrams. Tall windows along the top wall are draped in deep blue curtains with silver moonlight filtering through gaps. A glass display case on an iron pedestal stands between the windows containing a small ornate object on a velvet cushion.

A private gallery with framed paintings on the walls occupies the left side. An arcane workshop area with a stone workbench, glass vials, and scattered scrolls fills the lower left. The atmosphere is much darker and more isolated than lower floors. Faint blue-white arcane energy threads shimmer around the reinforced doorframe.

Dark fantasy painterly digital art, gothic scholarly atmosphere, dark moody palette of deep burgundy, midnight blue, aged wood brown, and faint arcane blue-white. Highly detailed textures on wood, leather, glass, and parchment. No text, no labels, no grid lines, no borders, no characters or figures.""",
    },
    "M06": {
        "file": "m06-warehouse.png",
        "width": 2700,
        "height": 1800,
        "prompt": """A dark stone warehouse interior seen from perfectly top-down bird's eye view, a fantasy tabletop RPG tactical battle map. The camera is directly overhead looking straight down at the floor.

Large five-pointed arcane star pattern inscribed into the stone floor in dark crimson ritual markings dominates the center of the warehouse. A binding circle surrounds the star on the floor. Faint glowing arcane energy traces parts of the star pattern. Dark crimson arcane residue spreads outward from the circle's center in thin tendrils across the grey-brown flagstones.

Thick dark stone perimeter walls form a wide rectangle around the entire warehouse, seen as thick dark bands from above. Wooden crates, barrels, and shipping boxes stacked one to two deep against all four walls. Large double wooden doors with iron bindings at the bottom center of the south wall, slightly ajar. A narrow side door gap in the right east wall. Wall-mounted iron sconces with warm amber torchlight along the perimeter walls, creating pools of orange warmth.

The center seventy percent of the warehouse floor is wide open worn grey-brown stone flagstones with thin dark mortar lines between them, clear combat space surrounding the arcane circle. Dark stains, scratches, and scuff marks on the ancient stone floor. Atmospheric shadows pool in the corners. The overall lighting is cinematic: warm amber from wall sconces along the edges, deep darkness in the far corners.

Dark fantasy painterly digital art, gothic atmosphere, rich saturated color palette of deep ambers, warm oranges, dark reds, and stone greys. Highly detailed textures on stone, wood, and metal. No braziers, no fire bowls, no standing objects on the open floor. No text, no labels, no grid lines, no borders, no characters or figures.""",
    },
}


def generate_map(map_id):
    """Generate a single map image via FLUX.2 Pro."""
    cfg = MAPS[map_id]
    output = os.path.join(ASSET_DIR, cfg["file"])
    w, h = cfg["width"], cfg["height"]

    print(f"\n{'='*60}")
    print(f"Generating {map_id}: {cfg['file']} ({w}x{h})")
    print(f"{'='*60}")

    result = fal_client.subscribe(
        "fal-ai/flux-2-pro",
        arguments={
            "prompt": cfg["prompt"],
            "image_size": {"width": w, "height": h},
            "num_images": 1,
            "safety_tolerance": "5",
        },
    )

    image_url = result["images"][0]["url"]
    print(f"  Image URL: {image_url}")

    response = requests.get(image_url)
    response.raise_for_status()
    img = Image.open(BytesIO(response.content))
    print(f"  Raw dimensions: {img.size}")

    if img.size != (w, h):
        print(f"  Resizing from {img.size} to ({w}, {h})...")
        img = img.resize((w, h), Image.LANCZOS)

    os.makedirs(os.path.dirname(output), exist_ok=True)
    img.save(output, "PNG", optimize=True)
    size_kb = os.path.getsize(output) / 1024
    print(f"  Saved to {output} ({size_kb:.0f} KB)")
    return output


def main():
    api_key = os.environ.get("FAL_KEY")
    if not api_key:
        raise RuntimeError("FAL_KEY not set — source ~/.zshrc first")

    # Parse args: specific map IDs or all
    requested = sys.argv[1:] if len(sys.argv) > 1 else list(MAPS.keys())
    for map_id in requested:
        if map_id not in MAPS:
            print(f"Unknown map: {map_id}. Available: {', '.join(MAPS.keys())}")
            sys.exit(1)

    print(f"Generating {len(requested)} map(s): {', '.join(requested)}")
    print(f"Estimated cost: ~${len(requested) * 0.09:.2f}")

    for map_id in requested:
        generate_map(map_id)

    print(f"\nDone! Generated {len(requested)} map(s).")


if __name__ == "__main__":
    main()
