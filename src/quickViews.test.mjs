import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLOBE_VIEW, STREET_VIEW } from './locations.js';
import { viewScaleForAltitude } from './data/detectionPolicy.js';
import {
  applyNaturalGlobeControls,
  cameraZoomMovementM,
  naturalGlobeControlPatch,
  QUICK_VIEW_IDS,
  styleIdForQuickView,
} from './quickViews.js';

test('street and globe quick views reuse real altitude bands', () => {
  assert.equal(viewScaleForAltitude(STREET_VIEW.heightM), 'street');
  assert.equal(viewScaleForAltitude(GLOBE_VIEW.heightM), 'global');
  assert.equal(STREET_VIEW.pitchDeg, -32);
  assert.equal(GLOBE_VIEW.pitchDeg, -90);
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

test('quick-view style chips map onto existing visual presets', () => {
  assert.deepEqual([...QUICK_VIEW_IDS], ['global', 'street', 'cockpit', 'crt', 'nvg', 'flir', 'follow']);
  assert.equal(styleIdForQuickView('crt'), 'retro');
  assert.equal(styleIdForQuickView('nvg'), 'surveillance');
  assert.equal(styleIdForQuickView('flir'), 'thermal');
  assert.equal(styleIdForQuickView('global'), null);
});

test('chrome places quick views on top and feature menus on the bottom bar', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(html, /id="top-center-actions"[^>]*aria-label="Quick views"/);
  assert.match(html, /id="quick-view-street"/);
  assert.match(html, /id="map-zoom-out"/);
  assert.match(html, /id="map-zoom-in"/);
  assert.match(html, /id="command-dock"[\s\S]*?id="clear-selected-layers"/);
  assert.match(html, /id="command-dock"[\s\S]*?id="share-btn"/);
  assert.match(
    css,
    /body:not\(\.cockpit-mode\) #left-panel-stack\s*\{[\s\S]*?bottom:\s*var\(--chrome-bottom-features\)/,
  );
  assert.match(
    css,
    /body:not\(\.cockpit-mode\) #right-context-rail\s*\{[\s\S]*?bottom:\s*var\(--chrome-bottom-features\)/,
  );
  assert.match(css, /White glass chrome/);
  assert.match(css, /border: 1\.5px solid #ffffff/);
});
