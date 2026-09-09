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
  'birds-eye',
  'street',
]);

export const MAP_NAV_HUD_STORAGE_KEY = 'godsEyeView.mapNavHud.position';

export function clampNavHudPosition({
  left = 0,
  top = 0,
  hudWidth = 88,
  hudHeight = 260,
  viewWidth = 1280,
  viewHeight = 720,
  margin = 8,
} = {}) {
  const safeMargin = Math.max(0, Number(margin) || 0);
  const width = Math.max(1, Number(viewWidth) || 1);
  const height = Math.max(1, Number(viewHeight) || 1);
  const boxWidth = Math.max(1, Number(hudWidth) || 1);
  const boxHeight = Math.max(1, Number(hudHeight) || 1);
  const maxLeft = Math.max(safeMargin, width - boxWidth - safeMargin);
  const maxTop = Math.max(safeMargin, height - boxHeight - safeMargin);
  return {
    left: Math.min(maxLeft, Math.max(safeMargin, Number(left) || 0)),
    top: Math.min(maxTop, Math.max(safeMargin, Number(top) || 0)),
  };
}

export function parseNavHudPosition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const left = Number(raw.left);
  const top = Number(raw.top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left, top };
}

export function defaultNavHudPosition({
  viewWidth = 1280,
  viewHeight = 720,
  hudWidth = 88,
  hudHeight = 260,
} = {}) {
  return clampNavHudPosition({
    left: (Number(viewWidth) || 1280) - (Number(hudWidth) || 88) - 18,
    top: Math.max(72, (Number(viewHeight) || 720) * 0.28),
    hudWidth,
    hudHeight,
    viewWidth,
    viewHeight,
  });
}
