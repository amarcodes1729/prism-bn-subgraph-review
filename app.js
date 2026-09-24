"use strict";

const MODEL_SPECS = [
  { key: "phase1", label: "Phase 1 trained output", short_label: "Phase 1", file: "data/phase1.json" },
  { key: "phase2_no_complexity", label: "Phase 2 without complexity penalty", short_label: "Phase 2 · no penalty", file: "data/phase2_no_complexity.json" },
  { key: "phase2_complexity", label: "Phase 2 with complexity regularizer", short_label: "Phase 2 · regularized", file: "data/phase2_complexity.json" },
  { key: "gpt6_astra", label: "GPT-6 Astra", short_label: "GPT-6 Astra", file: "data/gpt6_astra.json" },
];
const DATASET_FILE = "data/prism_bn.json";
const sourceRecords = new Map();
const predictionMaps = new Map();
let sharedSourceIds = [];

const FIELD_BY_TAB = {
  overview: "overall_subgraph",
  nodes: "node_accuracy",
  states: "state_accuracy",
  edges: "edge_accuracy",
  cpds: "cpd_accuracy",
};

const TAB_COPY = {
  overview: {
    title: "How accurate is the complete subgraph?",
    detail: "Read the source text first, inspect each graph, and rate whether the full generated subgraph captures the relevant content.",
  },
  nodes: {
    title: "Which concepts became nodes?",
    detail: "Compare the generated node inventory with the source text. Penalize important omissions, merged concepts, and unsupported additions.",
  },
  states: {
    title: "Are the node states supported?",
    detail: "Review every state under its node name. Check that values, categories, dates, quantities, and absence states are attached correctly.",
  },
  edges: {
    title: "Do the directed relationships match?",
    detail: "Inspect every parent → child relationship. Check direction, missing edges, invented edges, and whether the relationship is supported by the source.",
  },
  cpds: {
    title: "Do the probabilities make sense?",
    detail: "Review each conditional probability table against its parent and child states. Score whether the probabilities are plausible and supported by the source.",
  },
};

const state = {
  comparison: null,
  activeTab: "overview",
  review: {},
  dirty: false,
  reviewerName: "",
  drafts: new Map(),
  completedReviews: new Map(),
  csvDownloaded: false,
};

