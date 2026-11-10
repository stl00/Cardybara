// Real headless Chrome, synthetic popup state, no extension install and no bank contact.
import test from 'node:test';
import assert from 'node:assert/strict';
import {measure,POPUP_MAX} from '../scripts/popup-layout.mjs';

test('both popups fit Chrome\'s popup window with eight banks, in every language',async()=>{
 const results=await measure();
 assert.equal(results.length,9);
 for(const r of results){
  assert.ok(r.rows>=8,`${r.name}: ${r.rows} bank rows rendered`);
  assert.ok(r.width<=POPUP_MAX.width,`${r.name}: ${r.width}px wide`);
  // Past 600px Chrome scrolls the whole popup window.
  assert.ok(r.height<=POPUP_MAX.height,`${r.name}: ${r.height}px tall`);
  // Folded, every bank row is in view at once; only with every section unfolded may a list scroll inside itself.
  if(!r.name.endsWith('unfolded'))for(const list of r.inner)assert.equal(list.scroll,false,`${r.name}: #${list.id} scrolls`);
 }
});
