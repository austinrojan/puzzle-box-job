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
  const sources = [
    ...SCENES.map(s => s.art),
    ...MAPS.map(m => m.image),
    ...Object.values(TOKENS).map(t => t.image)
  ];

  const total = sources.length;
  let completed = 0;
  const failedSources = [];

  await Promise.all(
    sources.map(src =>
      preloadImage(src).then(result => {
        completed++;
        if (!result.ok) failedSources.push(result.src);
        if (onProgress) onProgress({ completed, total, failed: failedSources.length, src: result.src });
      })
    )
  );

  const failed = failedSources.length;
  const loaded = total - failed;
  console.log(`[VTT] Images preloaded: ${loaded}/${total} (${failed} missing — placeholders will be used)`);

  return { total, loaded, failed, failedSources };
}