const $ = (selector) => document.querySelector(selector);
const comparisonGrid = $("#comparison-grid");
const searchInput = $("#sample-search");
const searchResults = $("#search-results");

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status})`);
  return response.json();
}

async function loadBundledData() {
  const outputs = await Promise.all(MODEL_SPECS.map((spec) => fetchJson(spec.file)));
  MODEL_SPECS.forEach((spec, index) => {
    const records = outputs[index].bayesian_networks;
    if (!records || typeof records !== "object") throw new Error(`Invalid model data: ${spec.file}`);
    const byParent = new Map();
    for (const [predictionId, record] of Object.entries(records)) {
      if (record.parent_id) byParent.set(record.parent_id, { predictionId, record });
    }
    predictionMaps.set(spec.key, byParent);
  });
  const dataset = (await fetchJson(DATASET_FILE)).bayesian_networks;
  if (!dataset || typeof dataset !== "object") throw new Error(`Invalid source data: ${DATASET_FILE}`);
  for (const [id, record] of Object.entries(dataset)) {
    if (MODEL_SPECS.every((spec) => predictionMaps.get(spec.key).has(id))) {
      sourceRecords.set(id, record);
      sharedSourceIds.push(id);
    }
  }
  if (!sharedSourceIds.length) throw new Error("No sample is shared by all four model outputs.");
}

function recordToGraph(record) {
  const nodes = [], edges = [], cpds = [];
  for (const [name, info] of Object.entries(record.nodes || {})) {
    if (!info || typeof info !== "object") continue;
    nodes.push({ node: name, states: info.states || [], prior: info.prior, level: info.level });
    for (const [parent, parentInfo] of Object.entries(info.parents || {})) {
      edges.push({ parent, child: name });
      cpds.push({ parent, child: name, matrix: parentInfo?.cpd_matrix || [] });
    }
  }
  return { nodes, edges, cpds };
}

function comparisonFor(id) {
  const source = sourceRecords.get(id);
  if (!source) throw new Error(`Comparison ${id} was not found.`);
  const position = sharedSourceIds.indexOf(id);
  return {
    id, ground_truth_id: id, position: position + 1,
    comparison_count: sharedSourceIds.length,
    previous_id: sharedSourceIds[position - 1] || null,
    next_id: sharedSourceIds[position + 1] || null,
    title: source.title || "Untitled", domain: source.domain || "Uncategorized",
    text: source.generated_text || "",
    candidates: MODEL_SPECS.map((spec) => {
      const matched = predictionMaps.get(spec.key).get(id);
      return { model_key: spec.key, label: spec.label, short_label: spec.short_label,
        prediction_id: matched.predictionId, graph: recordToGraph(matched.record) };
    }),
  };
}

async function api(path) {
  const url = new URL(path, location.href);
  if (url.pathname === "/api/health") return { models: MODEL_SPECS, comparison_count: sharedSourceIds.length };
  if (url.pathname === "/api/comparisons/latest") return comparisonFor(sharedSourceIds.at(-1));
  if (url.pathname === "/api/comparisons/random") return comparisonFor(
    sharedSourceIds[Math.floor(Math.random() * sharedSourceIds.length)]);
  if (url.pathname === "/api/comparisons") {
    const needle = (url.searchParams.get("q") || "").toLowerCase().trim();
    const limit = Number(url.searchParams.get("limit")) || 50;
    const comparisons = sharedSourceIds.filter((id) => {
      const source = sourceRecords.get(id);
      return `${id} ${source.title || ""} ${source.domain || ""}`.toLowerCase().includes(needle);
    }).slice(0, limit).map((id) => {
      const source = sourceRecords.get(id);
      return { id, title: source.title || "Untitled", domain: source.domain || "Uncategorized" };
    });
    return { comparisons };
  }
  if (url.pathname.startsWith("/api/comparisons/")) {
    return comparisonFor(decodeURIComponent(url.pathname.slice("/api/comparisons/".length)));
  }
  throw new Error(`Unsupported local request: ${path}`);
}

function showError(message) {
  $("#error-message").textContent = message;
  $("#error-card").hidden = false;
}

function clearError() {
  $("#error-card").hidden = true;
}

function blankReview() {
  const review = {};
  for (const candidate of state.comparison?.candidates || []) {
    review[candidate.model_key] = {
      node_accuracy: null,
      state_accuracy: null,
      edge_accuracy: null,
      cpd_accuracy: null,
      overall_subgraph: null,
    };
  }
  return review;
}

function restoreReview(record) {
  state.review = blankReview();
  if (record?.models) {
    for (const [modelKey, saved] of Object.entries(record.models)) {
      if (!state.review[modelKey]) continue;
      for (const field of Object.values(FIELD_BY_TAB)) {
        if (saved[field] !== undefined) state.review[modelKey][field] = saved[field];
      }
    }
  }
  $("#review-notes").value = record?.notes || "";
  $("#preferred-model").value = record?.preferred_model || "";
}

function draftKey(sourceId = state.comparison?.ground_truth_id) {
  return `${state.reviewerName}\u0000${sourceId || ""}`;
}

function saveDraft() {
  if (!state.reviewerName || !state.comparison || !state.dirty) return;
  state.drafts.set(draftKey(), {
    models: structuredClone(state.review),
    preferred_model: $("#preferred-model").value,
    notes: $("#review-notes").value,
  });
}

function readDraft() {
  return state.drafts.get(draftKey()) || null;
}

function updateReviewer() {
  $("#current-reviewer").textContent = state.reviewerName || "—";
  $("#name-overlay").hidden = Boolean(state.reviewerName);
}

function populatePreference() {
  const select = $("#preferred-model");
  select.querySelectorAll("option[data-model]").forEach((option) => option.remove());
  for (const candidate of state.comparison.candidates) {
    const option = document.createElement("option");
    option.value = candidate.model_key;
    option.textContent = candidate.label;
    option.dataset.model = "true";
    select.append(option);
  }
}

async function setComparison(comparison) {
  state.comparison = comparison;
  state.review = blankReview();
  state.dirty = false;
  clearError();
  closeDrawer();
  searchResults.hidden = true;
  searchInput.value = "";

  $("#source-title").textContent = comparison.title || "Untitled";
  $("#source-meta").textContent = `${comparison.domain || "Uncategorized"} · ${comparison.ground_truth_id}`;
  $("#source-text").textContent = comparison.text || "No source text was stored.";
  $("#source-position").textContent = `Sample ${comparison.position} of ${comparison.comparison_count}`;
  $("#char-count").textContent = `${(comparison.text || "").length.toLocaleString()} characters`;
  $("#previous-button").disabled = !comparison.previous_id;
  $("#next-button").disabled = !comparison.next_id;
  $("#workspace-title").textContent = comparison.title || "Generated networks";
  $("#save-status").textContent = "";
  $("#review-layout").hidden = false;
  populatePreference();
  const draft = readDraft();
  const saved = state.completedReviews.get(draftKey());
  restoreReview(draft || saved || null);
  if (draft) {
    state.dirty = true;
    $("#save-status").textContent = "Restored your in-memory draft.";
  } else if (saved) {
    $("#save-status").textContent = "This review is already included in your CSV.";
  }

  renderActiveTab();
  updateCompletion();
}

async function loadComparison(path, trigger) {
  saveDraft();
  if (trigger) trigger.disabled = true;
  clearError();
  try {
    await setComparison(await api(path));
  } catch (error) {
    showError(error.message);
  } finally {
    if (trigger) trigger.disabled = false;
  }
}

let searchTimer;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const query = searchInput.value.trim();
  if (!query) {
    searchResults.hidden = true;
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const payload = await api(`/api/comparisons?q=${encodeURIComponent(query)}&limit=50`);
      searchResults.replaceChildren();
      for (const item of payload.comparisons) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-result";
        const title = document.createElement("strong");
        title.textContent = item.title;
        const detail = document.createElement("span");
        detail.textContent = `${item.domain} · ${item.id}`;
        button.append(title, detail);
        button.addEventListener("click", () => loadComparison(
          `/api/comparisons/${encodeURIComponent(item.id)}`,
          button,
        ));
        searchResults.append(button);
      }
      if (!payload.comparisons.length) {
        const empty = document.createElement("div");
        empty.className = "search-empty";
        empty.textContent = "No shared samples found.";
        searchResults.append(empty);
      }
      searchResults.hidden = false;
    } catch (error) {
      showError(error.message);
    }
  }, 200);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-wrap")) searchResults.hidden = true;
});

function graphLayout(graph) {
  const nodes = graph.nodes || [];
  const names = new Set(nodes.map((node) => node.node));
  const indegree = new Map(nodes.map((node) => [node.node, 0]));
  const children = new Map(nodes.map((node) => [node.node, []]));
  for (const edge of graph.edges || []) {
    if (!names.has(edge.parent) || !names.has(edge.child)) continue;
    indegree.set(edge.child, (indegree.get(edge.child) || 0) + 1);
    children.get(edge.parent).push(edge.child);
  }
  const levels = new Map();
  const queue = nodes.filter((node) => indegree.get(node.node) === 0).map((node) => node.node);
  for (const name of queue) levels.set(name, 0);
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    for (const child of children.get(current) || []) {
      levels.set(child, Math.max(levels.get(child) || 0, (levels.get(current) || 0) + 1));
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) queue.push(child);
    }
  }
  const fallback = levels.size ? Math.max(...levels.values()) + 1 : 0;
  for (const node of nodes) if (!levels.has(node.node)) levels.set(node.node, fallback);

  const groups = new Map();
  for (const node of nodes) {
    const level = levels.get(node.node);
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(node.node);
  }
  const nodeW = 176;
  const nodeH = 62;
  const xGap = 64;
  const yGap = 28;
  const margin = 34;
  const columns = [...groups.keys()].sort((a, b) => a - b);
  const maxRows = Math.max(1, ...[...groups.values()].map((group) => group.length));
  const width = Math.max(500, margin * 2 + columns.length * nodeW + Math.max(0, columns.length - 1) * xGap);
  const height = Math.max(350, margin * 2 + maxRows * nodeH + Math.max(0, maxRows - 1) * yGap);
  const positions = new Map();
  columns.forEach((level, column) => {
    const group = groups.get(level);
    const groupHeight = group.length * nodeH + Math.max(0, group.length - 1) * yGap;
    const yStart = (height - groupHeight) / 2;
    group.forEach((name, row) => positions.set(name, {
      x: margin + column * (nodeW + xGap),
      y: yStart + row * (nodeH + yGap),
    }));
  });
  return { width, height, positions, nodeW, nodeH };
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function shortText(text, maxLength) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function createGraphSvg(candidate, modelIndex) {
  const graph = candidate.graph;
  const layout = graphLayout(graph);
  const svg = svgElement("svg", {
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    width: layout.width,
    height: layout.height,
    role: "img",
    "aria-label": `${candidate.label} Bayesian network`,
  });
  const markerId = `arrow-${candidate.model_key}`;
  const defs = svgElement("defs");
  const marker = svgElement("marker", {
    id: markerId,
    markerWidth: 9,
    markerHeight: 7,
    refX: 8,
    refY: 3.5,
    orient: "auto",
    markerUnits: "strokeWidth",
  });
  marker.append(svgElement("path", { d: "M0,0 L9,3.5 L0,7 Z", fill: "#78817d" }));
  defs.append(marker);
  svg.append(defs);

  const edges = svgElement("g", { "aria-hidden": "true" });
  for (const edge of graph.edges || []) {
    const from = layout.positions.get(edge.parent);
    const to = layout.positions.get(edge.child);
    if (!from || !to) continue;
    const x1 = from.x + layout.nodeW;
    const y1 = from.y + layout.nodeH / 2;
    const x2 = to.x;
    const y2 = to.y + layout.nodeH / 2;
    const bend = Math.max(30, Math.abs(x2 - x1) * 0.42);
    edges.append(svgElement("path", {
      class: "edge-path",
      d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
      "marker-end": `url(#${markerId})`,
    }));
  }
  svg.append(edges);

  for (const node of graph.nodes || []) {
    const position = layout.positions.get(node.node);
    if (!position) continue;
    const group = svgElement("g", {
      class: "network-node",
      tabindex: "0",
      role: "button",
      "aria-label": `Inspect ${node.node}`,
    });
    group.setAttribute("transform", `translate(${position.x} ${position.y})`);
    group.append(svgElement("rect", { width: layout.nodeW, height: layout.nodeH, rx: 5 }));
    group.append(svgElement("circle", { cx: 15, cy: 18, r: 3.5 }));
    const title = svgElement("text", { x: 27, y: 22, class: "node-title" });
    title.textContent = shortText(node.node, 22);
    const states = Array.isArray(node.states) ? node.states : [];
    const stateLine = svgElement("text", { x: 15, y: 44, class: "node-state" });
    stateLine.textContent = shortText(`${states.length} states · ${states.slice(0, 2).join(", ")}`, 30);
    group.append(title, stateLine);
    const open = () => openNodeDrawer(candidate, node.node, modelIndex);
    group.addEventListener("click", open);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    svg.append(group);
  }
  return svg;
}

