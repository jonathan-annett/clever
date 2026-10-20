# clever

Browser-based real-time audio analyzer for live sound, in the spirit of Smaart Live. Part of audiogeek. Live at https://audiogeek.sophtwhere.com/clever/

The owner is a live sound engineer. He tests on real gear at venues, so anything that touches measurement accuracy needs care.

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole app: HTML, CSS and two inline scripts. No build step, no dependencies. |
| `guide.html` | User guide for people new to measurement. Linked from the ? button and the About section. Keep it in step with UI labels when they change. |
| `guide.m4a` | Audio overview of the guide (NotebookLM). Lives only on the server; listed in `.gitignore` because it is too big for the repo. The guide links to it, and the service worker skips media requests. |
| `redirects/` | Stubs and instructions for sending the old audiogeek pages (`/` and `/levels.html` on the site root) to clever's Bands and Levels tabs. Not used by clever itself. |
| `sw.js` | Service worker. Network first with a 4 s timeout, cache fallback for offline use at venues. |
| `manifest.webmanifest` | Home-screen install (name "clever by audiogeek", short name "clever"). `display` is `fullscreen` (with `standalone` as fallback) so the installed Android app hides the system bars. |
| `icon-*.png` | App icons (192, 512, maskable 512). |

Keep it a single self-contained page. Don't add a bundler, framework or npm dependencies unless the owner asks.

## Deployment

- Served by the owner's Node/Express server as static files under `/clever/`, over HTTPS. Mic access and WebHID require HTTPS.
- The server folder is a git clone of this repo. The owner deploys by running `git pull` on the server, usually over SSH from Termux on his phone. There is no CI.
- All paths are relative (manifest `start_url` and `scope` are `./`, the service worker is registered as `sw.js`). Keep them relative so the app works in any subfolder.
- When you change cached assets, bump `CACHE` in `sw.js` (currently `clever-v8`) so installed copies refresh.
- Commit and push to `main`, then tell the owner to pull.

## Code map (`index.html`)

