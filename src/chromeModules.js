/**
 * Viewport-fixed, draggable chrome modules for the AERO IAS bottom toolbar.
 *
 * Modules start docked in `#command-dock`. Dragging one out floats it with
 * `position: fixed` (screen space — never Cesium world-anchored). Positions
 * are clamped so a module cannot leave the viewport.
 */

import { clampNavHudPosition } from './quickViews.js';

export const CHROME_MODULE_STORAGE_KEY = 'godsEyeView.chromeModules.v1';

export const CHROME_MODULE_IDS = Object.freeze([
  'search',
  'views',
  'layers',
  'context',
  'source',
  'actions',
  'places',
  'presets',
  'nav',
  'mic',
]);

export function clampChromeModulePosition(input = {}) {
  return clampNavHudPosition({
    margin: 8,
    ...input,
  });
}

export function parseChromeModulePosition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const left = Number(raw.left);
  const top = Number(raw.top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left, top };
}

export function parseChromeModuleLayout(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const layout = {};
  for (const id of CHROME_MODULE_IDS) {
    const next = parseChromeModulePosition(raw[id]);
    if (next) layout[id] = next;
  }
  return layout;
}

export function readChromeModuleLayout(storage) {
  try {
    const source = storage ?? globalThis.localStorage;
    const raw = source?.getItem?.(CHROME_MODULE_STORAGE_KEY);
    if (!raw) return {};
    return parseChromeModuleLayout(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeChromeModuleLayout(layout, storage) {
  try {
    const source = storage ?? globalThis.localStorage;
    source?.setItem?.(CHROME_MODULE_STORAGE_KEY, JSON.stringify(layout || {}));
    return true;
  } catch {
    return false;
  }
}

/**
 * Docked modules live in the bottom toolbar. A stored left/top pair means the
 * module is floating in screen space.
 */
export function isChromeModuleFloating(position) {
  return Boolean(parseChromeModulePosition(position));
}
