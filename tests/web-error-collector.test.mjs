// #610: the console-error collector behind the web tests. Pure protocol events, no Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import {errorCollector, ALLOWED_ERRORS} from '../scripts/web-chrome.mjs';

test('uncaught exceptions, console.error and error-level logs are collected; other output is not', () => {
  const c = errorCollector([]);
  c.onEvent({method: 'Runtime.exceptionThrown', params: {exceptionDetails: {text: 'Uncaught', exception: {description: 'Error: boom'}}}});
  c.onEvent({method: 'Runtime.consoleAPICalled', params: {type: 'error', args: [{type: 'string', value: 'bad'}, {type: 'number', value: 3}]}});
  c.onEvent({method: 'Log.entryAdded', params: {entry: {level: 'error', text: 'refused', url: 'http://127.0.0.1:1/x'}}});
  c.onEvent({method: 'Runtime.consoleAPICalled', params: {type: 'log', args: [{type: 'string', value: 'fine'}]}});
  c.onEvent({method: 'Runtime.consoleAPICalled', params: {type: 'warning', args: [{type: 'string', value: 'fine'}]}});
  c.onEvent({method: 'Log.entryAdded', params: {entry: {level: 'warning', text: 'fine'}}});
  assert.deepEqual(c.errors, ['exception: Error: boom', 'console.error: bad 3', 'log: refused (http://127.0.0.1:1/x)']);
});

test('the allow-list matches exact text only, with the loopback port ignored', () => {
  const [known] = ALLOWED_ERRORS;
  const c = errorCollector();
  c.onEvent({method: 'Log.entryAdded', params: {entry: {level: 'error', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)', url: 'http://127.0.0.1:5123/api/parser/status'}}});
  assert.deepEqual(c.errors, [], known);
  c.onEvent({method: 'Log.entryAdded', params: {entry: {level: 'error', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)', url: 'http://127.0.0.1:5123/api/other'}}});
  c.onEvent({method: 'Log.entryAdded', params: {entry: {level: 'error', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)', url: 'https://example.com/api/parser/status'}}});
  assert.equal(c.errors.length, 2);
});
