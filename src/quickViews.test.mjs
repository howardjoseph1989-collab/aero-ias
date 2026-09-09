import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIRDS_EYE_VIEW, GLOBE_VIEW, STREET_VIEW } from './locations.js';
import { viewScaleForAltitude } from './data/detectionPolicy.js';
import {
  applyNaturalGlobeControls,
  cameraZoomMovementM,
  clampNavHudPosition,
  defaultNavHudPosition,
  naturalGlobeControlPatch,
  parseNavHudPosition,
  QUICK_VIEW_IDS,
} from './quickViews.js';

test('street, birds-eye, and globe quick views reuse real altitude bands', () => {
  assert.equal(viewScaleForAltitude(STREET_VIEW.heightM), 'street');
  assert.equal(viewScaleForAltitude(BIRDS_EYE_VIEW.heightM), 'regional');
  assert.equal(viewScaleForAltitude(GLOBE_VIEW.heightM), 'global');
  assert.equal(STREET_VIEW.pitchDeg, -32);
  assert.equal(BIRDS_EYE_VIEW.pitchDeg, -72);
  assert.equal(GLOBE_VIEW.pitchDeg, -90);
  assert.ok(STREET_VIEW.heightM < BIRDS_EYE_VIEW.heightM);
  assert.ok(BIRDS_EYE_VIEW.heightM < GLOBE_VIEW.heightM);
});

test('zoom steps grow with altitude and never collapse to zero', () => {
  assert.equal(cameraZoomMovementM({ direction: 'in', heightM: 1000, amount: 'medium' }), 550);
  assert.equal(cameraZoomMovementM({ direction: 'out', heightM: 40, amount: 'little' }), 50);
  assert.ok(cameraZoomMovementM({ direction: 'in', heightM: 18000000 }) > 1_000_000);
});

test('natural globe controls keep wheel zoom and drag spin enabled', () => {
  const patch = naturalGlobeControlPatch();
  assert.equal(patch.enableZoom, true);
  assert.equal(patch.enableRotate, true);
  assert.ok(patch.inertiaSpin > 0.5);
  assert.ok(patch.minimumZoomDistance <= STREET_VIEW.heightM);
  const controller = { enableZoom: false, inertiaSpin: 0 };
  applyNaturalGlobeControls(controller);
  assert.equal(controller.enableZoom, true);
  assert.equal(controller.inertiaSpin, patch.inertiaSpin);
});

test('exactly three camera quick views sit on the bottom bar', () => {
  assert.deepEqual([...QUICK_VIEW_IDS], ['global', 'birds-eye', 'street']);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const chrome = html.match(/id="map-chrome"[\s\S]*?id="command-dock"[\s\S]*?id="map-nav-hud"/);
  assert.ok(chrome, 'one bottom toolbar overlay is missing');
  assert.match(html, /id="command-dock"[\s\S]*?id="left-panel-stack"/);
  assert.match(html, /id="command-dock"[\s\S]*?id="top-center-actions"[^>]*aria-label="Quick views"/);
  assert.match(html, /id="reset-globe-view"/);
  assert.match(html, /id="quick-view-birds-eye"/);
  assert.match(html, /id="quick-view-street"/);
  assert.equal((html.match(/data-quick-view="/g) || []).length, 3);
  assert.doesNotMatch(html, /id="quick-view-cockpit"|id="quick-view-crt"|id="quick-view-follow"/);
  assert.match(html, /id="map-nav-hud"/);
  assert.match(html, /id="map-nav-hud"[\s\S]*?id="map-zoom-out"/);
  assert.match(html, /id="map-nav-hud"[\s\S]*?id="map-zoom-in"/);
  assert.match(html, /id="map-nav-hud"[\s\S]*?id="map-nav-spin"/);
  assert.match(html, /id="map-nav-hud"[\s\S]*?id="map-nav-north"/);
  assert.match(html, /id="command-dock"[\s\S]*?id="map-zoom-controls"/);
  assert.match(css, /#map-chrome\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(css, /\.chrome-module\.is-floating\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(css, /#map-nav-hud\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(css, /White glass chrome/);
  assert.match(css, /border: 2px solid #ffffff/);
});

test('nav HUD positions stay clamped to the viewport', () => {
  assert.deepEqual(
    clampNavHudPosition({ left: -40, top: -10, hudWidth: 80, hudHeight: 200, viewWidth: 400, viewHeight: 300 }),
    { left: 8, top: 8 },
  );
  assert.deepEqual(
    clampNavHudPosition({ left: 900, top: 800, hudWidth: 80, hudHeight: 200, viewWidth: 400, viewHeight: 300 }),
    { left: 312, top: 92 },
  );
  assert.equal(parseNavHudPosition({ left: 12, top: 40 })?.left, 12);
  assert.equal(parseNavHudPosition({ left: 'nope', top: 1 }), null);
  const fallback = defaultNavHudPosition({ viewWidth: 1280, viewHeight: 720, hudWidth: 88, hudHeight: 260 });
  assert.ok(fallback.left > 1000);
  assert.ok(fallback.top > 70);
});
