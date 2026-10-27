# clever relay

The pairing server for clever. Today it serves the **remote mic** (experimental): it passes the WebRTC introductions between the phone and the computer and, only when the network won't let them talk directly, the audio itself. Later it can serve other devices (a phone remote, a glasses display) as further roles. It stores nothing and never looks inside the messages it passes.

It is adapted from the presentation timer's pairing server, but it is its own copy and runs as its own service on its own port (8444; the timer's uses 8443), so either app can move to another server on its own.

## How pairing works

clever makes a room code and a secret key for each kind of device (only `mic` for now) and registers them with the relay. The pairing QR code carries the room code and the key; the key is in the link's `#` part, so it never reaches the web server or its logs. A device joins with the key, and the key decides its role. The relay keeps only a SHA-256 of each key, refuses joins with a wrong key and won't let another computer take over a room. A room survives clever reconnecting (a reload, a Wi-Fi drop) for 2 minutes.

Limits per connection: 40 text messages a second (16 KB each), and 200 binary messages and 512 KB a second (the remote mic's audio is about 47 messages and 100 KB a second). Up to 8 devices per room.

## Run it

On the server, in this folder:

```
npm install --omit=dev
node clever-relay.js --port 8444 --origin https://audiogeek.sophtwhere.com \
     --cert /etc/letsencrypt/live/<site>/fullchain.pem --key /etc/letsencrypt/live/<site>/privkey.pem
```

A page served over https can only open `wss://` connections, so the relay needs the site's certificate. `--origin` stops other websites using your relay (give several, comma separated; the live and alpha copies on the same host share one origin). Open the port in the firewall. `curl https://<site>:8444/` answers `clever relay ok` with the protocol version.

To keep it running, use systemd:

- `deploy/clever-relay.service`: edit `WorkingDirectory`, the domain and `User`, then install it as described at the top of the file. systemd hands the certificate to the relay (`LoadCredential`), so the relay itself needs no access to `/etc/letsencrypt`.
- `deploy/certbot-deploy-hook.sh`: restarts the relay when the certificate renews.

Changes to the relay need `systemctl restart clever-relay`; changes to clever itself only need `git pull`.

clever's default relay address is `wss://<the same host>:8444/clever-relay`. A different port or host goes in clever under **Remote mic › Relay**; the pairing QR code passes it on to the phone. The relay ignores the path, so the same address works if you later put nginx in front of it (which then must pass WebSocket upgrades).

**Venue networks:** some venue and hotel Wi-Fi only lets ports 80 and 443 out. If the relay can't be reached there while the website can, that's the likely cause; the fix is a proxy on 443 that sends `/clever-relay` to this port.

## Local testing

`node clever-relay.js --insecure --port 8444` runs plain `ws://`, which a page on `http://localhost` can use. `node test-relay.js` checks keys, roles, binary forwarding and the limits.

## Protocol

Text frames are JSON; the relay never reads `msg`.

| From | Sends | The other side gets |
|---|---|---|
| clever | `{type:'host', room, keys:{role: key, …}}` | clever: `{type:'hosted', room, protocol}` |
| device | `{type:'join', room, key}` | device: `{type:'joined', id, role, hostOnline}`; clever: `{type:'peer-join', id, role}` |
| clever | `{type:'to', id, msg}` | device: `{type:'down', msg}` |
| device | `{type:'up', msg}` | clever: `{type:'from', id, msg}` |

Also `peer-leave {id}` to clever, `host-offline` and `host-online` to devices, and `error {reason}` (`bad-request`, `not-found`, `room-taken`, `room-full`, `room-closed`) before the relay closes a connection. A clever registering again with changed keys drops the devices that used the old ones.

Binary frames: a device's binary frame reaches clever with the device's 6-byte id in front; clever sends a device binary by putting its id in front, and the relay takes it off.
