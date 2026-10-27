// clever relay: a tiny WebSocket room server for pairing a phone with clever.
//
// It only passes messages between the devices in a room: WebRTC signalling (offers, answers, ICE candidates) as
// text, and, when the venue Wi-Fi won't let the two devices talk directly, the remote mic's audio as binary.
// It stores nothing and knows nothing about audio.
//
// Hook it into the Express app with the HTTP server that app.listen() returns:
//
//   const server = app.listen(PORT);
//   require('/path/to/clever/relay/clever-relay')(server);          // needs: npm install ws
//
// clever connects to  wss://<your site>/clever-relay?room=<code>&role=<name>
// If nginx, Caddy or Cloudflare sits in front of Express, it must pass WebSocket upgrades for /clever-relay.
'use strict';
// `ws` is installed in the Express app's own folder, so look for it from the app as well as from here
function loadWs(){ try { return require('ws'); } catch { return require.main.require('ws'); } }

module.exports = function attach(server, opts = {}){
  const { WebSocketServer, WebSocket } = opts.ws || loadWs();
  const path = opts.path || '/clever-relay';
  const maxPerRoom = opts.maxPerRoom || 4;          // the computer, a phone, and room to reconnect
  const maxMessage = opts.maxMessage || 256 * 1024;
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxMessage, perMessageDeflate: false });
  const rooms = new Map();                          // room code -> Set of sockets

  server.on('upgrade', (req, socket, head) => {
    let url; try { url = new URL(req.url, 'http://x'); } catch { return; }
    if (url.pathname !== path) return;              // leave other upgrade handlers alone
    const room = (url.searchParams.get('room') || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
    const role = (url.searchParams.get('role') || 'peer').replace(/[^a-z]/g, '').slice(0, 12);
    if (room.length < 4){ socket.destroy(); return; }
    const set = rooms.get(room);
    if (set && set.size >= maxPerRoom){ socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      ws.room = room; ws.role = role; ws.alive = true;
      if (!rooms.has(room)) rooms.set(room, new Set());
      const peers = rooms.get(room);
      for (const p of peers) send(p, JSON.stringify({ type: 'peer-joined', role }));
      ws.send(JSON.stringify({ type: 'welcome', room, peers: [...peers].map(p => p.role) }));
      peers.add(ws);
      ws.on('pong', () => { ws.alive = true; });
      ws.on('message', (data, isBinary) => {
        for (const p of peers) if (p !== ws) send(p, data, isBinary);   // pass it on, text or binary
      });
      ws.on('close', () => {
        peers.delete(ws);
        if (!peers.size) rooms.delete(room);
        else for (const p of peers) send(p, JSON.stringify({ type: 'peer-left', role }));
      });
      ws.on('error', () => {});
    });
  });
  // drop connections that have gone away without saying so (a phone that slept, a laptop that lost Wi-Fi)
  const timer = setInterval(() => {
    for (const ws of wss.clients){ if (!ws.alive){ ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch {} }
  }, 20000);
  timer.unref && timer.unref();
  function send(ws, data, isBinary){
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 2 * 1024 * 1024) return;   // a stalled receiver mustn't build up memory here
    ws.send(data, { binary: !!isBinary });
  }
  return wss;
};

// Standalone, on its own port, using the site's certificate (a page on https can only open wss://):
//   cd relay && npm install && node clever-relay.js --port 8443 --cert /etc/letsencrypt/live/<site>/fullchain.pem --key /etc/letsencrypt/live/<site>/privkey.pem
// Behind a proxy that handles TLS, run it without --cert/--key and point the proxy at it.
if (require.main === module){
  const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : process.env['RELAY_' + k.toUpperCase()] || d; };
  const port = +arg('port', 8443), cert = arg('cert'), key = arg('key');
  const fs = require('fs');
  const handler = (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('clever relay\n'); };
  const server = cert && key
    ? require('https').createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, handler)
    : require('http').createServer(handler);
  module.exports(server, { path: arg('path', '/clever-relay') });
  // certificates renew (Let's Encrypt every 60–90 days): reload them without dropping anyone
  if (cert && key) setInterval(() => { try { server.setSecureContext({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }); } catch {} }, 12 * 3600 * 1000).unref();
  server.listen(port, () => console.log(`clever relay on ${cert ? 'wss' : 'ws'}://0.0.0.0:${port}${arg('path', '/clever-relay')}`));
}
