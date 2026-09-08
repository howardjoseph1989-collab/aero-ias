import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const PRODUCT = 'AERO IAS';
const FORBIDDEN_PRODUCT = /Aero IAS|AERO-IAS|God's Eye View|Gods Eye View|GOD'S EYE VIEW|WorldView|FALLOUT WORLD VIEW/;

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const pinokio = readFileSync(new URL('../pinokio/pinokio.js', import.meta.url), 'utf8');
const logo = readFileSync(new URL('../public/logo.svg', import.meta.url), 'utf8');

test('user-facing product titles are exactly AERO IAS (all caps, space, no hyphen)', () => {
  assert.match(html, /<title>AERO IAS<\/title>/);
  assert.match(
    html,
    /<h1>[\s\S]*?<span>AERO <span class="title-accent">IAS<\/span><\/span><\/h1>/,
  );
  assert.match(
    html,
    /<h2>AERO <span class="title-accent">IAS<\/span><\/h2>/,
  );
  assert.doesNotMatch(html, FORBIDDEN_PRODUCT);

  assert.match(readme, /^# 🌐 AERO IAS$/m);
  assert.match(pkg.description, /^AERO IAS /);
  assert.equal(pkg.name, 'aero-ias');
  assert.match(pinokio, /title: "AERO IAS"/);
  assert.match(pinokio, /text: 'Open AERO IAS'/);
  assert.match(pinokio, /description: 'AERO IAS —/);
  assert.match(logo, /<title id="logo-title">AERO IAS<\/title>/);

  for (const [label, text] of [
    ['index.html', html],
    ['package.json description', pkg.description],
    ['pinokio.js', pinokio],
    ['logo.svg', logo],
  ]) {
    assert.doesNotMatch(text, /Aero IAS|AERO-IAS/, `${label} must not use Aero IAS or AERO-IAS`);
    assert.ok(text.includes(PRODUCT), `${label} must include ${PRODUCT}`);
  }
});
