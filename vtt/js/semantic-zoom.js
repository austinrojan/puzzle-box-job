// vtt/js/semantic-zoom.js
// Progressive detail visibility based on camera zoom level.
// Uses hysteresis (different show/hide thresholds) to prevent flickering.

import { EventBus } from './state.js';

const ZOOM_THRESHOLDS = [
  { cssClass: 'sz-grid-labels',    showAt: 1.8, hideAt: 1.5 },
  { cssClass: 'sz-token-names',    showAt: 1.2, hideAt: 1.0 },
  { cssClass: 'sz-condition-icons', showAt: 1.4, hideAt: 1.1 },
  { cssClass: 'sz-hp-bars',        showAt: 1.6, hideAt: 1.3 },
  { cssClass: 'sz-token-detail',   showAt: 2.0, hideAt: 1.7 },
];

export class SemanticZoomController {
  constructor(container, camera, thresholds) {
    this._container = container;
    this._camera = camera;
    this._thresholds = thresholds ?? ZOOM_THRESHOLDS;
    this._activeClasses = new Set();

    this._onCameraChanged = () => {
      const coverZoom = this._camera._coverZoom;
      if (coverZoom <= 0) return;

      const zoomRatio = this._camera.zoom / coverZoom;

      for (const threshold of this._thresholds) {
        const isActive = this._activeClasses.has(threshold.cssClass);

        if (!isActive && zoomRatio >= threshold.showAt) {
          this._container.classList.add(threshold.cssClass);
          this._activeClasses.add(threshold.cssClass);
        } else if (isActive && zoomRatio < threshold.hideAt) {
          this._container.classList.remove(threshold.cssClass);
          this._activeClasses.delete(threshold.cssClass);
        }
      }
    };

    EventBus.on('camera:changed', this._onCameraChanged);
  }

  reset() {
    for (const cls of this._activeClasses) {
      this._container.classList.remove(cls);
    }
    this._activeClasses.clear();
  }

  destroy() {
    EventBus.off('camera:changed', this._onCameraChanged);
    this.reset();
  }
}

export { ZOOM_THRESHOLDS };
