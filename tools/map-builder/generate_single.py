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
        "model": "nano-banana-2",
        "prompt": """Photorealistic high-altitude aerial photograph of a sprawling noble estate during an evening gala, captured by a drone camera looking perfectly straight down. The entire estate property fills the frame. The image has the quality of a large-format film photograph — extreme sharpness, natural lighting, rich tonal depth. No perspective distortion, no vanishing points — a true orthographic overhead view. Late autumn night, surfaces wet with dew, half-moon behind thin clouds. The quality of light evokes Atkinson Grimshaw or John Singer Sargent.

ESTATE PERIMETER: A continuous wrought-iron fence encloses the entire rectangular property. Narrow vertical iron bars with pointed finials, supported by square stone pillars every 20 feet, each capped with a carved stone urn. The iron has dark oxidized patina with rust streaks at joints. Stone pillars show lichen patches, hairline cracks, and mineral staining from rain runoff. The fence runs along all four edges of the property.

MANSION (upper center, roughly one-seventh of total image area): Viewed from directly above, only the roof is visible — dark blue-grey Welsh slate in precise overlapping courses, lead flashing along ridge lines and valley intersections. Four substantial brick chimney stacks with decorative corbelling and terracotta pots, several with visible soot staining. One chimney on the west wing is particularly prominent, casting a narrow shadow corridor across the roof. A raised stone platform on the east tower serves as a sentry lookout position, slightly elevated above the main roofline. Copper guttering along all eaves, aged to deep verdigris green. Peaked dormer windows with zinc-clad cheeks on the south-facing slope. Dense English ivy (Hedera helix) has colonized the north and west facades, dark waxy leaves creeping over the roof edge in thick irregular mats. The mansion is pale cream limestone — visible at the building's edges where the walls extend slightly beyond the roofline. Along the west side of the mansion, tall arched ballroom windows blaze with brilliant warm amber-gold light, significantly brighter than the rest of the house, the crystal chandelier glow pouring outward. A weathered stone second-floor balcony with iron railings projects from the south face, twelve feet above ground level, with hedge rows and gravel paths silvered with moonlight visible below it. The front entrance (south-facing) has a narrow red carpet laid down the front steps, flanked by enchanted lanterns that glow in shifting jewel tones — emerald, sapphire, and ruby — distinctly different from the amber oil lanterns elsewhere. A back door on the north side of the mansion faces the gardens, a plain servants' exit opening onto a gravel path.

CARRIAGE DRIVE (center, below mansion): A cobblestone carriage drive traces a wide oval loop around an island of manicured lawn. The cobblestones are Belgian block — small rectangular granite setts with rounded tops and dark bituminous mortar joints, the surface wet and glistening with reflected lantern light. Twelve horse-drawn carriages parked along the outer edge of the loop, each a four-wheeled brougham with dark lacquered wooden body, brass door fittings, thin iron-rimmed spoked wheels, and a two-horse team in harness. Each carriage casts a crisp shadow from nearby lantern posts. Carriage drivers cluster together near the center of the loop, sharing a flask — tiny dark figures barely visible. The drive exits the loop at the bottom and leads straight to the main gates. Gravel shoulders border the cobblestone, pale crushed limestone contrasting with dark wet setts.

MAIN GATES (bottom center): Twin ornate wrought-iron gate panels hang from massive square stone gateposts, each gatepost eight feet tall with a carved stone finial. The gates bear the Veymar family crest in hammered bronze at their center — a heraldic shield design visible from above as a small bright metallic accent. Elaborate scrollwork with acanthus leaf patterns across both gate panels. Two tall wrought-iron lantern posts flank the gates, each with a glass-paned oil lantern casting overlapping pools of warm amber light across the cobblestone entrance. The gates stand slightly ajar, one panel swung inward on oiled hinges. A small stone guardhouse with a slate roof sits just inside the gate to the right, a single window glowing with warm interior light.

SERVANTS' ENTRANCE (east side of estate): The east side of the property is distinctly darker and quieter than the rest — no carriage lanterns, no decorative lighting, no gala activity. A narrow alley runs between the outer iron fence and a tall row of dense hedges, just wide enough for one person. At the far end of this shadowy passage, a plain wooden door is set into the mansion's east wall — small, utilitarian, unpainted. A stone buttress projects from the wall nearby where a guard might lean. A thin wisp of kitchen steam or smoke rises from a vent grate above the door. The door's threshold shows worn stone from years of servants' footsteps. A wooden crate props the door slightly ajar. This entire area is deliberately unlit — the only light is faint spillover from the mansion's upper windows.

PERFORMER'S ENTRANCE (south-east side, near ballroom): A side entrance is set into the south wall of the mansion near where the west-side ballroom meets the main structure. A small alley or alcove area where performers gather before entering — visible from above as a small paved area adjacent to the mansion wall, with a hand-painted sign on an easel barely visible as a tiny pale rectangle. The service corridor entrance is a modest door, less ornate than the front entrance but better maintained than the servants' door. Faint warm light spills from this doorway.

WEST WALL AND OPEN LAWN (left third of image): An old boundary wall runs north-south along the left side of the estate, set inward from the iron perimeter fence. Constructed from rough-cut ashlar limestone blocks — each block individually visible with chisel marks, dark mortar joints, moss colonization, ferns sprouting from cracks, and thick woody ivy trunks with aerial rootlets. The wall is twelve feet high along most of its length, but visibly lower — approximately eight feet — near the back gardens at the northern end, where the ivy growth is thickest and the mortar most crumbled. The wall is older than the rest of the estate, visibly rougher and more weathered than anything else on the property. Beyond the wall (to the left, outside the estate), the dark upper stories of a row of townhouses are faintly visible, their windows unlit. Inside the wall, at its base, beds of trimmed lavender border a narrow strip of soft earth — a natural landing zone for anyone climbing over. East of the wall stretches the estate's largest open space — a broad fifty-yard expanse of dark lawn, the most exposed area on the entire property. The grass is deep emerald green, mown in visible alternating stripe patterns. Silver-blue moonlight from the half-moon illuminates the lawn unevenly, pooling in slight depressions. Thin wisps of ground fog drift across the lowest sections as translucent grey-white tendrils. Fallen oak and beech leaves in ochre and russet collect in windblown drifts along the wall base. A gravel path crosses the lawn toward the mansion's back door — pale and exposed, it would crunch underfoot. Dark shapes of garden topiaries loom like sentinels at the edges of the lawn where it meets the formal gardens.

FORMAL GARDENS (right third of image): Elaborate formal gardens in a geometric parterre pattern. Angular hedges of English box (Buxus sempervirens) and yew (Taxus baccata) clipped into precise geometric shapes — diamond lozenges, tight spirals, low rectangular borders — with razor-sharp edges. Between the hedges, gravel paths surfaced with pale cream Cotswold limestone chippings, each pebble visible, raked into neat lines. Dark patinated bronze statues on stone pedestals at path intersections — classical figures with verdigris streaking down their surfaces. At the garden center, a circular stone fountain basin six feet in diameter with dark reflective water, a faint shimmer of moonlight on its surface, and a carved stone cherub centerpiece with water stains down the pale limestone. The fountain gurgles audibly — suggested by concentric ripples visible in the dark water. The gravel paths are silvered with moonlight, creating a delicate tracery of pale lines through the dark garden.

CONSERVATORY (far right, at edge of formal gardens): A Victorian glasshouse with slender cast-iron columns and glazing bars, aged to dark rust-brown with patches of original black paint. Glass roof panels — some clear, some with condensation droplets — glow with a distinctive warm amber-green light from phosphorescent orchids and oil lamps within. Dark silhouettes of palm fronds, trailing ferns, and exotic plants visible through the glass as shadow shapes. The conservatory is half-hidden by the hedge maze that sprawls from its entrance. Stone foundation wall shows damp staining and moss growth. The air around it would smell of wet earth and night-blooming jasmine — suggested by climbing jasmine vines on the iron framework, their small white flowers catching the interior glow.

HEDGE MAZE (sprawling from conservatory entrance): A compact labyrinth of tall, tightly clipped yew hedges, walls six feet high and two feet thick. From above, the maze pattern is clearly visible as a geometric network of dark green corridors and dead ends. The yew foliage is so dense it appears almost black in shadow. A small weathered stone bench at the maze center. Fallen red yew berries (bright arils) dot the gravel at the maze entrance. The hedge maze sprawls outward from the conservatory's entrance, connecting the two features — anyone approaching the conservatory must navigate through or around the maze.

GUARD HOUSE (inside the gate, right side): A small stone outbuilding with a slate roof near the main gates, just inside the perimeter. A single window glows with warm interior light. This is where guards rotate and reinforcements wait — the building is utilitarian, not decorative.

LIGHTING AND ATMOSPHERE: The estate has three distinct lighting zones creating a dramatic patchwork of visibility and shadow:

ZONE 1 — BRIGHT (the gala): The carriage drive and front entrance are the brightest areas. Wrought-iron lantern posts line the drive at regular intervals, each with a four-sided glass-and-iron lantern casting a warm pool of amber-gold light fifteen feet in diameter, with realistic falloff from bright center through warm orange to deep shadow at edges. Wet cobblestones within each light pool show reflections of the flame above. The front entrance blazes with the shifting jewel-tone enchanted lanterns. The ballroom windows cast brilliant amber rectangles of light across the ground on the west side of the mansion.

ZONE 2 — MOONLIT (the lawn and gardens): The open lawn and garden paths are lit only by diffuse silver-blue moonlight. Gravel paths gleam faintly. Ground fog catches the light. This zone is exposed but dimly lit — the fifty-yard lawn crossing would be visible to anyone watching from the mansion or rooftop.

ZONE 3 — DARK (the shadows): The east side servants' area has almost no light. The hedge maze interior is black. The space behind the conservatory is deeply shadowed. Garden corners where hedges meet walls are pools of darkness. The area beneath the dense ivy on the west wall is impenetrable shadow. These dark zones are where infiltrators would move unseen.

The color palette: deep midnight navy blues, warm amber and golden candlelight, cool silver moonlight, aged cream limestone, dark emerald and forest green foliage, wet stone sheen, copper verdigris, and the occasional jewel-bright accent of the enchanted lanterns. Every surface carries the weight of age and weather — nothing is pristine or new. The mood is simultaneously beautiful and threatening — a gala masking danger.

Absolutely no people, no figures, no characters, no text, no labels, no grid lines, no watermarks, no borders visible anywhere in the image.""",
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
    """Generate a single map image via FLUX.2 Pro or Nano Banana 2."""
    cfg = MAPS[map_id]
    output = os.path.join(ASSET_DIR, cfg["file"])
    w, h = cfg["width"], cfg["height"]
    model = cfg.get("model", "flux-2-pro")

    print(f"\n{'='*60}")
    print(f"Generating {map_id}: {cfg['file']} ({w}x{h}) via {model}")
    print(f"{'='*60}")

    if model == "nano-banana-2":
        result = fal_client.subscribe(
            "fal-ai/nano-banana-2",
            arguments={
                "prompt": cfg["prompt"],
                "resolution": "4K",
                "aspect_ratio": cfg.get("aspect_ratio", "4:3"),
                "num_images": 1,
                "output_format": "png",
                "safety_tolerance": "6",
            },
        )
    else:
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
