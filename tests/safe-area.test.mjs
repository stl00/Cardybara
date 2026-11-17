// #377: the installed web app asks for edge-to-edge only when it is standalone, once, and never breaks without a document.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {coverSafeArea} from '../src/safeArea.js';

const page = (content = 'width=device-width,initial-scale=1') => {
  const meta = {content, getAttribute: () => meta.content, setAttribute: (_, v) => { meta.content = v; }};
  return {meta, doc: {querySelector: q => q === 'meta[name="viewport"]' ? meta : null}};
};
const win = (standalone, ios = false) => ({matchMedia: q => ({matches: standalone && q === '(display-mode: standalone)'}), navigator: {standalone: ios}});

test('a standalone page asks for viewport-fit=cover, once', () => {
  const {meta, doc} = page();
  assert.equal(coverSafeArea(doc, win(true)), true);
  assert.equal(meta.content, 'width=device-width,initial-scale=1,viewport-fit=cover');
  assert.equal(coverSafeArea(doc, win(true)), false);
  assert.equal(meta.content.match(/viewport-fit/g).length, 1);
});

test('the iOS Home Screen flag counts as standalone', () => {
  const {meta, doc} = page();
  assert.equal(coverSafeArea(doc, win(false, true)), true);
  assert.match(meta.content, /viewport-fit=cover/);
});

test('a browser tab, a page that already chose, and a missing document are left alone', () => {
  const tab = page();
  assert.equal(coverSafeArea(tab.doc, win(false)), false);
  assert.equal(tab.meta.content, 'width=device-width,initial-scale=1');
  const chose = page('width=device-width,viewport-fit=contain');
  assert.equal(coverSafeArea(chose.doc, win(true)), false);
  assert.equal(coverSafeArea(undefined, undefined), false);
});

test('the stylesheet pads every edge element by the safe-area insets in standalone mode', () => {
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('@media(display-mode:standalone)'));
  for (const edge of ['safe-area-inset-top', 'safe-area-inset-bottom', 'safe-area-inset-left', 'safe-area-inset-right']) assert.ok(block.includes(`env(${edge})`), edge);
});
