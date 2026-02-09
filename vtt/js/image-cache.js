// VTT Image Cache — Preloads all images at startup

import { SCENES, MAPS, TOKENS } from './data.js';

function preloadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ src, ok: true });
    img.onerror = () => resolve({ src, ok: false });
    img.src = src;
  });
}

export async function preloadAll(onProgress) {
  const sources = [];

  for (const scene of SCENES) sources.push(scene.art);
  for (const map of MAPS) sources.push(map.image);
  for (const token of Object.values(TOKENS)) sources.push(token.image);

  const total = sources.length;
  let completed = 0;
  let failed = 0;
  const failedSources = [];

  await Promise.all(
    sources.map(src =>
      preloadImage(src).then(result => {
        completed++;
        if (!result.ok) { failed++; failedSources.push(result.src); }
        if (onProgress) onProgress({ completed, total, failed, src: result.src });
      })
    )
  );

  const loaded = total - failed;
  console.log(`[VTT] Images preloaded: ${loaded}/${total} (${failed} missing — placeholders will be used)`);

  return { total, loaded, failed, failedSources };
}
