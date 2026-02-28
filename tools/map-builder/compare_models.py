#!/usr/bin/env python3
"""Compare image generation models for M02 estate grounds map.

Generates the same prompt across multiple models and saves results
for side-by-side comparison.

Usage:
    python compare_models.py                # run all models
    python compare_models.py nano flux-max  # run specific models
"""

import os
import sys
import fal_client
from PIL import Image
from io import BytesIO
import requests

OUTPUT_DIR = "/tmp/m02-model-compare"

PROMPT_V1 = """Flat two-dimensional map illustration of a noble estate at night, perfectly overhead looking straight down. Zero perspective, zero vanishing points. Wide aerial top-down tabletop RPG infiltration map.

A wrought-iron fence with stone pillar caps encloses the entire estate along all four edges, thin dark iron bars with evenly spaced weathered grey stone posts.

The upper center shows a grand three-story mansion rooftop from directly above — dark blue-grey slate tiles in overlapping rows with visible ridge lines, copper-green weathered gutters, four tall brick chimney stacks, and peaked dormer windows. Thick dark ivy climbs the north and west walls visible creeping over roof edges. Warm amber light spills outward from window edges onto the wet cobblestone below in long golden rectangles. The mansion roof is roughly one-seventh of the total map area.

Below the mansion, a cobblestone carriage drive curves in a wide oval loop — each individual cobblestone visible as a small rounded grey stone with dark mortar gaps, the surface glistening wet from evening dew. A dozen horse-drawn carriages park along the loop, each a small dark lacquered wooden cab with thin spoked wheels and a horse team, casting tiny shadows. The drive connects to twin ornate wrought-iron gates at the bottom center, flanked by tall stone pillars topped with flickering amber lantern flames.

The left third features an old rough stone wall running north-south — thick weathered grey blocks with dark moss and climbing ivy tendrils, visibly taller and rougher than the iron perimeter fence. East of this wall, a wide open lawn of dark green grass with visible blade texture, scattered wildflower patches, silver-blue moonlight pooling in low areas, and subtle ground fog wisps drifting across the darkest sections. Fallen autumn leaves collect along the wall base.

The right third shows elaborate formal gardens: angular dark green topiary hedges trimmed into geometric diamond and spiral patterns, separated by pale cream gravel walking paths with visible individual pebble texture. Dark bronze statue pedestals at path intersections. A circular stone fountain with dark reflective water and a carved stone centerpiece sits at the garden center. In the far right, a glass conservatory with oxidized iron framing glows warm amber and faint green from exotic plants visible through the glass panels. Adjacent to the conservatory, a hedge maze of tight angular yew walls forms a visible labyrinth pattern from above, with a small stone bench at its center.

Flickering amber lanterns on wrought-iron posts line the carriage drive and main garden paths, each casting a warm pool of golden light on the wet ground below with visible light falloff into deep shadow. The open lawn areas between features are dark with silver-blue moonlight filtering through scattered clouds. Deep dramatic shadows fill garden corners, the space behind the hedge maze, and beneath the carriages. Wisps of evening mist curl around the fountain and along the base of the perimeter wall.

Night atmosphere with starry sky tone over all unlit areas. Dark fantasy painterly digital art in the style of a richly detailed oil painting, gothic aristocratic atmosphere. Rich saturated palette of deep midnight blues, warm burning ambers, aged pale stone, dark emerald greens, silver moonlight, and copper patina. Highly detailed textures on every surface — weathered stone, glistening cobblestone, trimmed hedge leaves, wrought iron scrollwork, wet grass. No text, no labels, no grid lines, no borders, no characters or figures."""

PROMPT_V2 = """Photorealistic high-altitude aerial photograph of a sprawling noble estate at night, captured by a drone camera looking perfectly straight down. The entire estate property fills the frame. The image has the quality of a large-format film photograph with extreme sharpness, natural lighting, and rich tonal depth. No perspective distortion, no vanishing points — a true orthographic overhead view as if taken from a satellite."""

PROMPT = """Photorealistic high-altitude aerial photograph of a sprawling noble estate during an evening gala, captured by a drone camera looking perfectly straight down. The entire estate property fills the frame. The image has the quality of a large-format film photograph — extreme sharpness, natural lighting, rich tonal depth. No perspective distortion, no vanishing points — a true orthographic overhead view. Late autumn night, surfaces wet with dew, half-moon behind thin clouds. The quality of light evokes Atkinson Grimshaw or John Singer Sargent.

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

Absolutely no people, no figures, no characters, no text, no labels, no grid lines, no watermarks, no borders visible anywhere in the image."""


MODELS = {
    "nano": {
        "label": "Nano Banana 2 (4K, 4:3)",
        "endpoint": "fal-ai/nano-banana-2",
        "arguments": {
            "prompt": PROMPT,
            "resolution": "4K",
            "aspect_ratio": "4:3",
            "num_images": 1,
            "output_format": "png",
            "safety_tolerance": "6",
        },
        "cost": "~$0.16",
    },
    "flux-max": {
        "label": "FLUX.2 Max (3600x2700)",
        "endpoint": "fal-ai/flux-2-max",
        "arguments": {
            "prompt": PROMPT,
            "image_size": {"width": 3600, "height": 2700},
            "num_images": 1,
            "safety_tolerance": "5",
        },
        "cost": "~$0.34",
    },
    "seedream": {
        "label": "Seedream v4.5 (3600x2700)",
        "endpoint": "fal-ai/bytedance/seedream/v4.5/text-to-image",
        "arguments": {
            "prompt": PROMPT,
            "image_size": {"width": 3600, "height": 2700},
            "num_images": 1,
        },
        "cost": "~$0.04",
    },
}


def generate(model_key):
    cfg = MODELS[model_key]
    print(f"\n{'='*60}")
    print(f"Model: {cfg['label']}")
    print(f"Endpoint: {cfg['endpoint']}")
    print(f"Estimated cost: {cfg['cost']}")
    print(f"{'='*60}")

    result = fal_client.subscribe(
        cfg["endpoint"],
        arguments=cfg["arguments"],
    )

    image_url = result["images"][0]["url"]
    print(f"  Result URL: {image_url}")

    response = requests.get(image_url)
    response.raise_for_status()
    img = Image.open(BytesIO(response.content))
    print(f"  Dimensions: {img.size}")

    output_path = os.path.join(OUTPUT_DIR, f"m02-{model_key}.png")
    img.save(output_path, "PNG", optimize=True)
    size_kb = os.path.getsize(output_path) / 1024
    print(f"  Saved: {output_path} ({size_kb:.0f} KB)")
    return output_path


def main():
    api_key = os.environ.get("FAL_KEY")
    if not api_key:
        raise RuntimeError("FAL_KEY not set — source ~/.zshrc first")

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    requested = sys.argv[1:] if len(sys.argv) > 1 else list(MODELS.keys())
    for key in requested:
        if key not in MODELS:
            print(f"Unknown model: {key}. Available: {', '.join(MODELS.keys())}")
            sys.exit(1)

    total_cost = sum(
        float(MODELS[k]["cost"].replace("~$", "")) for k in requested
    )
    print(f"Generating {len(requested)} image(s): {', '.join(requested)}")
    print(f"Estimated total cost: ~${total_cost:.2f}")

    for key in requested:
        generate(key)

    print(f"\nDone! Results in {OUTPUT_DIR}/")


if __name__ == "__main__":
    main()
