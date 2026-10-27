#!/usr/bin/env node
/*!
 * clever-relay.js: the pairing server for clever (remote mic now; phone remote and other devices later).
 *
 * Adapted from the presentation timer's remote-server.js (github.com/jonathan-annett/timer-beta), and kept as
 * a separate copy so each app runs its own process and can move to its own server at any time.
 *
 * It only:
 *   - pairs clever (the "host") with devices ("peers") using a room code plus a secret key per role. The host
 *     registers the keys; the key a peer joins with decides its role, which the host is told and enforces.
 *     The server keeps only a SHA-256 of each key;
 *   - passes small JSON messages between the host and each peer (WebRTC signalling, settings), and
 *   - passes binary messages (the remote mic's audio when the two can't reach each other directly).
 * It never looks inside the messages it forwards.
 *
 * Protocol (text frames are JSON):
 *   host → {type:'host', room, keys:{<role>: <key>, …}}   ← {type:'hosted', room, protocol}
 *   peer → {type:'join', room, key}                        ← {type:'joined', id, role, hostOnline}
 *                                                           host ← {type:'peer-join', id, role}
 *   host → {type:'to', id, msg}      peer ← {type:'down', msg}
 *   peer → {type:'up', msg}          host ← {type:'from', id, msg}
 *   also: host ← peer-leave{id}; peer ← host-offline, host-online; either ← error{reason} (then closed)
 *   Binary: a peer's binary frame reaches the host with the peer's 6-byte id in front; the host sends a peer
 *   binary by putting that id in front, and the server takes it off.
 *
 * Usage:
 *   node clever-relay.js --cert fullchain.pem --key privkey.pem --origin https://audiogeek.example.com [--port 8444]
 *   node clever-relay.js --insecure --port 8444        # plain ws, for local testing or behind a proxy that does TLS
 * With systemd, deploy/clever-relay.service passes the certificate in via LoadCredential.
 * Environment variables work too: PORT, TLS_CERT, TLS_KEY, ALLOWED_ORIGINS (comma separated).
 * MIT Licensed
 */
'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

// ─── Config ───────────────────────────────────────────────────────────────────

const PROTOCOL = 1;
const LIMITS = {
  textBytes: 16 * 1024,        // signalling and settings are small (SDP is a few KB)
  textPerSec: 40,              // per socket; extra text messages are dropped
  binaryBytes: 64 * 1024,      // one audio block is 2–4 KB
  binaryPerSec: 200,           // the remote mic sends about 47 a second (94 at 96 kHz)
  binaryBytesPerSec: 512 * 1024,
  peersPerRoom: 8,
  keysPerRoom: 8,
  hostGraceMs: 2 * 60 * 1000,  // keep a room while clever reconnects (a reload, a Wi-Fi blip)
  pingMs: 25 * 1000,
  sendBuffer: 2 * 1024 * 1024, // a stalled receiver mustn't build up memory here: drop instead
};
const ID_BYTES = 6;

const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const validRoom = r => typeof r === 'string' && /^[A-Za-z0-9]{6,32}$/.test(r);
const validKey = k => typeof k === 'string' && k.length >= 16 && k.length <= 128;
const validRole = r => typeof r === 'string' && /^[a-z]{1,16}$/.test(r);

function send(ws, data, binary) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  if (ws.bufferedAmount > LIMITS.sendBuffer) return false;
  ws.send(binary ? data : JSON.stringify(data), { binary: !!binary });
  return true;
}

// ─── Relay ────────────────────────────────────────────────────────────────────

