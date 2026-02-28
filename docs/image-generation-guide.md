# Image Generation Guide — Battle Maps

Lessons learned from generating VTT battle maps for the Puzzle-Box Job campaign. This document captures model preferences, prompt engineering patterns, and the workflow that produces the best results.

---

## Preferred Model: Nano Banana 2

**Endpoint:** `fal-ai/nano-banana-2`
**Cost:** $0.08/image at 1K, $0.12 at 2K, $0.16 at 4K

### Why Nano Banana 2 Wins

Nano Banana 2 (Google's Gemini 3.1 Flash Image) uses **reasoning-guided generation** — it reasons about composition, lighting, and spatial relationships before rendering. This is critical for maps because:

- **Proportions are accurate.** When the prompt says "the mansion occupies one-seventh of the total image area," Nano Banana 2 actually respects that. FLUX models tend to let dominant features consume the frame.
- **Spatial layout follows instructions.** "Upper center," "left third," "far right" — it places features where you ask. FLUX and Seedream interpret spatial directions loosely.
- **Long prompts work better, not worse.** Because the model reasons about the prompt as language (not weighted tokens), hyper-detailed 1500-word prompts produce better results than short ones. With FLUX, long prompts often get partially ignored.
- **Native high resolution.** At 4K with 4:3 aspect ratio, it outputs 4800x3584 natively. No upscaling needed.

### Settings

```python
fal_client.subscribe(
    "fal-ai/nano-banana-2",
    arguments={
        "prompt": PROMPT,
        "resolution": "4K",
        "aspect_ratio": "4:3",
        "num_images": 1,
        "output_format": "png",
        "safety_tolerance": "6",
    },
)
```

- **Resolution:** Always `"4K"` for battle maps. The extra detail is worth the 2x cost.
- **Aspect ratio:** `"4:3"` matches the 60x45 grid (4:3 ratio). Output is 4800x3584.
- **Output format:** `"png"` — lossless, required for VTT canvas rendering.
- **Safety tolerance:** `"6"` — maximum permissiveness. Fantasy combat maps with weapons, blood, fire, etc. need this to avoid false positives.

### Output Handling

Nano Banana 2 outputs at 4800x3584 for 4K/4:3. The VTT target is 3600x2700 (or whatever matches `artWidth = max(1920, cols * cellPx)`). Resize with LANCZOS:

```python
if img.size != (target_w, target_h):
    img = img.resize((target_w, target_h), Image.LANCZOS)
```

Downscaling from 4800 to 3600 (0.75x) actually sharpens the result — anti-aliasing small details. This is the opposite of the FLUX problem where 2048 was upscaled to 3600 (1.75x), which blurred everything.

---

## Models Compared (and Why They Lost)

### FLUX.2 Pro / FLUX.2 Max

**Endpoints:** `fal-ai/flux-2-pro`, `fal-ai/flux-2-max`

- Generates at **2048x2048 regardless of requested size.** Requesting 3600x2700 still produces 2048x2048, requiring 1.75x upscaling that blurs the image.
- Good prompt adherence for simple scenes, but spatial layout becomes unreliable with complex multi-feature compositions.
- Aesthetic quality tends toward "digital art illustration" — clean, slightly cartoonish.
- FLUX.2 Max costs $0.34/image for the same 2048x2048 output — worst value.
- FLUX.1 Pro Fill (inpainting endpoint `fal-ai/flux-pro/v1/fill`) is useful for targeted fixes but creates "Frankenstein" composites with inconsistent style between regions.

### Seedream v4.5

**Endpoint:** `fal-ai/bytedance/seedream/v4.5/text-to-image`

- Actually generates at requested resolution (3600x2704 for 3600x2700 request).
- Very cheap at $0.04/image.
- But: aesthetic quality is flat and generic. Lacks the depth and lighting realism needed for atmospheric night scenes.
- Spatial layout accuracy is poor — features merge or get placed incorrectly.

### Summary Table

| Model | Native Size (4:3) | Cost | Spatial Accuracy | Aesthetic Quality | Long Prompt Handling |
|-------|-------------------|------|-----------------|-------------------|---------------------|
| **Nano Banana 2** | 4800x3584 | $0.16 | Excellent | Realistic, painterly | Best — reasoning-guided |
| FLUX.2 Pro | 2048x2048 | $0.17 | Moderate | Clean/illustrative | Partial ignore |
| FLUX.2 Max | 2048x2048 | $0.34 | Moderate | Clean/illustrative | Partial ignore |
| Seedream v4.5 | 3600x2704 | $0.04 | Poor | Flat/generic | Moderate |

---

## Prompt Engineering: The Hyper-Detail Principle

### The Rule

**Every narrative detail that exists in the adventure text must be explicitly described in the prompt.** If a feature isn't in the prompt, it won't be in the image. Nano Banana 2 will faithfully render what you describe — but it won't invent features you forgot to mention.

### Why Hyper-Detail Works

Traditional diffusion models (FLUX, Stable Diffusion) treat prompts as weighted token bags. Long prompts dilute attention — adding more words can make the output worse. This trained a habit of writing short, punchy prompts.

Nano Banana 2 is a multimodal language model. It reads the prompt as a document, reasons about it, then generates. More detail = more information to reason about = better output. A 1500-word prompt with specific materials, measurements, lighting physics, and botanical names produces dramatically better results than a 200-word summary.

### Prompt Structure

Organize the prompt into labeled sections with spatial anchoring:

```
[OVERALL FRAMING — camera angle, quality, mood]

[ESTATE PERIMETER — fence description]

[MANSION — upper center, specific fraction of image area]

[CARRIAGE DRIVE — center, below mansion]

[MAIN GATES — bottom center]

[SERVANTS' ENTRANCE — east side]

[PERFORMER'S ENTRANCE — southeast]

[WEST WALL AND OPEN LAWN — left third]

[FORMAL GARDENS — right third]

[CONSERVATORY — far right]

[HEDGE MAZE — adjacent to conservatory]

[GUARD HOUSE — inside gate]

[LIGHTING AND ATMOSPHERE — three zones]

[NO-GO constraints — no people, no text, etc.]
```

### Detail Categories to Include

For every feature, describe:

1. **Material** — "rough-cut ashlar limestone blocks," not just "stone wall"
2. **Weathering** — "lichen patches, hairline cracks, mineral staining from rain runoff"
3. **Botanical specifics** — "English ivy (Hedera helix)," "English box (Buxus sempervirens)"
4. **Measurements** — "twelve feet high," "six feet in diameter," "fifteen feet in diameter light pool"
5. **Lighting interaction** — "wet cobblestones within each light pool show reflections of the flame above"
6. **Spatial relationships** — "the hedge maze sprawls outward from the conservatory's entrance, connecting the two features"
7. **Narrative function** — don't just describe what it looks like; describe what makes it distinct as a gameplay feature. The servants' entrance is "deliberately unlit," the west wall has a "lower section near the back gardens where ivy is thickest"

### Aesthetic Direction

To avoid cartoonish output, frame the image as:
- **"Photorealistic high-altitude aerial photograph"** — not "illustration" or "digital art"
- Reference real painters: **Atkinson Grimshaw** (Victorian nocturnes), **John Singer Sargent** (atmospheric realism)
- Describe light physics: "realistic falloff — bright center fading through warm orange to deep shadow at edges"
- Emphasize age: "every surface carries the weight of age and weather — nothing is pristine or new"

### Anti-Patterns to Avoid

- **"Dark fantasy painterly digital art"** — produces cartoonish, oversaturated results
- **"Map illustration"** — triggers flat 2D board-game aesthetics
- **"Tabletop RPG battle map"** — useful for spatial layout but hurts realism when used alone
- **Short prompts** — with Nano Banana 2, brevity actively hurts quality
- **Inpainting composites** — crop-inpaint-paste creates style inconsistency between regions. Get it right in one shot.

---

## Workflow

### 1. Extract Narrative Details

Before writing a prompt, read every act that references the map location. Extract:
- Physical features and structures
- All entry points / approaches
- Guard positions and patrol routes
- Specific distances and spatial relationships
- Lighting details (lit vs dark areas)
- Atmospheric details (weather, season, time of day)
- Named materials, plants, architectural elements

### 2. Write the Hyper-Detailed Prompt

Structure it with labeled sections. Include every extracted detail. Aim for 1000-1500 words. Don't summarize — be specific.

### 3. Generate with Nano Banana 2 at 4K

Use `compare_models.py` or `generate_single.py`. One generation takes ~30 seconds and costs $0.16.

### 4. Evaluate Against Narrative Checklist

For each entry point / landmark, verify:
- Is it present in the image?
- Is it in the correct spatial position?
- Is it visually identifiable / distinct from surrounding features?
- Does the lighting match the narrative (lit vs dark)?

### 5. Iterate on the Prompt

If features are missing or misplaced, adjust the prompt — add more spatial specificity, increase the emphasis on missing features, or adjust the relative size descriptions. Regenerate. Do not inpaint — regenerate from scratch to maintain stylistic consistency.

### 6. Resize and Deploy

Resize from 4800x3584 to the target resolution (e.g., 3600x2700) using LANCZOS downsampling. Save as PNG. Verify in VTT with grid overlay.

---

## Key Files

- `tools/map-builder/generate_single.py` — production map generation script (FLUX.2 Pro, needs updating for Nano Banana 2)
- `tools/map-builder/compare_models.py` — multi-model comparison script
- `tools/map-builder/inpaint_m02.py` — FLUX.1 Pro Fill inpainting tool (deprecated in favor of full regeneration)
- `campaigns/puzzle-box/vtt-data.js` — map grid definitions and token presets
- `campaigns/puzzle-box/assets/maps/` — output map images

## Cost Reference

| Resolution | Nano Banana 2 | FLUX.2 Pro | Seedream v4.5 |
|-----------|--------------|-----------|--------------|
| 1K | $0.08 | ~$0.06 | $0.04 |
| 2K | $0.12 | ~$0.09 | $0.04 |
| 4K | $0.16 | ~$0.17 | $0.04 |

Budget ~$0.80-$1.60 per map (5-10 iterations to get a great result).
