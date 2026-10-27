// Checks clever-relay.js: keys and roles, text and binary forwarding, room take-over, re-hosting, limits, origins.
// Run in this folder after npm install:  node test-relay.js
'use strict';
const http = require('http');
const assert = require('assert');
const { WebSocket } = require('ws');
const { createRelay, LIMITS } = require('./clever-relay');

const KEY = 'k'.repeat(24), KEY2 = 'q'.repeat(24), ROOM = 'ABC234';
let url;

function client(origin) {
  const ws = new WebSocket(url, origin ? { origin } : {});
  ws.binaryType = 'nodebuffer';
  ws.inbox = [];
  ws.waiters = [];
  ws.on('message', (d, bin) => {
    const m = bin ? d : JSON.parse(d);
    const w = ws.waiters.findIndex(x => x.test(m));
    if (w >= 0) ws.waiters.splice(w, 1)[0].resolve(m); else ws.inbox.push(m);
  });
  ws.ready = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); ws.on('unexpected-response', (q, r) => rej(new Error('HTTP ' + r.statusCode))); });
  ws.j = o => ws.send(JSON.stringify(o));
  ws.next = (test = () => true, ms = 2000) => {
    const i = ws.inbox.findIndex(test);
    if (i >= 0) return Promise.resolve(ws.inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => { const w = { test, resolve }; ws.waiters.push(w); setTimeout(() => { const k = ws.waiters.indexOf(w); if (k >= 0) { ws.waiters.splice(k, 1); reject(new Error('timed out waiting')); } }, ms); });
  };
  ws.closed = new Promise(res => ws.on('close', res));
  return ws;
}
const type = t => m => !Buffer.isBuffer(m) && m.type === t;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = http.createServer();
  const relay = createRelay(server, { origins: ['https://good.example'] });
  await new Promise(r => server.listen(0, r));
  url = `ws://127.0.0.1:${server.address().port}/clever-relay`;
  let n = 0; const ok = s => { n++; console.log('ok', n, s); };

  // origins
  await assert.rejects(client('https://evil.example').ready, /403/); ok('other website refused');
  const nodeClient = client(); await nodeClient.ready; nodeClient.close(); ok('client without Origin allowed (needs a key anyway)');

  // host
  const host = client('https://good.example'); await host.ready;
  host.j({ type: 'host', room: ROOM, keys: { mic: KEY, remote: KEY2 } });
  assert.equal((await host.next(type('hosted'))).protocol, 1); ok('hosted');

  // wrong key, unknown room
  const bad = client('https://good.example'); await bad.ready;
  bad.j({ type: 'join', room: ROOM, key: 'x'.repeat(24) });
  assert.equal((await bad.next(type('error'))).reason, 'not-found'); await bad.closed; ok('wrong key refused');
  const bad2 = client('https://good.example'); await bad2.ready;
  bad2.j({ type: 'join', room: 'NOROOM9', key: KEY });
  assert.equal((await bad2.next(type('error'))).reason, 'not-found'); ok('unknown room refused');

  // join: role from the key
  const mic = client('https://good.example'); await mic.ready;
  mic.j({ type: 'join', room: ROOM, key: KEY });
  const j = await mic.next(type('joined'));
  assert.equal(j.role, 'mic'); assert.equal(j.hostOnline, true);
  const pj = await host.next(type('peer-join'));
  assert.equal(pj.id, j.id); assert.equal(pj.role, 'mic'); ok('joined as mic, host told');
  const rem = client('https://good.example'); await rem.ready;
  rem.j({ type: 'join', room: ROOM, key: KEY2 });
  assert.equal((await rem.next(type('joined'))).role, 'remote');
  const remId = (await host.next(type('peer-join'))).id; ok('second key gives the other role');

  // text both ways, addressed
  host.j({ type: 'to', id: j.id, msg: { type: 'offer', sdp: 'x' } });
  assert.deepEqual((await mic.next(type('down'))).msg, { type: 'offer', sdp: 'x' });
  mic.j({ type: 'up', msg: { type: 'answer' } });
  const f = await host.next(type('from')); assert.equal(f.id, j.id); assert.deepEqual(f.msg, { type: 'answer' });
  await sleep(100); assert.equal(rem.inbox.filter(type('down')).length, 0); ok('text forwarded only to the addressed peer');

  // peers can't address each other
  mic.j({ type: 'to', id: remId, msg: 'sneaky' }); await sleep(100);
  assert.equal(rem.inbox.length, 0); ok('a peer cannot send to another peer');

  // binary both ways
  const block = Buffer.alloc(2064, 7); block[0] = 67;
  mic.send(block);
  const got = await host.next(Buffer.isBuffer);
  assert.equal(got.length, 6 + block.length); assert.equal(got.subarray(0, 6).toString('hex'), j.id); assert.ok(got.subarray(6).equals(block)); ok('peer binary reaches host with its id in front');
  host.send(Buffer.concat([Buffer.from(j.id, 'hex'), Buffer.from('hi')]));
  assert.equal((await mic.next(Buffer.isBuffer)).toString(), 'hi'); ok('host binary reaches the addressed peer without the id');

  // another computer can't take the room
  const thief = client('https://good.example'); await thief.ready;
  thief.j({ type: 'host', room: ROOM, keys: { mic: 'z'.repeat(24) } });
  assert.equal((await thief.next(type('error'))).reason, 'room-taken'); ok('room take-over refused');

  // host reconnect with the same keys keeps the peers
  host.close(); assert.ok(await mic.next(type('host-offline'))); ok('peers told host went offline');
  const host2 = client('https://good.example'); await host2.ready;
  host2.j({ type: 'host', room: ROOM, keys: { mic: KEY, remote: KEY2 } });
  await host2.next(type('hosted'));
  const back = [await host2.next(type('peer-join')), await host2.next(type('peer-join'))].map(m => m.role).sort();
  assert.deepEqual(back, ['mic', 'remote']); assert.ok(await mic.next(type('host-online'))); ok('host back: peers kept and re-announced');

  // re-host with a changed key drops only that role's peers
  const host3 = client('https://good.example'); await host3.ready;
  host3.j({ type: 'host', room: ROOM, keys: { mic: KEY, remote: 'n'.repeat(24) } });
  await host3.next(type('hosted'));
  assert.equal((await rem.next(type('error'))).reason, 'room-closed'); await rem.closed;
  assert.equal((await host3.next(type('peer-join'))).role, 'mic'); ok('changed key drops its peers; others stay; newest host wins');
  await host2.closed; ok('old host window closed');

  // limits: text rate
  await sleep(1100); const before = host3.inbox.length;
  for (let i = 0; i < 100; i++) mic.j({ type: 'up', msg: i });
  await sleep(300);
  const ups = host3.inbox.slice(before).filter(type('from')).length;
  assert.ok(ups <= LIMITS.textPerSec && ups >= LIMITS.textPerSec - 2, 'text messages passed: ' + ups); ok(`text rate limited (${ups} of 100 passed)`);
  // limits: binary byte rate (an audio-sized stream passes, a flood is cut)
  await sleep(1100); host3.inbox = [];
  for (let i = 0; i < 47; i++) mic.send(block);
  await sleep(300);
  assert.equal(host3.inbox.filter(Buffer.isBuffer).length, 47); ok('a second of remote mic audio passes whole');
  await sleep(1100); host3.inbox = [];
  const big = Buffer.alloc(60 * 1024);
  for (let i = 0; i < 20; i++) mic.send(big);
  await sleep(500);
  const passed = host3.inbox.filter(Buffer.isBuffer).length;
  assert.ok(passed <= 8, 'big frames passed: ' + passed); ok(`binary byte rate limited (${passed} of 20 × 60 KB passed)`);
  // limits: oversized frame closes only that socket, the server survives
  await sleep(1100);
  mic.send(Buffer.alloc(200 * 1024)); await mic.closed;
  assert.equal((await host3.next(type('peer-leave'))).id, j.id); ok('oversized frame: that socket closed, host told, server still up');

  // bad first messages
  const junk = client('https://good.example'); await junk.ready;
  junk.j({ type: 'host', room: ROOM, keys: { mic: 'short' } });
  assert.equal((await junk.next(type('error'))).reason, 'bad-request'); ok('host with no valid key refused');

  relay.close(); server.close();
  console.log(`\nall ${n} checks passed`);
  process.exit(0);
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