1. `<style>`: dark-only design on purpose (used in dark venues). Tokens on `:root`. `[hidden]{display:none!important}` must stay, or elements with their own `display` ignore the hidden attribute. Under 900 px the settings panel becomes a slide-out drawer; above that, `.app.nside` collapses it (`P.sideHidden`, key S). The ☰ button handles both.
2. `<script id="dsp">`: pure DSP with no DOM access, also exported for Node (`module.exports = DSP`) so it can be unit tested. Contains a radix-2 FFT, Hann window cache, prefix sums with fractional-bin integration (`cum`), GCC-PHAT delay finder, A and C weighting, log-frequency interpolation and the cal file parser.
3. Main script, in banner-commented sections:
   - **settings**: `P` is the persisted settings object (`DEFAULTS` merged with `localStorage`). Call `changed()` or `save()` + `syncUI()` after mutating it.
   - **audio worklets**: the `WORKLET` string is loaded as a Blob URL. `ca-cap` captures input 0 (reference) and input 1 (measurement) in 1024-sample blocks. `ca-gen` produces pink (Paul Kellet filter, normalised to RMS 1), white or sine at an RMS dBFS level.
   - **engine**: `start()` builds the AudioContext graph. Echo cancellation, noise suppression and auto gain are switched off. The reference is either the generator (internal loopback) or a device channel. A screen wake lock is held while running.
   - **analysis**: ring buffers of 2^18 samples. Multi-time-window FFT sizes are 16k down to 512 at 48 kHz (doubled at 88.2 kHz and above). The `MTW_BOUNDS` crossovers are 200, 400, 800, 1600 and 3200 Hz. Cross-spectra are averaged per size. A residual sub-sample delay is applied as a phase rotation. Smoothing is complex smoothing over fractional-octave bands via prefix sums. The display grid is 1/48 octave, 18 Hz to 22 kHz.
   - **delay finder**: GCC-PHAT over 65536 samples with parabolic interpolation. A confidence ratio below 8 is rejected. Negative delays delay the measurement instead of the reference.
   - **SPL**: 4096-sample non-overlapping blocks, frequency-domain weighting including mic cal correction, Fast and Slow exponential time weighting, Leq and Max.
   - **levels**: `LEV` ring buffer of 100 ms points (11 min) filled from `onAudio`, so it keeps recording while other tabs show. Per sample: BS.1770 K-weighting (`DSP.kWeight`, verified: 1 kHz 0 dBFS sine = −3.00 LUFS). Per 100 ms block: K-weighted, unweighted and SPL-weighted mean squares (the weighted one comes from `splBlock`), each averaged over a 3 s window and stored as LUFS, dBFS and weighted dBFS (SPL offset added at display time), plus 400 ms momentary versions (`km`, `rm`, `wm`). The view defaults to 60 s (`P.levSpan` 1, 3 or 10 min; wheel, − and =, header button). At 60 s it draws the old levels page's boxes: last 5 s (red) and 60 s (green) from momentary mean to momentary peak. `P.levRefWin` is an average window in seconds or `p5`/`p60` for a peak. The readout shows the 3 s drift and a steadier 60 s average drift. `P.levRef` holds one reference per method; the drift readout is current minus reference. Click or drag on the graph sets the reference (`S.levDrag` freezes the y-range while dragging).
   - **bands**: `BANDS.rows` keeps 1500 rows of the 33 ISO third-octave band levels (12.5 Hz–20 kHz), pushed each analysis tick from the response-averaged spectrum. `drawBands()` redraws from history every frame. Loudest non-ignored band is the hot zone. `P.bandIgnore` is imported once from the old analyzer's `ignoreBars` localStorage key (same origin, same band list).
   - **top views**: `TOP_VIEWS` = rta, spec, ir, lev, bands (keys 1–5). Deep links: `?view=levels|bands|…`; `?from=levels|analyzer` opens the matching tab full screen, starts the mic and shows the dismissible legacy banner (`LEGACY` table near the end of the script holds the old-version links, `/legacy/…`). Dismissal is stored as `ca.legacy.<from>`.
   - **plotting**: canvas plots on a log-frequency axis (20 Hz to 20 kHz). `drawMag()` has five coherence views in `COH_VIEWS` (`P.cohView`, key K): lane (default, own strip at the top), overlay, mist (red haze where coherence is poor), fade (live trace alpha follows coherence) and off. These are on trial: the owner will pick a favourite and the rest can be removed. The `loop()` analysis and render runs on `requestAnimationFrame` at about 13 Hz, so it pauses when the tab is hidden.
   - **calibration**: mic profiles live in `CALS` (localStorage key `ca.cals`), each with its own `splOffset`. `autoPickCal()` matches the input device label (`/umik/`, `/imm-?6|dayton/`).
   - **traces**: `TRACES` (key `ca.traces`), CSV import and export.
   - **Stream Deck**: WebHID, Elgato gen-2 protocol (see below). `ACTIONS` is a 32-entry key map that is also drawn as the on-screen console.
   - **UI wiring**: `bind(id, key, opts)` connects a form control to a `P` key. `syncUI()` pushes state back into the DOM.

Storage keys: `ca.settings`, `ca.cals`, `ca.traces`. The old `ca.cal` key is migrated into `ca.cals` on load. Don't rename these keys without a migration, or users lose their cal profiles and traces.

## Measurement conventions

