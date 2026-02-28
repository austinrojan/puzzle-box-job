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
        "model": "nano-banana-2",
        "aspect_ratio": "5:4",
        "prompt": """Photorealistic architectural overhead photograph of the ground floor interior of a grand noble mansion during an evening gala, captured with a large-format camera looking perfectly straight down with the roof removed. The entire floor plan fills the frame in a single, seamless view — every room, corridor, and doorway visible at once. Extreme sharpness, natural lighting, rich tonal depth. No perspective distortion, no vanishing points — a true orthographic overhead view. The quality of light evokes Johannes Vermeer or John Singer Sargent — warm golden candlelight rendered with painterly realism.

OVERALL STRUCTURE: The floor plan is a roughly rectangular building footprint, approximately 75 feet east-west by 60 feet north-south. Thick exterior walls of pale cream limestone, visible from above as wide bands (roughly 2-3 feet thick) defining the building perimeter. Interior walls are slightly thinner — dark wood-paneled or whitewashed plaster depending on the room. Doorways appear as dark rectangular gaps in the walls, some with visible dark wood door frames. The building has two distinct halves: the grand public rooms on the west (left) and the utilitarian service areas on the east (right), divided by a central spine containing the foyer and grand staircase.

BALLROOM (entire west/left half of the building): The largest single room, occupying roughly half the total floor area. The floor is polished black-and-white marble tile laid in a geometric diamond checkerboard pattern — each diamond tile roughly 2 feet across, alternating glossy obsidian black and veined Carrara white, the joints precisely aligned. Three massive crystal chandeliers hang from above, each a cascade of hundreds of faceted glass prisms and brass armature — from directly overhead they appear as radial starburst patterns of glittering light, casting prismatic rainbow refractions across the marble floor below. The light from these chandeliers is warm amber-gold, the dominant illumination source for this half of the building. Along the entire west wall, tall arched windows with deep crimson velvet curtains frame views of the dark gardens outside — the curtains are drawn back with gold tasseled tiebacks, and warm amber light blazes outward through the glass. In the northwest corner, a raised wooden stage platform (elevated 18 inches, visible from above as a lighter-toned rectangular area of polished oak planking) holds music stands and chairs for a string quartet. The vaulted ceiling above (not visible but implied by the grandeur below) is painted with scenes of Waterdhavian conquest.

GRAND STAIRCASE (center of the building, slightly south of middle): A sweeping marble staircase with a wide lower section that narrows as it curves upward. From above, the staircase appears as a series of concentric curved steps in pale cream marble with dark iron-and-brass banister railings along both sides — ornate carved balusters with scrollwork visible from overhead. The lower landing is wide enough for six people abreast. A deep burgundy carpet runner traces the center of the steps, secured with brass stair rods. At the base of the staircase, the floor transitions from ballroom marble to foyer stone, and a single chair sits against the wall where a guard would station himself — a wooden straight-backed chair with a dark leather seat.

MAIN FOYER (south-center, below staircase): A formal entrance hall with a floor of polished pale stone — large rectangular flagstones in cream limestone with thin dark mortar joints, buffed to a reflective sheen. Four marble columns (each roughly 18 inches in diameter, pale grey-veined Carrara) stand in two pairs flanking the entrance axis, casting thin shadows from wall-mounted oil lamps. The south wall has the main entrance — a pair of tall dark oak double doors with brass handles and iron strap hinges, currently standing open. A narrow strip of deep crimson carpet (a red carpet runner) extends from the doors inward toward the staircase. Just inside the entrance, enchanted lanterns on wrought-iron wall brackets glow in shifting jewel tones — emerald, sapphire, and ruby light mixing on the pale stone floor in small colored pools. A tall grandfather clock stands against the east wall of the foyer, its dark wood case and brass pendulum face visible from above as a narrow dark rectangle.

DINING HALL (northeast quadrant, right of the ballroom, above the kitchen): A formal dining room with a dark hardwood floor of wide oak planks with a visible grain pattern. A long rectangular dining table dominates the center — dark polished mahogany, at least 12 feet long, set with white linen, silver candelabras (three of them, spaced evenly along the table), crystal glassware, and fine porcelain — all visible from above as precise arrangements of tiny glinting objects on white cloth. High-backed dark wood chairs line both sides. The walls are wood-paneled in dark walnut wainscoting. Oil paintings in heavy gilt frames hang on the walls (visible from above as small dark rectangles with gold borders). Wall-mounted brass candle sconces provide warm amber light.

KITCHEN (east side, roughly center-right): A large working kitchen with a floor of worn grey stone flagstones, darker and rougher than the foyer stone — scuffed, stained with grease spots, showing decades of heavy use. Three large cooking hearths are set into the east wall — each a wide dark opening with a visible iron grate and the warm orange-red glow of roaring fires, casting intense amber-orange light across the kitchen floor. Copper pots and pans hang from wrought-iron ceiling racks directly above the central prep area — visible from overhead as a cluster of gleaming reddish-copper circles and ovals. Heavy wooden prep tables with butcher-block tops occupy the center, their surfaces scarred with knife marks. A large wooden chopping block sits near the main hearth.

BACK PANTRY AND DUMBWAITER (behind the kitchen, northeast corner): A small storage room connected to the kitchen by an open doorway. Stacks of burlap flour sacks and wooden crates line the walls. In the far corner, partially hidden behind the flour sacks, a small square wooden shaft opening is visible in the floor/wall — the dumbwaiter, barely two feet square, with a small hand-crank mechanism and frayed rope visible from above. The pantry is dimly lit — no direct light source, only spillover from the kitchen hearths.

SERVANTS' CORRIDOR (running along the entire east/right edge of the building): A narrow corridor — just five feet wide — of bare stone floor and whitewashed plaster walls, connecting the kitchen to the foyer along the east side. The corridor is lit by small tallow candle sconces mounted on iron brackets at irregular intervals — their light is dim, yellowish, and guttering, creating pools of weak light separated by shadows. Several plain wooden doors open off this corridor into storage rooms and the servants' staircase. The servants' staircase — a narrow, steep wooden stair — rises from a doorway midway along the corridor. The corridor walls are noticeably rougher and plainer than the public rooms — no decoration, no paintings, no carpet.

SERVANTS' ENTRANCE (east wall, accessed from the corridor): A plain, unpainted wooden door set into the east exterior wall of the building. Small, utilitarian, with a simple iron latch — no ornamentation. The threshold stone is visibly worn smooth from years of foot traffic. A wooden crate props the door slightly ajar. No lanterns or decorative lighting near this door — the only illumination is faint spillover from the nearest tallow candle sconce down the corridor.

WINE CELLAR ACCESS (beneath the kitchen area): A narrow wooden staircase descends from the kitchen floor through a trapdoor or opening near the pantry area. From above, this appears as a dark rectangular opening in the floor with the top few worn wooden steps visible descending into darkness.

BACK DOOR (north wall, center-right): A plain servants' exit in the north wall of the building — a simple door opening onto the gardens beyond. Less ornate than the front entrance but functional. A small stone step visible outside the threshold.

LIGHTING AND ATMOSPHERE: The building has three distinct lighting zones:

ZONE 1 — BRILLIANT (ballroom and foyer): The three crystal chandeliers flood the entire west half with warm amber-gold light. Every surface gleams — the marble floor reflects the chandeliers as soft luminous pools, the crystal glassware on tables catches and refracts the light, the brass fixtures glow warmly. The enchanted lanterns at the entrance add small accent pools of jewel-colored light. This is the brightest, most inviting area.

ZONE 2 — WARM (dining hall and kitchen): The dining hall is lit by candelabras and wall sconces — warm but more intimate than the ballroom, with visible shadows in corners. The kitchen blazes with the intense orange-red glow of three hearths — a harsher, more utilitarian warmth than the golden candlelight of the public rooms. Copper pots catch and reflect the firelight.

ZONE 3 — DIM (servants' corridor, pantry, back areas): Tallow candles provide minimal, uneven light. The corridor is mostly shadow with small pools of yellowish light. The pantry and storage areas are nearly dark. The dumbwaiter shaft is completely black. This is where infiltrators move unseen — the contrast with the brilliant ballroom should be stark.

The color palette: warm amber-gold candlelight, glossy black-and-white marble, deep crimson velvet, dark polished mahogany, pale cream limestone, copper warmth, grey stone, whitewashed plaster. Every surface shows age and use — the marble has subtle wear patterns from foot traffic, the wood is deeply patinated, the stone floors are scuffed and stained. The overall mood is opulent but lived-in — a real working building hosting a grand event.

Absolutely no people, no figures, no characters, no text, no labels, no grid lines, no watermarks, no borders visible anywhere in the image.""",
    },
    "M04": {
        "file": "m04-mansion-second.png",
        "width": 2250,
        "height": 1800,
        "model": "nano-banana-2",
        "aspect_ratio": "5:4",
        "prompt": """Photorealistic architectural overhead photograph of the second floor interior of a grand noble mansion during an evening gala, captured with a large-format camera looking perfectly straight down with the roof removed. The entire floor plan fills the frame in a single, seamless view — every room, corridor, and doorway visible at once. Extreme sharpness, natural lighting, rich tonal depth. No perspective distortion, no vanishing points — a true orthographic overhead view. The quality of light evokes Johannes Vermeer — warm amber oil lamps rendered with painterly realism, but noticeably dimmer and more intimate than the brilliant ground floor below.

OVERALL STRUCTURE: The floor plan is a roughly rectangular building footprint, approximately 75 feet east-west by 60 feet north-south — the same footprint as the ground floor directly below. Thick exterior walls of pale cream limestone, visible from above as wide bands defining the building perimeter. Interior walls are dark wood-paneled or plastered. Doorways appear as dark rectangular gaps, most fitted with heavy dark wood doors — many of these doors are closed and locked. The building has two distinct halves: the gracious public rooms on the west (left) and the utilitarian service areas on the east (right), with the upper landing and main corridor forming a central spine.

UPPER LANDING AND GRAND STAIRCASE ARRIVAL (south-center): The grand staircase from the ground floor arrives here — from above, the top of the curved marble staircase is visible as concentric pale cream steps with dark iron-and-brass banister railings, the deep burgundy carpet runner tracing the center. The landing itself is a generous open area of polished dark hardwood floor, wide enough for several people. The banister curves gracefully around the stairwell opening — from directly overhead, the stairwell appears as a dark void with the curved banister railing forming an elegant spiral border. Two oil lamps in polished brass wall brackets flank the landing, casting overlapping pools of warm amber light on the dark wood floor. A narrow console table with a decorative vase sits against the south wall.

MAIN CORRIDOR (running east-west from the landing): A long corridor extends in both directions from the landing, running roughly east-west across the building. The floor is dark hardwood — wide oak planks with visible grain, deeply patinated from decades of use. A rich burgundy carpet runner — deep wine-red with a subtle geometric border pattern in dark gold thread — traces the center of the corridor, secured with brass carpet rods at regular intervals. The carpet thins noticeably as it extends toward the east (right) side, and eventually disappears entirely near the back of the building where the wallpaper changes from silk damask to bare plaster. The corridor walls are covered in silk damask wallpaper in a deep cream-and-gold pattern on the west side, transitioning to plainer plaster toward the east. Oil lamps in brass wall sconces at regular intervals provide warm but subdued amber light — noticeably dimmer than the chandeliers of the ground floor. The corridor has the feel of a grand hotel hallway — orderly, quiet, and slightly oppressive.

GUEST ROOMS (along the north side of the corridor): A row of closed dark wooden doors lines the north wall of the corridor — at least five or six doors, evenly spaced, each identical: heavy dark oak with brass door handles and keyholes. All doors are closed. The doors have no distinguishing features from above — just a uniform row of dark rectangles set into the wall. The rooms behind them are not visible (doors closed), but narrow strips of warm light leak from beneath one or two of them, suggesting occupied rooms. These are guest bedrooms for visiting nobility — private, locked, and not part of the players' path.

LIBRARY (southwest quadrant, left of the landing): A large formal library occupying a generous room on the west side. The floor is dark polished hardwood, partially covered by a deep burgundy-and-navy Persian rug with intricate knotwork visible from above. Floor-to-ceiling dark wood bookshelves line all four walls — from above, these appear as deep bands of dark wood with rows upon rows of book spines visible as tiny vertical rectangles in rich leather colors: burgundy, navy, forest green, tan, with occasional glints of silver and gold leaf stamping. The shelves are packed — no gaps, no empty spaces, books crammed two-deep in places. A heavy reading desk sits near the center of the room — dark oak, its surface cluttered with open books, a brass desk lamp with a green glass shade (casting a small pool of warm green-gold light), loose papers, and a crystal inkwell. A high-backed leather reading chair in dark oxblood red sits at the desk. A rolling library ladder on a brass rail is visible against one wall. The room smells of old paper, leather binding glue, and furniture polish — suggested by the warm, well-maintained surfaces.

LADY THESSALY'S PARLOR (southeast quadrant, right of the landing): A private sitting room with a floor of dark hardwood partially covered by a pale cream-and-rose patterned carpet — lighter and more delicate than the library's heavy rug. The furniture is plush: a curved settee upholstered in dusty rose silk, two wingback chairs in pale grey velvet, a low round side table with a porcelain tea set (white with blue floral pattern, visible from above as tiny pale circles on the dark table). A small writing desk sits against one wall with an open letter and a quill pen. A fireplace in the south wall has low embers glowing — not the roaring hearths of the kitchen, but a gentle amber warmth. Framed watercolor paintings in thin gilt frames hang on the pale plaster walls. A tall arched window in the south wall has sheer cream curtains drawn partially back, with faint silver moonlight filtering through. This room is noticeably lighter and more feminine than the dark, heavy library — a deliberate contrast.

LOCKED STAIRWELL TO THIRD FLOOR (northeast corner, at the back of the corridor): At the far east end of the corridor where the carpet has disappeared and the walls are bare plaster, a heavy oak door stands in an alcove lit by a single guttering tallow candle in a wrought-iron wall bracket. The door is reinforced with visible iron bands — wide horizontal strips of dark hammered iron bolted across the oak with heavy nail heads. A brass lock — newer and shinier than the old door, clearly recently installed — gleams in the flickering candlelight. The alcove is deeply shadowed — the single candle barely pushes back the darkness. Beyond this door (not visible, but suggested by the narrow dark gap if the door were ajar) is a narrow spiral staircase ascending to the third floor. This door says: this is where the private floors begin.

SERVANTS' PASSAGE (running along the east/right edge): A narrow corridor — just five feet wide — of bare stone floor and whitewashed plaster walls, continuing up from the ground floor servants' corridor below. The passage is lit by small tallow candle sconces on iron brackets at irregular intervals — dim, yellowish, guttering light creating uneven pools separated by shadow. A small square hatch in the wall — the dumbwaiter opening from the kitchen below — is visible as a dark rectangular opening with a wooden frame, roughly two feet square, with a frayed rope and simple hand-crank mechanism visible. Several plain wooden doors open off this passage into linen storage and servants' quarters. The floors are bare grey stone — no carpet, no wood, just worn flagstone.

SECOND-FLOOR BALCONY (south wall, exterior): A weathered stone balcony projects from the south exterior wall — from above, it appears as a small rectangular stone platform extending beyond the building's footprint, with dark wrought-iron railings (ornate but aged, with some rust visible). The balcony is twelve feet above the gardens. Through the balcony door (a tall glass-paned French door with dark wood frame), faint warm interior light spills outward. The balcony surface is pale stone, slightly stained with age and weather. A single iron chair sits on the balcony — visible from above as a small dark circle.

LIGHTING AND ATMOSPHERE: The second floor has two distinct lighting zones, both significantly dimmer than the ground floor's brilliant chandeliers:

ZONE 1 — WARM DIM (landing, corridor, library, parlor): Oil lamps in brass wall sconces provide warm amber light along the main corridor and landing — consistent but subdued, with visible shadows in corners and between sconces. The library has its own character — the green-shaded desk lamp casts a concentrated pool of warm light, while the bookshelves absorb light and darken the room's edges. The parlor is the lightest room on this floor — the pale carpet and cream walls reflect the fireplace glow and moonlight from the window.

ZONE 2 — NEAR DARK (servants' passage, stairwell alcove, back corridor): Tallow candles provide minimal, uneven light. The servants' passage is mostly shadow. The stairwell alcove at the far east end is the darkest accessible point — the single guttering candle barely illuminates the iron-banded door. The dumbwaiter shaft is completely black. This is where infiltrators move — the contrast with the warmer main corridor should be visible.

The color palette: deep burgundy carpet, dark polished oak, cream-and-gold silk damask, warm amber oil lamp light, dusty rose silk, pale moonlight, grey stone, whitewashed plaster. The overall mood is quieter and more intimate than the ground floor — the gala is audible but muffled, a distant murmur through the floorboards. Every surface carries the patina of a lived-in aristocratic house — the wood is deeply polished from years of care, the carpet shows subtle wear paths, the wallpaper has faint water stains near the ceiling.

Absolutely no people, no figures, no characters, no text, no labels, no grid lines, no watermarks, no borders visible anywhere in the image.""",
    },
    "M05": {
        "file": "m05-mansion-third.png",
        "width": 2250,
        "height": 1800,
        "model": "nano-banana-2",
        "aspect_ratio": "5:4",
        "prompt": """Photorealistic architectural overhead photograph of the third floor private study level of a grand noble mansion, captured with a large-format camera looking perfectly straight down with the roof removed. The entire floor plan fills the frame in a single, seamless view — every room, corridor, and doorway visible at once. Extreme sharpness, natural lighting, rich tonal depth. No perspective distortion, no vanishing points — a true orthographic overhead view. The quality of light is dramatically different from the floors below — cold, still, and faintly tinged with arcane blue-white, evoking isolation and hidden power. The feeling is Johannes Vermeer meets cosmic dread.

OVERALL STRUCTURE: The floor plan is smaller than the floors below — approximately 50 feet east-west by 40 feet north-south. This floor occupies only the central portion of the mansion's footprint, set back from the exterior walls (the roof of the lower floors would surround it on all sides, but is not visible). Thick exterior walls of pale cream limestone, slightly darker and more weathered than below. Interior walls are bare stone — no wallpaper, no decoration, no pretense of domesticity. The floor plan has a simple layout: a narrow entry hallway at the south leading to a central reinforced door, with the large study dominating the north half, and smaller rooms (gallery and workshop) flanking the hallway on left and right.

ENTRY HALLWAY AND SPIRAL STAIRCASE (south-center, bottom of the map): A narrow staircase arrives from the second floor below — from above, it appears as a tight spiral of worn dark wooden steps descending into a black void, with a simple iron handrail wrapping the outer edge. The hallway extending north from the staircase is narrow — perhaps six feet wide — with dark hardwood floorboards that are old, smooth, and slightly warped. The walls are bare stone, no wallpaper, no paintings. A single arcane wall sconce burns with a pale, steady blue-white flame that does not flicker — distinctly different from every other light source in the mansion. This cold blue light casts sharp-edged shadows down the hallway and gives the stone walls an ethereal, slightly unsettling quality. The floorboards show faint wear patterns from years of a single person walking the same path — Veymar's route from stairs to study, night after night.

THREE DOORS (visible from the hallway): Three doors line the hallway — one on the left (west) wall leading to the private gallery, one on the right (east) wall leading to the arcane workshop, and one at the far end (north) directly ahead — the study door, which is visibly heavier and more reinforced than the others.

REINFORCED STUDY DOOR (center of the map, between hallway and study): A heavy oak door with visible iron banding — wide horizontal strips of dark hammered iron bolted across the oak, with heavy square-headed nail rivets. The door frame is thick dark stone. Faint traces of pale blue-white arcane energy are visible around the edges of the door frame — thin luminous threads like a spider's web made of starlight, the residue of an arcane ward. Above the door frame, barely visible, a small rune stone is set into the stone wall — a smooth dark stone with a faint carved sigil, the anchor point for the ward enchantment. The door has a heavy iron latch and a brass lock. The overall impression is of a door designed to keep things in as much as to keep people out.

VEYMAR'S STUDY (entire north half of the map, the largest room): A large scholarly chamber with dark hardwood floors — wide aged oak planks, darker than the hallway, nearly black with centuries of polish and use. Floor-to-ceiling dark wood bookshelves line all four walls — from above, these appear as deep bands of dark walnut with densely packed rows of leather-bound volumes in rich colors: burgundy, navy, dark green, aged tan, with frequent glints of silver and gold leaf on spines. The shelves are absolutely packed — books stacked horizontally on top of vertical rows, loose papers protruding between volumes, the accumulated library of an obsessive scholar.

A heavy oak desk dominates the center of the study — massive, at least six feet wide, its surface cluttered with scattered star charts (large pale parchment sheets covered in intricate astronomical diagrams and constellation maps), arcane diagrams (geometric patterns drawn in dark ink with occasional annotations), loose quill pens, a crystal inkwell, melted candle stubs in brass holders, and stacked leather journals. From directly overhead, the desk surface is a chaotic mosaic of pale parchment, dark ink, and glinting brass — the workspace of someone who has not tidied in weeks.

On the far north wall, between two tall windows, stands a glass display case on a slender iron pedestal. The windows are draped in deep midnight-blue velvet curtains — heavy, floor-length, drawn mostly closed but with narrow gaps where pale silver moonlight filters through in thin vertical slashes. The display case is simple — clear glass panels in a dark iron frame, roughly eighteen inches square. Inside, on a dark velvet cushion (deep purple or black), sits a small cube — the puzzle box. From above, the box appears as a tiny dark object on the cushion, barely visible, but the moonlight catches its surface and creates a faint iridescent shimmer — as if the geometric patterns on its surface are subtly shifting. The pedestal casts a thin shadow from the moonlight.

A leather armchair sits near the desk — dark brown, cracked and worn, with a folded blanket draped over one arm (Veymar has been sleeping here). A small side table holds a half-empty crystal decanter of amber liquid and a single glass.

PRIVATE GALLERY (west/left room, off the hallway): A narrow room running along the west side. The floor is dark hardwood, slightly lighter than the study. The walls are bare stone, but covered with framed paintings — from above, these appear as dark rectangles with gilt frames (gold-painted wood borders) arranged in two rows along both walls. The paintings depict (not specifically visible from above, but suggested by their dark tones) historical scenes and portraits. A narrow wooden bench runs along the center of the room for viewing. A single oil lamp in a brass wall bracket provides dim warm amber light — the only warm-toned light on this floor, contrasting with the blue arcane sconce in the hallway. The gallery has the feel of a private museum — quiet, contemplative, slightly dusty.

ARCANE WORKSHOP (east/right room, off the hallway): A utilitarian workspace with a floor of bare grey stone flagstones — rougher and colder than the hardwood elsewhere on this floor. A heavy stone workbench runs along the east wall — its surface covered with glass vials and beakers (visible from above as small transparent circles and cylinders catching the light), scattered scrolls (pale curled parchment), small brass instruments (calipers, scales, an astrolabe), dried herb bundles, and a mortar and pestle. Shelving above the workbench holds rows of labeled glass jars (tiny dark containers with cork stoppers). A smaller wooden writing desk in the corner holds more papers and a brass microscope. The room is lit by two candles in iron holders on the workbench — their warm flame light mixes with the cold blue spillover from the hallway sconce, creating an unsettling dual-toned illumination. A faint circle of chalk marks on the stone floor near the center of the room suggests experimental ritual work — partially scuffed and faded.

LIGHTING AND ATMOSPHERE: The third floor has a profoundly different atmosphere from the floors below. The gala is completely inaudible — the silence is absolute and deliberate.

ZONE 1 — COLD ARCANE (hallway and study entrance): The blue-white arcane sconce casts steady, shadowless light that feels wrong — too still, too even, too cold. The arcane ward traces on the study door frame add additional pale blue luminosity. This light makes the bare stone walls look almost clinical. There is no warmth here.

ZONE 2 — MOONLIT STUDY (the study itself): The study is primarily lit by silver moonlight filtering through gaps in the deep blue curtains — thin vertical slashes of pale light that fall across the desk, the floor, the bookshelves, creating dramatic silver-on-dark contrast. A few melted candle stubs on the desk provide tiny pools of warm amber that barely compete with the moonlight. The display case catches the moonlight and refracts it slightly — the puzzle box has a faint iridescent quality. The overall tone is silver-blue with warm amber accents.

ZONE 3 — DIM WARM (gallery and workshop): The gallery and workshop have their own warmer but very dim lighting — the gallery's single oil lamp and the workshop's two candles provide small isolated pools of amber warmth within rooms that are otherwise deeply shadowed. These rooms feel like afterthoughts — functional spaces that Veymar barely visits anymore, his obsession focused entirely on the study.

The color palette: cold blue-white arcane light, midnight blue velvet, silver moonlight, dark aged oak, leather brown, deep burgundy accents, pale parchment, iron grey, bare stone cream. Every surface carries the marks of obsessive solitary use — the desk is cluttered, the chair is worn, the candles are burned to stubs. The mood is isolation, obsession, and quiet menace — this room has been the center of Veymar's world for three months, and whatever the puzzle box has done to him, the room remembers it.

Absolutely no people, no figures, no characters, no text, no labels, no grid lines, no watermarks, no borders visible anywhere in the image.""",
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
