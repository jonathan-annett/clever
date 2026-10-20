# Redirects for the old audiogeek pages

These stubs send old bookmarks to clever, opened on the matching tab, with a dismissible
"looking for the old version?" banner. They are not used by clever itself.

| Old address | Stub to put there | Opens |
|---|---|---|
| `/levels.html` | `levels.html` | clever, Levels tab |
| `/` (`/index.html`) | `analyzer.html`, renamed to `index.html` | clever, Bands tab |

## Steps on the server (site root)

```bash
cd /path/to/site-root
mkdir -p legacy
mv index.html levels.html legacy/          # keep the old pages
cp audioMotion.js legacy/                  # the old pages import it from their own folder
cp clever/redirects/analyzer.html index.html
cp clever/redirects/levels.html levels.html
```

The banner's "Open the old version" links point at `/legacy/` and `/legacy/levels.html`.
If you put the old pages somewhere else, change the `LEGACY` table near the end of
`clever/index.html` and the links in these stubs.

## Or with Express

```js
app.get(['/', '/index.html'], (req, res) => res.redirect('/clever/?view=bands&from=analyzer'));
app.get('/levels.html', (req, res) => res.redirect('/clever/?view=levels&from=levels'));
```

Add these before `express.static`, and still move the old pages to `/legacy/`.
