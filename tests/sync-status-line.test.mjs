// What the account sheet says about sync (stl00/Cardybara#580): the time of the last good sync instead of an endless
// "Syncing…", and a plain line when this device is signed in but not uploading.
import test from 'node:test';
import assert from 'node:assert/strict';
import {syncLine} from '../src/syncStatus.js';

const AT=Date.parse('2026-11-17T10:00:00Z');
test('syncing shows the last good sync when there is one',()=>{
 assert.deepEqual(syncLine({on:true,status:'syncing',syncedAt:AT}),{kind:'syncing_since',at:AT});
 assert.deepEqual(syncLine({on:true,status:'syncing',syncedAt:null}),{kind:'syncing'});
 assert.deepEqual(syncLine({on:true,status:null,syncedAt:AT}),{kind:'syncing_since',at:AT});
 assert.deepEqual(syncLine({on:true,status:null,syncedAt:null}),{kind:'syncing'});
});
test('a finished sync names its time; failures keep the time of the last good one',()=>{
 assert.deepEqual(syncLine({on:true,status:'synced',syncedAt:AT}),{kind:'synced',at:AT});
 assert.deepEqual(syncLine({on:true,status:'synced',syncedAt:null}),{kind:'synced'});
 assert.deepEqual(syncLine({on:true,status:'error',syncedAt:AT}),{kind:'error',at:AT});
 assert.deepEqual(syncLine({on:true,status:'offline',syncedAt:null}),{kind:'offline'});
});
test('signed in with sync off says that this device is not uploading',()=>{
 assert.deepEqual(syncLine({on:false,status:null,syncedAt:null}),{kind:'off'});
 assert.deepEqual(syncLine({on:false,status:'synced',syncedAt:AT}),{kind:'off'});
});