function createModelCard(candidate, modelIndex) {
  const card = document.createElement("article");
  card.className = `model-card model-${modelIndex + 1}`;
  const header = document.createElement("header");
  header.className = "model-card-head";
  const number = document.createElement("span");
  number.className = "model-number";
  number.textContent = String(modelIndex + 1).padStart(2, "0");
  const heading = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = candidate.label;
  const id = document.createElement("span");
  id.className = "prediction-id";
  id.textContent = candidate.prediction_id;
  heading.append(title, id);
  header.append(number, heading);
  if (state.activeTab !== "overview") {
    const metric = document.createElement("span");
    metric.className = "section-total";
    if (state.activeTab === "nodes") metric.textContent = `${candidate.graph.nodes?.length || 0} generated`;
    if (state.activeTab === "states") {
      const count = (candidate.graph.nodes || []).reduce((total, node) => total + (node.states?.length || 0), 0);
      metric.textContent = `${count} generated`;
    }
    if (state.activeTab === "edges") metric.textContent = `${candidate.graph.edges?.length || 0} generated`;
    if (state.activeTab === "cpds") metric.textContent = `${candidate.graph.cpds?.length || 0} tables`;
    header.append(metric);
  }

  const body = document.createElement("div");
  body.className = "model-card-body";
  if (state.activeTab === "overview") renderOverview(body, candidate, modelIndex);
  if (state.activeTab === "nodes") renderNodes(body, candidate.graph);
  if (state.activeTab === "states") renderStates(body, candidate.graph);
  if (state.activeTab === "edges") renderEdges(body, candidate.graph);
  if (state.activeTab === "cpds") renderCpds(body, candidate.graph);

  card.append(header, body);
  card.append(createEvaluationControl(candidate));
  return card;
}

