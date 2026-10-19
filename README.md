# clever

Part of [audiogeek](https://audiogeek.sophtwhere.com/). Live at **https://audiogeek.sophtwhere.com/clever/**

A browser-based real-time audio analyzer for live sound: RTA, spectrograph, dual-channel transfer function (magnitude, phase, coherence), impulse response, delay finder and SPL meter. It runs entirely in the browser, with no build step and no dependencies.

## Features

- Multi-time-window FFT transfer function with averaging, fractional-octave smoothing and coherence blanking
- Built-in pink, white and sine generator, usable as an internal loopback reference or with an external reference input
- Automatic delay finder (GCC-PHAT) plus an impulse view for fine adjustment
- RTA from 1/1 to 1/24 octave, spectrograph, and A/C/Z SPL meter with Leq
- Captured traces with CSV import and export
- Mic calibration profiles: miniDSP UMIK-1, Dayton iMM-6C, or any frequency/dB text file
- Stream Deck control over WebHID (XL, MK.2, Original V2), plus an on-screen button console
- Installable as a home-screen app with offline support

## User guide

New to measurement tools? The [user guide](https://audiogeek.sophtwhere.com/clever/guide.html) explains each tool in plain language, with step-by-step workflows and a Smaart translation table.

## Hosting

Serve this folder as static files over HTTPS. Browsers only allow microphone and WebHID access on HTTPS or `localhost`. Everything uses relative paths, so the app works under any subfolder, for example `/clever/`.

With Express:

```js
app.use('/clever', express.static('/path/to/clever'));
```

Update a deployed copy with `git pull` inside the folder.

## Browser support

Chrome or Edge on desktop and Android. Stream Deck control needs desktop Chrome or Edge, because Android Chrome has no WebHID.
