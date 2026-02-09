// ============================================
// VTT Image Cache — Preloads all images at startup
// ============================================

import { SCENES, MAPS, TOKENS } from './data.js';

// Preload a single image, resolves even on error (graceful degradation)
function preloadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ src, ok: true });
    img.onerror = () => resolve({ src, ok: false });
    img.src = src;
  });
}

// Preload all images with progress callback
export async function preloadAll(onProgress) {
  const sources = [];

  // Collect all image paths
  for (const scene of SCENES) sources.push(scene.art);
  for (const map of MAPS) sources.push(map.image);
  for (const token of Object.values(TOKENS)) sources.push(token.image);

  const total = sources.length;
  let loaded = 0;
  let failed = 0;
  const failedSources = [];

  const results = await Promise.all(
    sources.map(src =>
      preloadImage(src).then(result => {
        loaded++;
        if (!result.ok) { failed++; failedSources.push(result.src); }
        if (onProgress) onProgress({ loaded, total, failed, src: result.src });
        return result;
      })
    )
  );

  const okCount = results.filter(r => r.ok).length;
  console.log(`[VTT] Images preloaded: ${okCount}/${total} (${failed} missing — placeholders will be used)`);

  return { total, loaded: okCount, failed, failedSources };
}