function renderOverview(container, candidate, modelIndex) {
  const stats = document.createElement("div");
  stats.className = "graph-stats";
  const values = [
    [candidate.graph.nodes?.length || 0, "nodes"],
    [(candidate.graph.nodes || []).reduce((total, node) => total + (node.states?.length || 0), 0), "states"],
    [candidate.graph.edges?.length || 0, "edges"],
    [candidate.graph.cpds?.length || 0, "CPDs"],
  ];
  for (const [value, label] of values) {
    const stat = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = value;
    stat.append(strong, document.createTextNode(label));
    stats.append(stat);
  }
  const canvas = document.createElement("div");
  canvas.className = "network-canvas";
  canvas.append(createGraphSvg(candidate, modelIndex));
  container.append(stats, canvas);
}

function emptyMessage(text) {
  const empty = document.createElement("div");
  empty.className = "empty-message";
  empty.textContent = text;
  return empty;
}

function renderNodes(container, graph) {
  const list = document.createElement("ol");
  list.className = "inventory-list";
  for (const node of graph.nodes || []) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = node.node;
    const meta = document.createElement("span");
    meta.textContent = `${node.states?.length || 0} states · level ${node.level ?? "—"}`;
    item.append(name, meta);
    list.append(item);
  }
  container.append(list.children.length ? list : emptyMessage("No nodes were generated."));
}