- **dBFS** is sine-referenced: a full-scale sine reads 0 dBFS. RTA band level is `10·log10(4·Σ|X|² / (N·Σw²))`.
- **Transfer function**: `H = Gxy / Gxx` with ref = X and meas = Y. Coherence is `|Gxy|² / (Gxx·Gyy)` per bin, then averaged across each smoothing band.
- **Mic cal files**: text files of frequency/dB pairs. The values are the mic's deviation, so they are subtracted. A UMIK-1 header line looks like `"Sens Factor =-1.378dB, AGain =18dB, SERNO: 7001234"`.
- **SPL offset default**: `112 − SensFactor`, from the UMIK-1 nominal −18 dBFS at 94 dB SPL. This is approximate and the UI says so. The Dayton iMM-6C file has no sensitivity, so it needs the calibrator button. Offsets are saved per mic profile.
- **UMIK-1 cal URL**: `https://www.minidsp.com/images/umik/<7-digit serial>[_90deg].txt`. miniDSP sends no CORS headers, so the app falls back to showing the link for manual download. The owner prefers that manual flow because he gets the .txt file on disk too. Don't add a server proxy unless asked.
- **Dayton iMM-6C**: no direct URL. The user looks the file up by serial at https://support.daytonaudio.com/MicrophoneCalibrationTool.

## Stream Deck (WebHID)

Vendor ID 0x0fd9. Supported product IDs: XL 0x006c and 0x008f (8×4, 96 px keys), MK.2 0x0080 and 0x00a5, V2 0x006d (5×3, 72 px). These are the gen-2 protocol:

- **Key images**: JPEG, rotated 180°. Sent as output report 0x02 in 1023-byte data packets: header `[0x07, key, isLast, lenLo, lenHi, pageLo, pageHi]` then up to 1016 bytes of payload.
- **Brightness**: feature report 0x03 with `[0x08, percent]`, padded to 31 bytes. Reset is `[0x02]`.
- **Key presses**: input report 0x01, key states start at data offset 3.

The protocol is written from community documentation and hasn't been tested on hardware yet. If keys misbehave, suspect the key index mapping and the input report offset first. Android Chrome has no WebHID, so the app hides the connect button there and offers only the on-screen console.

## Testing

- Playwright with Chromium is available in the cloud agent sandbox (`/opt/npm-tools/node_modules/playwright`, browsers in `/opt/pw-browsers`). Serve the folder with a tiny static server, launch with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` for a fake mic, and screenshot. To judge transfer function drawing, set `S.tf` to synthetic `{f, mag, ph, coh}` arrays, because the fake mic doesn't correlate with the generator. Google Fonts are blocked there, so text falls back to system fonts.
- No test suite. To check the main script's syntax, extract it and run `node --check`.
- To test the DSP, extract the `#dsp` script and `require()` it in Node. Earlier simulated checks passed: GCC-PHAT recovered a 1234.4-sample delay, the transfer function read −6.02 dB for a 0.5× gain with the expected residual phase, and a full-scale sine read 0.00 dBFS.
- Visual or UI changes still need the owner to look on his devices.

## Status

Untested on real hardware: the Stream Deck XL, the iMM-6C on the Galaxy Z Fold 7, SPL accuracy against a calibrator, and a side-by-side comparison with Smaart.

Gaps against Smaart Live, roughly in the owner's priority order:

1. Multiple simultaneous measurements, and averaging traces from several mic positions into one.
2. SPL history: the Levels tab covers 10 minutes with LUFS, 3 s Leq and RMS. Still missing: rolling LAeq over 1/10/15 min, LCpeak, and logging to file.
3. Continuous live delay tracking.
4. Per-trace offset and invert, and trace subtraction (for example against a target curve).
5. Impulse response with ETC and log views, RT60, T20, T30, C50 and C80, plus sweep and periodic pink generator signals.
6. Arbitrary input channel routing beyond channels 1 and 2, saved setups, and peak and difference cursors.

## Owner preferences

- Plain, direct UI copy. Measurement terms of art are fine; marketing tone isn't.
- Branding is "clever" in lowercase, with the "v" in the amber accent colour, and "audiogeek" as the small secondary line.
- Keep changes focused and explain what to check at a venue.
- Some related projects are private and are deliberately kept out of this repo. Don't add integrations with other devices or services unless the owner asks in the session.