// Attach the relay to an http(s) server. Returns { wss, rooms, close }.
function createRelay(server, opts = {}) {
  const origins = opts.origins || [];
  const log = opts.log || (() => {});
  // room code -> { keys: Map<role, hash>, host: ws|null, peers: Map<id, {ws, role}>, hostGoneAt }
  const rooms = new Map();

  const wss = new WebSocketServer({
    server,
    maxPayload: Math.max(LIMITS.textBytes, LIMITS.binaryBytes + ID_BYTES),
    perMessageDeflate: false,
    verifyClient: (info, done) => {
      const origin = info.origin || info.req.headers.origin;
      // Browsers always send Origin, so this stops other websites using the server
      if (origins.length && origin && !origins.includes(origin)) { log('rejected origin', origin); return done(false, 403, 'Origin not allowed'); }
      done(true);
    },
  });

  function dropRoom(code) {
    const room = rooms.get(code); if (!room) return;
    for (const p of room.peers.values()) { send(p.ws, { type: 'error', reason: 'room-closed' }); p.ws.close(); }
    rooms.delete(code);
  }

  wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    // must be handled: an oversized or malformed frame emits 'error', and unhandled it would crash the server
    ws.on('error', err => log('socket error:', err.code || err.message));
    let kind = null, code = null, id = null, idBuf = null;
    let win = Date.now(), nText = 0, nBin = 0, bytes = 0;

    ws.on('message', (raw, isBinary) => {
      const now = Date.now();
      if (now - win > 1000) { win = now; nText = 0; nBin = 0; bytes = 0; }

      if (isBinary) {
        if (!kind || ++nBin > LIMITS.binaryPerSec || (bytes += raw.length) > LIMITS.binaryBytesPerSec) return;
        const room = rooms.get(code); if (!room) return;
        if (kind === 'peer') {
          if (raw.length > LIMITS.binaryBytes || !room.peers.has(id)) return;
          send(room.host, Buffer.concat([idBuf, raw]), true);
        } else if (raw.length > ID_BYTES) {
          const p = room.peers.get(raw.subarray(0, ID_BYTES).toString('hex'));
          if (p) send(p.ws, raw.subarray(ID_BYTES), true);
        }
        return;
      }

      if (++nText > LIMITS.textPerSec || raw.length > LIMITS.textBytes) return;
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object') return;

      if (!kind) {
        if (!validRoom(m.room)) { send(ws, { type: 'error', reason: 'bad-request' }); return ws.close(); }

        if (m.type === 'host') {
          const keys = new Map();
          if (m.keys && typeof m.keys === 'object') for (const [role, key] of Object.entries(m.keys)) if (validRole(role) && validKey(key) && keys.size < LIMITS.keysPerRoom) keys.set(role, hash(key));
          if (!keys.size) { send(ws, { type: 'error', reason: 'bad-request' }); return ws.close(); }
          let room = rooms.get(m.room);
          // the same clever (it knows a key the room already has) may take its room back; nobody else may
          if (room && ![...keys].some(([role, h]) => safeEqual(room.keys.get(role), h))) { send(ws, { type: 'error', reason: 'room-taken' }); return ws.close(); }
          if (!room) { room = { keys, host: null, peers: new Map(), hostGoneAt: null }; rooms.set(m.room, room); }
          // keys that changed or went away: their peers are dropped
          for (const [pid, p] of room.peers) if (!safeEqual(room.keys.get(p.role), keys.get(p.role))) { send(p.ws, { type: 'error', reason: 'room-closed' }); p.ws.close(); room.peers.delete(pid); }
          room.keys = keys;
          if (room.host && room.host !== ws) room.host.close();          // the newest clever window wins
          room.host = ws; room.hostGoneAt = null;
          kind = 'host'; code = m.room;
          send(ws, { type: 'hosted', room: code, protocol: PROTOCOL });
          for (const [pid, p] of room.peers) { send(ws, { type: 'peer-join', id: pid, role: p.role }); send(p.ws, { type: 'host-online' }); }
          return;
        }

        if (m.type === 'join') {
          const room = rooms.get(m.room);
          const h = validKey(m.key) ? hash(m.key) : null;
          let role = null;
          if (room && h) for (const [r, kh] of room.keys) if (safeEqual(kh, h)) { role = r; break; }
          if (!role) { send(ws, { type: 'error', reason: 'not-found' }); return ws.close(); }
          if (room.peers.size >= LIMITS.peersPerRoom) { send(ws, { type: 'error', reason: 'room-full' }); return ws.close(); }
          idBuf = crypto.randomBytes(ID_BYTES); id = idBuf.toString('hex');
          room.peers.set(id, { ws, role });
          kind = 'peer'; code = m.room;
          send(ws, { type: 'joined', id, role, hostOnline: !!room.host });
          send(room.host, { type: 'peer-join', id, role });
          return;
        }
        send(ws, { type: 'error', reason: 'bad-request' });
        return ws.close();
      }

      const room = rooms.get(code); if (!room) return;
      if (kind === 'host' && m.type === 'to') { const p = room.peers.get(m.id); if (p) send(p.ws, { type: 'down', msg: m.msg }); }
      else if (kind === 'peer' && m.type === 'up' && room.peers.has(id)) send(room.host, { type: 'from', id, msg: m.msg });
    });

    ws.on('close', () => {
      const room = rooms.get(code); if (!room) return;
      if (kind === 'host' && room.host === ws) {
        room.host = null; room.hostGoneAt = Date.now();
        for (const p of room.peers.values()) send(p.ws, { type: 'host-offline' });
      } else if (kind === 'peer' && room.peers.has(id)) {
        room.peers.delete(id);
        send(room.host, { type: 'peer-leave', id });
      }
    });
  });

  // drop rooms whose clever has been gone too long, and connections that stopped answering pings
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [c, room] of rooms) if (!room.host && room.hostGoneAt && now - room.hostGoneAt > LIMITS.hostGraceMs) dropRoom(c);
  }, 30 * 1000);
  const ping = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch {} }
  }, LIMITS.pingMs);
  sweep.unref(); ping.unref();
  wss.on('error', err => log('server error:', err.message));

  function close(done) {
    clearInterval(sweep); clearInterval(ping);
    for (const ws of wss.clients) { try { ws.close(1001, 'server restarting'); } catch {} }
    wss.close();
    setTimeout(() => { for (const ws of wss.clients) ws.terminate(); done && done(); }, 2000).unref();
  }
  return { wss, rooms, close };
}