function renderStates(container, graph) {
  const stack = document.createElement("div");
  stack.className = "state-stack";
  for (const node of graph.nodes || []) {
    const block = document.createElement("section");
    block.className = "state-block";
    const title = document.createElement("h4");
    title.textContent = node.node;
    const chips = document.createElement("div");
    chips.className = "state-list";
    for (const value of node.states || []) {
      const chip = document.createElement("span");
      chip.textContent = value;
      chips.append(chip);
    }
    if (!chips.children.length) chips.append(emptyMessage("No states"));
    block.append(title, chips);
    stack.append(block);
  }
  container.append(stack.children.length ? stack : emptyMessage("No nodes or states were generated."));
}

function renderEdges(container, graph) {
  const list = document.createElement("ol");
  list.className = "inventory-list edge-list";
  for (const edge of graph.edges || []) {
    const item = document.createElement("li");
    const relation = document.createElement("strong");
    relation.append(
      document.createTextNode(edge.parent),
      Object.assign(document.createElement("span"), { textContent: "→" }),
      document.createTextNode(edge.child),
    );
    item.append(relation);
    list.append(item);
  }
  container.append(list.children.length ? list : emptyMessage("No directed edges were generated."));
}

function formatProbability(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")
    : String(value ?? "—");
}

function tableCell(text, tag = "td") {
  const cell = document.createElement(tag);
  cell.textContent = text;
  return cell;
}

