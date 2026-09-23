# PRISM-BN subgraph review for GitHub Pages

This folder is a complete static site. Upload **the contents of this folder** to
the root of a new GitHub repository, then select **Settings → Pages → Deploy from
a branch → main → /(root)**. GitHub Pages will serve `index.html`.

The site needs no Python server, build step, API key, or external service. Its
five JSON files are included in `data/`:

- `prism_bn.json`: source text and source subgraphs
- `phase1.json`: Phase 1 predictions
- `phase2_no_complexity.json`: Phase 2 predictions without the complexity penalty
- `phase2_complexity.json`: Phase 2 regularized predictions
- `gpt6_astra.json`: GPT-6 Astra predictions

The source JSON is about 77 MB, so the first load can take a while. The browser
shows only source subgraphs with predictions from all four models. Every model
gets 1–5 node, state, edge, CPD, and overall subgraph scores; decimals are
allowed. Reviewers choose a preferred model or a tie and can add notes.

**Add review** keeps the review in the current browser tab. **Download CSV**
exports all added reviews from that tab, one row per model and sample, with a
column for each scoring tab. Names, scores, preferences, and notes are not sent
to a server or stored across reloads. Download the CSV before closing or
reloading the tab.