module.exports = { createRelay, LIMITS, PROTOCOL, ID_BYTES };

// ─── Standalone ───────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
  const flag = name => args.includes('--' + name);
  const PORT = parseInt(arg('port') || process.env.PORT || '8444', 10);
  // With systemd's LoadCredential= the certificate files are handed over in $CREDENTIALS_DIRECTORY,
  // so the server never needs read access to /etc/letsencrypt
  const CRED_DIR = process.env.CREDENTIALS_DIRECTORY;
  const CERT = arg('cert') || process.env.TLS_CERT || (CRED_DIR && `${CRED_DIR}/fullchain.pem`);
  const KEY = arg('key') || process.env.TLS_KEY || (CRED_DIR && `${CRED_DIR}/privkey.pem`);
  const INSECURE = flag('insecure');
  const ORIGINS = (arg('origin') || process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const log = (...a) => console.log('[clever-relay]', ...a);

  if (!INSECURE && (!CERT || !KEY)) { console.error('Need --cert and --key (TLS certificate and private key), or --insecure for local testing.'); process.exit(1); }
  if (!ORIGINS.length) console.warn('[clever-relay] WARNING: no --origin given, so any website may connect. Set --origin https://your-clever-site');

  let relay;
  const handler = (req, res) => {
    // a health check, and a page that lets you accept a self-signed certificate
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`clever relay ok, protocol ${PROTOCOL} (${relay ? relay.rooms.size : 0} rooms)\n`);
  };
  const server = INSECURE ? http.createServer(handler) : https.createServer({ cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) }, handler);
  relay = createRelay(server, { origins: ORIGINS, log });
  server.listen(PORT, () => log(`${INSECURE ? 'ws' : 'wss'} on port ${PORT}` + (ORIGINS.length ? `, origins: ${ORIGINS.join(', ')}` : '')));

  // Shut down promptly (systemctl stop/restart, certificate renewal): close the sockets (clever and the
  // phones reconnect by themselves) and don't wait more than 2 s
  const shutdown = sig => { log(`${sig}: closing ${relay.wss.clients.size} connections`); relay.close(() => process.exit(0)); server.close(() => process.exit(0)); };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
