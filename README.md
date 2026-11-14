# memory-match-cube

The classic Memory card matching game set up on the sides of a cube! Click and drag to rotate the
cube, click to reveal a card, then try to find the match — on the same side, or possibly a
different side, edge, or corner.

## Play

- **Online:** https://bryanherger.github.io/memory-match-cube/ (GitHub Pages)
- **Older mirror:** https://www.woodsidelabs.com/games/mmcube/

## Run it locally

The game is a static site, but it uses ES modules, which browsers refuse to load from `file://`.
Serve the folder over HTTP instead:

```bash
cd memory-match-cube
python3 -m http.server 8000
# then open http://localhost:8000/
```

Any static file server works (`npx serve`, `php -S localhost:8000`, nginx, …).

## Options

Everything is stored in the URL, so a game can be bookmarked or shared:

| Parameter | Values | Default | Meaning |
| --- | --- | --- | --- |
| `cube_size` | `3`, `4`, `5` | `4` | Tiles per edge |
| `cube_scale` | `3`, `4`, `5` | `4` | Easy / Medium / Hard (number of distinct tile faces) |
| `cube_style` | `num`, `sym`, `pic` | `num` | Numbers, playing cards, pictures |
| `resetwait` | milliseconds | `1000` | How long a wrong pair stays visible |

Example: `?cube_size=5&cube_scale=5&cube_style=pic`.

The Options menu in the top bar edits the same parameters.

## Project layout

```
index.html              the whole UI: styles, HUD, dialogs, import map
js/app.js               game logic (ES module)
js/vendor/              three.js r187 + OrbitControls, vendored for offline/static hosting
textures/               tile art: num_*.jpg, sym_*.jpg, pic_*.jpg
.github/workflows/      GitHub Pages deployment
```

`index.html` is the single entry point. There is no build step and no npm dependency — three.js is
vendored under `js/vendor/` and resolved with an import map, so the site is fully static and works on
any host, including GitHub Pages, without network access to a CDN.

### Updating three.js

```bash
npm pack three@<version>
tar xzf three-<version>.tgz
cp package/build/three.module.js package/build/three.core.js js/vendor/
cp package/examples/jsm/controls/OrbitControls.js js/vendor/addons/
```

Then load the page and check the browser console: three.js warns about any API removed in the new
revision, and `window.mmcube.revision` reports the loaded one.

## Deploying to GitHub Pages

`.github/workflows/pages.yml` publishes the repository root as a Pages artifact on every push to
`master`. One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Because the site is plain static files, deploying by hand also works: copy `index.html`, `js/`, and
`textures/` to any web root.

## Debugging

The app exposes a small read-mostly handle in the console:

```js
mmcube.status()            // tiles left, lock state, per-tile states
mmcube.config              // parsed options
mmcube.tileIndexAt(x, y)   // which tile is under a viewport point
mmcube.revision            // three.js revision in use
```

## Issues and contributions

Please submit bugs and feature requests here, and also fork and submit pull requests if you want to
improve the game.

## Thanks

This project is built on [three.js](https://github.com/mrdoob/three.js) (MIT). Original game by
Bryan Herger and Woodside Labs, BSD 3-Clause (see `LICENSE`).
