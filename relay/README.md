# clever relay

A small WebSocket server that pairs a phone with clever for the **remote mic** (experimental). It passes the WebRTC introductions between the phone and the computer and, only if the network won't let them talk directly, the audio itself. It stores nothing.

On a phone hotspot (the computer joined to the phone's hotspot) the two connect directly and the relay only carries the introductions, a few kilobytes.

## Run it on its own port (recommended)

On the server, in this folder:

```
npm install
node clever-relay.js --port 8443 --cert /etc/letsencrypt/live/<site>/fullchain.pem --key /etc/letsencrypt/live/<site>/privkey.pem
```

A page served over https can only open `wss://` connections, so the relay needs the site's certificate (the same files the web server uses; the relay reloads them twice a day, so renewals are picked up). The user running it must be able to read them. Open the port in the firewall.

clever's default relay address is `wss://<the same host>:8443/clever-relay`. A different port or host goes in clever under **Remote mic › Relay**; the pairing QR code passes it on to the phone.

To keep it running, use whatever runs the main site: a systemd unit, pm2 (`pm2 start clever-relay.js -- --port 8443 --cert … --key …`), or similar. Changes to the relay need a restart; changes to clever itself only need `git pull`.

## Or inside the Express app

```js
const server = app.listen(PORT);
require('/path/to/clever-alpha/relay/clever-relay')(server);   // npm install ws in the app's folder
```

Then set the relay address in clever to `wss://<site>/clever-relay`. If nginx, Caddy or Cloudflare sits in front of Express, it must pass WebSocket upgrades for `/clever-relay`.