function createCpdTable(graph, childNode, cpd) {
  const block = document.createElement("section");
  block.className = "cpd-block";
  const title = document.createElement("h4");
  title.append(
    document.createTextNode(cpd.parent),
    Object.assign(document.createElement("span"), { textContent: "→" }),
    document.createTextNode(cpd.child),
  );
  const scroller = document.createElement("div");
  scroller.className = "cpd-scroll";
  const table = document.createElement("table");
  table.className = "cpd-table";
  const parentNode = (graph.nodes || []).find((node) => node.node === cpd.parent);
  const parentStates = parentNode?.states || [];
  const childStates = childNode.states || [];
  const header = document.createElement("tr");
  header.append(tableCell("Child ↓ / Parent →", "th"));
  for (const value of parentStates) header.append(tableCell(value, "th"));
  const thead = document.createElement("thead");
  thead.append(header);
  const tbody = document.createElement("tbody");
  const matrix = Array.isArray(cpd.matrix) ? cpd.matrix : [];
  const rowCount = Math.max(childStates.length, matrix.length);
  for (let row = 0; row < rowCount; row++) {
    const tr = document.createElement("tr");
    tr.append(tableCell(childStates[row] ?? `state ${row + 1}`, "th"));
    const values = Array.isArray(matrix[row]) ? matrix[row] : [];
    const columns = Math.max(parentStates.length, values.length);
    for (let column = 0; column < columns; column++) {
      tr.append(tableCell(formatProbability(values[column])));
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  scroller.append(table);
  block.append(title, scroller);
  return block;
}

function renderCpds(container, graph) {
  const cpds = graph.cpds || [];
  for (const cpd of cpds) {
    const child = (graph.nodes || []).find((node) => node.node === cpd.child);
    if (child) container.append(createCpdTable(graph, child, cpd));
  }
  if (!cpds.length) container.append(emptyMessage("No conditional probability tables were generated."));
}

function createEvaluationControl(candidate) {
  const modelReview = state.review[candidate.model_key];
  const wrapper = document.createElement("div");
  wrapper.className = "evaluation-control";
  const field = FIELD_BY_TAB[state.activeTab];
  const label = document.createElement("label");
  label.htmlFor = `${field}-${candidate.model_key}`;
  label.className = "match-label";
  const copy = document.createElement("span");
  copy.textContent = state.activeTab === "overview" ? "Overall subgraph score" :
    `${state.activeTab === "cpds" ? "CPD" : state.activeTab.slice(0, -1)} accuracy`;
  const hint = document.createElement("small");
  hint.textContent = "1 = poor, 5 = excellent; decimals allowed";
  const input = document.createElement("input");
  input.id = `${field}-${candidate.model_key}`;
  input.type = "number";
  input.min = "1";
  input.max = "5";
  input.step = "any";
  input.inputMode = "decimal";
  input.placeholder = "Score 1–5";
  input.value = modelReview[field] ?? "";
  input.addEventListener("input", () => {
    modelReview[field] = input.value === "" ? null : Number(input.value);
    markEdited();
  });
  label.append(copy, hint, input);
  wrapper.append(label);
  return wrapper;
}

function renderActiveTab() {
  if (!state.comparison) return;
  document.querySelectorAll(".compare-tab").forEach((button) => {
    const active = button.dataset.tab === state.activeTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const copy = TAB_COPY[state.activeTab];
  $("#tab-intro").replaceChildren();
  const title = document.createElement("strong");
  title.textContent = copy.title;
  const detail = document.createElement("span");
  detail.textContent = copy.detail;
  $("#tab-intro").append(title, detail);

  comparisonGrid.replaceChildren();
  comparisonGrid.className = `comparison-grid tab-${state.activeTab}`;
  state.comparison.candidates.forEach((candidate, index) => {
    comparisonGrid.append(createModelCard(candidate, index));
  });
}

function answeredCount() {
  let count = 0;
  for (const review of Object.values(state.review)) {
    for (const field of Object.values(FIELD_BY_TAB)) {
      if (review[field] !== null && review[field] !== "") count += 1;
    }
  }
  return count;
}

function isComplete() {
  if (!state.comparison || !state.reviewerName
      || Object.keys(state.review).length !== state.comparison.candidates.length) return false;
  const validPreference = $("#preferred-model").value === "no_preference"
    || state.comparison.candidates.some((item) => item.model_key === $("#preferred-model").value);
  return validPreference && Object.values(state.review).every((review) =>
    Object.values(FIELD_BY_TAB).every((field) =>
      Number.isFinite(review[field]) && review[field] >= 1 && review[field] <= 5));
}

function updateCompletion() {
  const count = answeredCount();
  const total = state.comparison ? state.comparison.candidates.length * Object.keys(FIELD_BY_TAB).length : 20;
  $("#completion-pill").textContent = `${count} of ${total} scores`;
  $("#completion-pill").classList.toggle("complete", count === total && isComplete());
  $("#save-review").disabled = !isComplete();
}

function markEdited() {
  state.dirty = true;
  $("#save-status").textContent = "";
  saveDraft();
  updateCompletion();
}

function saveReview() {
  if (!isComplete()) {
    $("#save-status").textContent = "Enter your name, all 20 scores, and a model preference before saving.";
    return;
  }
  const when = new Date();
  const record = {
    timestamp: when.toISOString(), reviewer_name: state.reviewerName,
    source_id: state.comparison.ground_truth_id,
    title: state.comparison.title, domain: state.comparison.domain,
    preferred_model: $("#preferred-model").value,
    models: structuredClone(state.review),
    predictions: Object.fromEntries(state.comparison.candidates.map((candidate) =>
      [candidate.model_key, candidate.prediction_id])),
    notes: $("#review-notes").value,
  };
  state.completedReviews.set(draftKey(), record);
  state.drafts.delete(draftKey());
  state.dirty = false;
  state.csvDownloaded = false;
  $("#download-csv").disabled = false;
  $("#save-status").textContent = `Added ${state.completedReviews.size} comparison(s). Download CSV before closing this tab.`;
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv() {
  if (!state.completedReviews.size) return;
  const columns = ["reviewer_name", "timestamp_utc", "source_id", "title", "domain",
    "preferred_model", "model_key", "model_label", "prediction_id", "node_accuracy",
    "state_accuracy", "edge_accuracy", "cpd_accuracy", "overall_subgraph", "notes"];
  const rows = [columns];
  for (const record of state.completedReviews.values()) {
    for (const spec of MODEL_SPECS) {
      const scores = record.models[spec.key];
      rows.push([record.reviewer_name, record.timestamp, record.source_id,
        record.title, record.domain, record.preferred_model, spec.key, spec.label,
        record.predictions[spec.key], scores.node_accuracy, scores.state_accuracy,
        scores.edge_accuracy, scores.cpd_accuracy, scores.overall_subgraph, record.notes]);
    }
  }
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `prism_subgraph_reviews_${new Date().toISOString().replaceAll(/[:.]/g, "-")}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  state.csvDownloaded = true;
  $("#save-status").textContent = `Downloaded ${state.completedReviews.size} comparison(s), with one CSV row per model.`;
}

function openNodeDrawer(candidate, nodeName, modelIndex) {
  const graph = candidate.graph;
  const node = (graph.nodes || []).find((item) => item.node === nodeName);
  if (!node) return;
  $("#drawer-option").textContent = `${String(modelIndex + 1).padStart(2, "0")} · ${candidate.label}`;
  $("#drawer-title").textContent = nodeName;
  const content = $("#drawer-content");
  content.replaceChildren();

  const statesTitle = document.createElement("div");
  statesTitle.className = "details-label";
  statesTitle.textContent = `States (${node.states?.length || 0})`;
  const states = document.createElement("div");
  states.className = "state-list";
  for (const value of node.states || []) {
    const chip = document.createElement("span");
    chip.textContent = value;
    states.append(chip);
  }
  content.append(statesTitle, states);

  const incoming = (graph.cpds || []).filter((cpd) => cpd.child === nodeName);
  const cpdTitle = document.createElement("div");
  cpdTitle.className = "details-label";
  cpdTitle.textContent = `Incoming CPDs (${incoming.length})`;
  content.append(cpdTitle);
  if (!incoming.length) content.append(emptyMessage("No incoming CPD is stored for this node."));
  for (const cpd of incoming) content.append(createCpdTable(graph, node, cpd));

  $("#node-drawer").classList.add("open");
  $("#node-drawer").setAttribute("aria-hidden", "false");
  $("#scrim").hidden = false;
  $("#drawer-close").focus();
}

function closeDrawer() {
  $("#node-drawer").classList.remove("open");
  $("#node-drawer").setAttribute("aria-hidden", "true");
  $("#scrim").hidden = true;
}

async function initialize() {
  updateReviewer();
  document.querySelectorAll(".compare-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      renderActiveTab();
    });
  });
  try {
    await loadBundledData();
    const health = await api("/api/health");
    $("#status-dot").classList.add("live");
    $("#model-status").textContent = `${health.models.length} models · ${health.comparison_count} shared samples`;
    await loadComparison("/api/comparisons/latest");
  } catch (error) {
    $("#model-status").textContent = "Bundled data unavailable";
    showError(error.message);
  }
}

$("#random-button").addEventListener("click", (event) => loadComparison("/api/comparisons/random", event.currentTarget));
$("#previous-button").addEventListener("click", (event) => {
  if (state.comparison?.previous_id) {
    loadComparison(`/api/comparisons/${encodeURIComponent(state.comparison.previous_id)}`, event.currentTarget);
  }
});
$("#next-button").addEventListener("click", (event) => {
  if (state.comparison?.next_id) {
    loadComparison(`/api/comparisons/${encodeURIComponent(state.comparison.next_id)}`, event.currentTarget);
  }
});
$("#save-review").addEventListener("click", saveReview);
$("#download-csv").addEventListener("click", downloadCsv);
$("#review-notes").addEventListener("input", markEdited);
$("#preferred-model").addEventListener("change", markEdited);
$("#name-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#reviewer-name").value.trim();
  if (!name) return;
  saveDraft();
  state.reviewerName = name;
  updateReviewer();
  if (state.comparison) await setComparison(state.comparison);
});
$("#change-reviewer").addEventListener("click", () => {
  saveDraft();
  state.reviewerName = "";
  $("#reviewer-name").value = "";
  updateReviewer();
  $("#reviewer-name").focus();
});
$("#drawer-close").addEventListener("click", closeDrawer);
$("#scrim").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
});
window.addEventListener("beforeunload", (event) => {
  if (!state.dirty && (state.csvDownloaded || !state.completedReviews.size)) return;
  event.preventDefault();
  event.returnValue = "";
});

initialize();
