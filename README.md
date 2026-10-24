# mixing-floor.github.io

Project page for **The Compute Floor of Data Mixing: When Loss-Based Reweighters Start to Drain Easy Synthetic Text**
(Shayan Salehi, Iman Mohammadi; MOSS Workshop at COLM 2026). Live at <https://mixing-floor.github.io>.

Code and released results: [mixing-floor/compute-floor](https://github.com/mixing-floor/compute-floor).

## Layout

```
index.html                 the page
assets/css/style.css       design tokens (light + dark) and layout
assets/js/main.js          interactive figures (d3 7.9, KaTeX 0.16 from cdnjs)
assets/data/results.json   every number the figures show, built from compute-floor/Results
assets/paper/              the camera-ready PDF
assets/img/                favicon and social-preview card
scripts/build_data.py      rebuilds results.json from the released results
```

The site is static: no build step and no Jekyll (`.nojekyll`). GitHub Pages serves it from `main` / root.

## Updating the data

The figures never hard-code results. After any change to `compute-floor/Results`, rebuild the data file:

```bash
python scripts/build_data.py --results ../compute-floor/Results
```

When the paper changes, replace `assets/paper/compute-floor-moss2026.pdf` with the new PDF.

## Preview locally

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. The page fetches `results.json`, so opening `index.html` straight from disk will not load the charts.

## Colour

Method colours encode the paper's families: warm hues for loss-monotone methods (Group-DRO, DoReMi-style), cool hues for interaction and gradient methods (Aioli, DoGE), orchid for the hybrid Skill-It, and dashed grey for the Stratified control. Both the light and the dark set pass all-pairs colour-vision-deficiency checks. The one dark-mode pair in the 6 to 8 ΔE band (DoGE / Skill-It) is backed by secondary encoding: every method also has its own marker shape, a direct label, a legend entry and a table view.
