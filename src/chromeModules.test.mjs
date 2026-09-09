import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHROME_MODULE_IDS,
  CHROME_MODULE_STORAGE_KEY,
  clampChromeModulePosition,
  isChromeModuleFloating,
  parseChromeModuleLayout,
  parseChromeModulePosition,
  readChromeModuleLayout,
  writeChromeModuleLayout,
} from './chromeModules.js';

test('toolbar modules cover search, layers, views, nav, and mic', () => {
  assert.deepEqual([...CHROME_MODULE_IDS], [
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
});

test('floated modules clamp inside the viewport', () => {
  assert.deepEqual(
    clampChromeModulePosition({
      left: -40,
      top: -10,
      hudWidth: 80,
      hudHeight: 200,
      viewWidth: 400,
      viewHeight: 300,
    }),
    { left: 8, top: 8 },
  );
  assert.deepEqual(
    clampChromeModulePosition({
      left: 900,
      top: 800,
      hudWidth: 80,
      hudHeight: 200,
      viewWidth: 400,
      viewHeight: 300,
    }),
    { left: 312, top: 92 },
  );
});

test('stored chrome layout only keeps known modules with finite positions', () => {
  assert.equal(parseChromeModulePosition({ left: 12, top: 40 })?.left, 12);
  assert.equal(parseChromeModulePosition({ left: 'nope', top: 1 }), null);
  assert.equal(isChromeModuleFloating(null), false);
  assert.equal(isChromeModuleFloating({ left: 16, top: 24 }), true);
  const layout = parseChromeModuleLayout({
    search: { left: 20, top: 40 },
    mystery: { left: 1, top: 2 },
    nav: { left: 'nope', top: 3 },
  });
  assert.deepEqual(layout, { search: { left: 20, top: 40 } });
});

test('chrome module layout round-trips through storage', () => {
  const storage = new Map();
  const fake = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, value); },
  };
  assert.deepEqual(readChromeModuleLayout(fake), {});
  assert.equal(writeChromeModuleLayout({ search: { left: 24, top: 48 } }, fake), true);
  assert.equal(storage.get(CHROME_MODULE_STORAGE_KEY), '{"search":{"left":24,"top":48}}');
  assert.deepEqual(readChromeModuleLayout(fake), { search: { left: 24, top: 48 } });
});

test('the shipped toolbar keeps Search and My Location in one bottom dock', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const voice = readFileSync(new URL('./voice/gevRealtime.js', import.meta.url), 'utf8');
  const dock = html.match(/id="command-dock"[\s\S]*?<\/div>\s*<\/div>\s*<div id="scene-runtime"/);
  assert.ok(dock, 'command dock must wrap every map chrome group');
  for (const id of CHROME_MODULE_IDS.filter((moduleId) => moduleId !== 'mic')) {
    assert.match(dock[0], new RegExp(`data-chrome-module="${id}"`));
  }
  assert.match(dock[0], /data-chrome-module="search"[\s\S]*?id="location-search"/);
  assert.match(dock[0], /data-chrome-module="search"[\s\S]*?id="my-location-btn"/);
  assert.match(dock[0], /id="my-location-btn"[\s\S]*?MY LOCATION/);
  assert.match(css, /#map-chrome\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;/);
  assert.match(css, /\.chrome-module\.is-floating\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(ui, /host\.appendChild\(module\)/);
  assert.match(ui, /flyToLatLon\(this\.viewer, latitude, longitude\)/);
  assert.match(voice, /dataset\.chromeModule = 'mic'/);
  assert.match(voice, /commandDock\.appendChild\(root\)/);
});
