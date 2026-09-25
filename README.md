# PRISM-BN backbone and subgraph review for GitHub Pages

This folder is a complete static site. Upload **the contents of this folder** to
the root of a new GitHub repository, then select **Settings → Pages → Deploy from
a branch → main → /(root)**. GitHub Pages will serve `index.html`.

The site needs no Python server, build step, API key, or external service. The
subgraph reviewer is at `/`; the backbone reviewer is at `/backbone/`.

The subgraph reviewer uses five JSON files included in `data/`:

- `prism_bn.json`: source text and source subgraphs
- `phase1.json`: Phase 1 predictions
- `phase2_no_complexity.json`: Phase 2 predictions without the complexity penalty
- `phase2_complexity.json`: Phase 2 regularized predictions
- `gpt6_astra.json`: GPT-6 Astra predictions

The source JSON is about 77 MB, so the first load can take a while. The browser
shows the ten shared source subgraphs with the highest average node, state, and
directed-edge F1 agreement across all four models. Names and states are matched
without regard to case or repeated whitespace; ties use source ID order. Every model
gets 1–5 node, state, edge, CPD, and overall subgraph scores; decimals are
allowed. Reviewers choose a preferred model or a tie and can add notes.

**Add review** keeps the review in the current browser tab. **Download CSV**
exports all added reviews from that tab, one row per model and sample, with a
column for each scoring tab. Names, scores, preferences, and notes are not sent
to a server or stored across reloads. Download the CSV before closing or
reloading the tab.

The backbone reviewer bundles ten GPT-5.6 round-trip cases from the
`20260925T141007Z` run named in `gpt56_text_roundtrip_64873621.log`. Selection
requires complete node, state, and edge coverage, then sorts by the judge's
1–5 graph agreement score. Ties prefer greater CPD cell coverage, lower CPD
mean absolute error, and backbone ID. The case list is in
`backbone/data/top_cases.json`. It shows
the original text, ground-truth backbone, generated backbone, and generated
text through matching **Overall**, **Nodes**, **States**, and **Edges** tabs. It
then exports the five continuous criteria, the separate 1–5 text score, and
the optional reason to CSV.

Download each CSV before closing or reloading its tab. GitHub Pages does not
store review inputs.
