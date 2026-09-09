/**
 * Quick-view chrome and globe navigation helpers for AERO IAS.
 *
 * Camera destinations reuse the existing globe / street framing constants.
 * These helpers stay Cesium-free so unit tests can pin the control feel and
 * zoom step without a WebGL viewer.
 */

export const ZOOM_STEP_FRACTIONS = Object.freeze({
  little: 0.25,
  medium: 0.55,
  lot: 1.0,
});

export function cameraZoomMovementM({
  direction = 'in',
  heightM = 1000,
  amount = 'medium',
} = {}) {
  const fraction = ZOOM_STEP_FRACTIONS[String(amount || 'medium').toLowerCase()]
    ?? ZOOM_STEP_FRACTIONS.medium;
  const targetDistanceM = Math.max(100, Number(heightM) || 100);
  const minimumDistanceM = direction === 'out' ? 50 : 20;
  return Math.max(minimumDistanceM, targetDistanceM * fraction);
}

export function naturalGlobeControlPatch() {
  return {
    enableZoom: true,
    enableRotate: true,
    enableTilt: true,
    enableTranslate: true,
    inertiaSpin: 0.88,
    inertiaTranslate: 0.88,
    inertiaZoom: 0.72,
    minimumZoomDistance: 20,
    maximumZoomDistance: 40000000,
  };
}

export function applyNaturalGlobeControls(controller, patch = naturalGlobeControlPatch()) {
  if (!controller) return null;
  for (const [key, value] of Object.entries(patch)) {
    controller[key] = value;
  }
  return controller;
}

export const QUICK_VIEW_IDS = Object.freeze([
  'global',
  'street',
  'cockpit',
  'crt',
  'nvg',
  'flir',
  'follow',
]);

export function styleIdForQuickView(id) {
  if (id === 'crt') return 'retro';
  if (id === 'nvg') return 'surveillance';
  if (id === 'flir') return 'thermal';
  return null;
}
