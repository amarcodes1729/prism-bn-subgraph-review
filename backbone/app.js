"use strict";

const CRITERIA = ["nodes", "states", "edges", "relationship_type", "overall_similarity"];
const TAB_COPY = {
  overall: ["Overall fidelity", "Read both texts first. Judge whether the generated text preserves the original meaning, scope, important facts, and qualifiers."],
  nodes: ["Node coverage", "Compare the two node inventories. Look for omitted, merged, renamed, or invented concepts."],
  states: ["State coverage", "Compare states under each node. Check values, categories, dates, quantities, and explicit absence states."],
  edges: ["Relationships and type", "Compare every parent → child relationship. Check direction, omission, invention, and whether the relationship type is preserved."],
};
const $ = (id) => document.getElementById(id);
const state = { cases: [], byId: new Map(), sources: new Map(), current: null, reviewer: "", reviews: [] };

function show(message, error = false) {
  $("status").textContent = message;
  $("status").style.color = error ? "#a52f26" : "#126d45";
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function graphFromRaw(raw) {
  return { nodes: raw.nodes || [], edges: raw.edges || [], joints: raw.joints || [] };
}

function renderNodes(targetId, nodes) {
  const target = $(targetId);
  target.replaceChildren();
  for (const node of nodes || []) {
    const block = document.createElement("div");
    block.className = "inventory-group";
    const title = document.createElement("strong");
    title.textContent = node.node || node.name || "Unnamed node";
    block.append(title);
    target.append(block);
  }
  if (!target.children.length) target.textContent = "No nodes were supplied.";
}

function renderStates(targetId, nodes) {
  const target = $(targetId);
  target.replaceChildren();
  for (const node of nodes || []) {
    const block = document.createElement("div");
    block.className = "inventory-group";
    const title = document.createElement("strong");
    title.textContent = node.node || node.name || "Unnamed node";
    block.append(title);
    for (const value of node.states || []) {
      const chip = document.createElement("span");
      chip.textContent = value;
      block.append(chip);
    }
    target.append(block);
  }
  if (!target.children.length) target.textContent = "No states were supplied.";
}

function renderEdges(targetId, edges) {
  const target = $(targetId);
  target.replaceChildren();
  for (const edge of edges || []) {
    const item = document.createElement("div");
    item.className = "edge-item";
    item.append(document.createTextNode(edge.parent || "?"));
    const arrow = document.createElement("strong");
    arrow.textContent = "→";
    item.append(arrow, document.createTextNode(edge.child || "?"));
    target.append(item);
  }
  if (!target.children.length) target.textContent = "No directed relationships were supplied.";
}

function setTab(tab) {
  for (const button of document.querySelectorAll(".review-tab")) {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    panel.classList.toggle("active", panel.id === `${tab}-panel`);
  }
  $("tab-title").textContent = TAB_COPY[tab][0];
  $("tab-instruction").textContent = TAB_COPY[tab][1];

  const visible = tab === "overall"
    ? ["overall_similarity", "text-score"]
    : tab === "nodes" ? ["nodes"]
      : tab === "states" ? ["states"]
        : ["edges", "relationship_type"];
  for (const label of document.querySelectorAll(".scores label")) {
    const input = label.querySelector("input");
    label.hidden = !visible.includes(input.dataset.score || input.id);
  }
}

async function loadData() {
  const summary = await (await fetch("data/summary.json")).json();
  state.cases = summary.completed || [];
  const sourceText = await (await fetch("data/source_backbones.jsonl")).text();
  for (const line of sourceText.split(/\r?\n/)) {
    if (line.trim()) {
      const record = JSON.parse(line);
      state.sources.set(record.id, record);
    }
  }
  for (const item of state.cases) {
    const folder = `data/cases/${encodeURIComponent(item.backbone_id)}`;
    const [evaluation, prediction, generated] = await Promise.all([
      fetch(`${folder}/evaluation.json`).then((response) => response.json()),
      fetch(`${folder}/prediction.json`).then((response) => response.json()),
      fetch(`${folder}/generated_text.txt`).then((response) => response.text()),
    ]);
    state.byId.set(item.backbone_id, { evaluation, prediction, generated });
  }
  if (!state.cases.length) throw new Error("No completed backbone cases were bundled.");
  for (const item of state.cases) {
    const option = document.createElement("option");
    option.value = item.backbone_id;
    option.textContent = `${item.backbone_id} — ${state.sources.get(item.source_id)?.title || item.source_id}`;
    $("case").append(option);
  }
  loadCase(state.cases[0].backbone_id);
}

function loadCase(caseId) {
  state.current = state.cases.find((item) => item.backbone_id === caseId);
  const data = state.byId.get(caseId);
  const source = state.sources.get(state.current.source_id);
  $("case").value = caseId;
  $("title").textContent = source?.title || caseId;
  $("source-id").textContent = state.current.source_id;
  const index = state.cases.indexOf(state.current);
  $("position").textContent = `Case ${index + 1} of ${state.cases.length}`;
  $("previous").disabled = index === 0;
  $("next").disabled = index === state.cases.length - 1;
  $("original").textContent = source?.text || "Original text unavailable";
  $("generated").textContent = data.generated;
  $("truth").textContent = JSON.stringify(graphFromRaw(source || {}), null, 2);
  $("prediction").textContent = JSON.stringify(data.prediction, null, 2);
  renderNodes("truth-nodes", source?.nodes);
  renderNodes("prediction-nodes", data.prediction.nodes);
  renderStates("truth-states", source?.nodes);
  renderStates("prediction-states", data.prediction.nodes);
  renderEdges("truth-edges", source?.edges);
  renderEdges("prediction-edges", data.prediction.edges);
  for (const input of document.querySelectorAll("[data-score], #text-score, #reason")) input.value = "";
  const prior = state.reviews.find((review) => review.backbone_id === caseId && review.reviewer_name === state.reviewer);
  if (prior) restore(prior);
  setTab("overall");
}

function restore(review) {
  for (const name of CRITERIA) document.querySelector(`[data-score="${name}"]`).value = review[name];
  $("text-score").value = review.text_score_1_to_5;
  $("reason").value = review.reason || "";
}

function addReview() {
  state.reviewer = $("reviewer").value.trim();
  if (!state.reviewer) {
    show("Enter your reviewer name first.", true);
    $("reviewer").focus();
    return;
  }
  const values = Object.fromEntries(CRITERIA.map((name) => [name, Number(document.querySelector(`[data-score="${name}"]`).value)]));
  const textScore = Number($("text-score").value);
  if (CRITERIA.some((name) => !Number.isFinite(values[name]) || values[name] < 0 || values[name] > 1)
      || !Number.isFinite(textScore) || textScore < 1 || textScore > 5) {
    show("Enter all five 0–1 criterion scores and a 1–5 text score.", true);
    return;
  }
  const record = {
    reviewer_name: state.reviewer,
    timestamp_utc: new Date().toISOString(),
    backbone_id: state.current.backbone_id,
    source_id: state.current.source_id,
    title: $("title").textContent,
    ...values,
    text_score_1_to_5: textScore,
    reason: $("reason").value.trim(),
  };
  const old = state.reviews.findIndex((item) => item.backbone_id === record.backbone_id && item.reviewer_name === state.reviewer);
  if (old >= 0) state.reviews.splice(old, 1);
  state.reviews.push(record);
  $("download").disabled = false;
  $("review-status").textContent = `${state.reviews.length} review(s) ready for CSV download.`;
  show("Review added in this browser tab.");
}

function downloadCsv() {
  const columns = ["reviewer_name", "timestamp_utc", "backbone_id", "source_id", "title", ...CRITERIA, "text_score_1_to_5", "reason"];
  const rows = [columns, ...state.reviews.map((item) => columns.map((column) => item[column]))];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = `prism_backbone_reviews_${new Date().toISOString().replaceAll(/[:.]/g, "-")}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  show(`Downloaded ${state.reviews.length} review(s).`);
}

for (const button of document.querySelectorAll(".review-tab")) button.addEventListener("click", () => setTab(button.dataset.tab));
$("reviewer").addEventListener("change", () => { state.reviewer = $("reviewer").value.trim(); });
$("case").addEventListener("change", (event) => loadCase(event.target.value));
$("previous").addEventListener("click", () => loadCase(state.cases[state.cases.indexOf(state.current) - 1].backbone_id));
$("next").addEventListener("click", () => loadCase(state.cases[state.cases.indexOf(state.current) + 1].backbone_id));
$("add-review").addEventListener("click", addReview);
$("download").addEventListener("click", downloadCsv);
$("change-name").addEventListener("click", () => { state.reviewer = ""; $("reviewer").value = ""; $("reviewer").focus(); });
loadData().catch((error) => show(error.message, true));
