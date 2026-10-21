# clever

Part of [audiogeek](https://audiogeek.sophtwhere.com/). Live at **https://audiogeek.sophtwhere.com/clever/**

A browser-based real-time audio analyzer for live sound: RTA, spectrograph, dual-channel transfer function (magnitude, phase, coherence), impulse response, delay finder, SPL meter, loudness drift monitor and third-octave hot-zone view. It runs entirely in the browser, with no build step and no dependencies.

## Features

- Multi-time-window FFT transfer function with averaging, fractional-octave smoothing, coherence blanking and a choice of coherence displays (lane, overlay, mist, fade)
- Built-in pink, white and sine generator, usable as an internal loopback reference or with an external reference input
- Automatic delay finder (GCC-PHAT) plus an impulse view for fine adjustment
- RTA from 1/1 to 1/24 octave, spectrograph, and A/C/Z SPL meter with Leq
- Levels: 10 minutes of loudness history in short-term LUFS (ITU-R BS.1770), 3 s Leq or RMS, opening at a 60 s view with 5 s and 60 s peak-to-mean boxes, a reference line and a drift readout for keeping a feed consistent
- Bands: a waterfall laid out like a graphic EQ (31, 33 or 30-band third-octave, 15-band, 10-band or your own centre frequencies) with the loudest band highlighted, a hot-band tally and a big "pull this fader" readout for ringing out, and bands you can tap to ignore; works on the mic, the reference input or the solo channel, with A, C or Z weighting
- Voice check: reduces everything it finds to settings for your desk's channel EQ (3 or 4 parametric bands with optional shelves, cuts only), plus a speech-gated average of a vocal mic compared with natural speech, flagging pops and rumble, proximity build-up, resonances, nasal, harsh and sibilant areas, with suggested cuts and a warning when they'd cost too much speech level; a steady list you can pause, an Earlier list, and a 60 s timeline of pops and sibilants with their fixes; an optional on-device transcript (Whisper on WebGPU) that highlights the words where they happened; sensitivity, cut depth and every rule's range and threshold are adjustable
- Listen: headphone monitoring of the mic, the reference, or the mic minus the predicted reference (live echo cancellation)
- Pass-through: play a music source on the reference input straight to the amp and measure with it
- Captured traces with CSV import and export
- Mic calibration profiles: miniDSP UMIK-1, Dayton iMM-6C, or any frequency/dB text file
- Stream Deck control over WebHID (XL, MK.2, Original V2), plus an on-screen button console. The keys follow the screen, with a page per view and a fixed left column, and a layout editor
- Installable as a home-screen app with offline support; full screen on Android
- Collapsible settings panel, full screen, and keyboard shortcuts (Space, G, D, C, R, L, S, F, K, M, 1–6)

## User guide

New to measurement tools? The [user guide](https://audiogeek.sophtwhere.com/clever/guide.html) explains each tool in plain language, with step-by-step workflows and a Smaart translation table.

## Old audiogeek pages

The old analyzer (`/`) and levels monitor (`/levels.html`) on audiogeek.sophtwhere.com are replaced by clever's Bands and Levels tabs. [`redirects/`](redirects/README.md) has the stub pages and server steps that send old bookmarks to the right tab, with a banner linking to the old versions. Deep links also work directly: `?view=levels`, `?view=bands`.

## Hosting

Serve this folder as static files over HTTPS. Browsers only allow microphone and WebHID access on HTTPS or `localhost`. Everything uses relative paths, so the app works under any subfolder, for example `/clever/`.

With Express:

```js
app.use('/clever', express.static('/path/to/clever'));
```

Update a deployed copy with `git pull` inside the folder.

## Browser support

Chrome or Edge on desktop and Android. Stream Deck control needs desktop Chrome or Edge, because Android Chrome has no WebHID.
