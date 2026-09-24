"use strict";

const criteria = ["nodes", "states", "edges", "relationship_type", "overall_similarity"];
const $ = (id) => document.getElementById(id);
const state = { cases: [], byId: new Map(), sources: new Map(), current: null, reviewer: "", reviews: [] };

function show(message, error = false) { $("status").textContent = message; $("status").style.color = error ? "#a52f26" : "#126d45"; }
function csvCell(value) { const text = String(value ?? ""); return `"${text.replaceAll('"', '""')}"`; }
function graphFromRaw(raw) {
  return { nodes: raw.nodes || [], edges: raw.edges || [], joints: raw.joints || [] };
}
async function loadData() {
  const summary = await (await fetch("data/summary.json")).json();
  state.cases = summary.completed || [];
  const lines = (await (await fetch("data/source_backbones.jsonl")).text()).split(/\r?\n/);
  for (const line of lines) if (line.trim()) { const record = JSON.parse(line); state.sources.set(record.id, record); }
  for (const item of state.cases) {
    const folder = `data/cases/${encodeURIComponent(item.backbone_id)}`;
    const [evaluation, prediction, generated] = await Promise.all([
      fetch(`${folder}/evaluation.json`).then((r) => r.json()),
      fetch(`${folder}/prediction.json`).then((r) => r.json()),
      fetch(`${folder}/generated_text.txt`).then((r) => r.text()),
    ]);
    state.byId.set(item.backbone_id, { evaluation, prediction, generated });
  }
  if (!state.cases.length) throw new Error("No completed backbone cases were bundled.");
  for (const item of state.cases) { const option = document.createElement("option"); option.value = item.backbone_id; option.textContent = `${item.backbone_id} — ${state.sources.get(item.source_id)?.title || item.source_id}`; $("case").append(option); }
  loadCase(state.cases[0].backbone_id);
}
function loadCase(caseId) {
  state.current = state.cases.find((item) => item.backbone_id === caseId);
  const data = state.byId.get(caseId); const source = state.sources.get(state.current.source_id);
  $("case").value = caseId; $("title").textContent = source?.title || caseId; $("source-id").textContent = state.current.source_id;
  const index = state.cases.indexOf(state.current); $("position").textContent = `Case ${index + 1} of ${state.cases.length}`;
  $("previous").disabled = index === 0; $("next").disabled = index === state.cases.length - 1;
  $("original").textContent = source?.text || "Original text unavailable"; $("generated").textContent = data.generated;
  $("truth").textContent = JSON.stringify(graphFromRaw(source || {}), null, 2); $("prediction").textContent = JSON.stringify(data.prediction, null, 2);
  for (const input of document.querySelectorAll("[data-score], #text-score, #reason")) input.value = "";
  const prior = state.reviews.find((review) => review.backbone_id === caseId); if (prior) restore(prior);
}
function restore(review) { for (const name of criteria) document.querySelector(`[data-score="${name}"]`).value = review[name]; $("text-score").value = review.text_score_1_to_5; $("reason").value = review.reason || ""; }
function addReview() {
  const reviewer = state.reviewer.trim(); if (!reviewer) { show("Enter your reviewer name first.", true); $("reviewer").focus(); return; }
  const values = Object.fromEntries(criteria.map((name) => [name, Number(document.querySelector(`[data-score="${name}"]`).value)])); const textScore = Number($("text-score").value);
  if (criteria.some((name) => !Number.isFinite(values[name]) || values[name] < 0 || values[name] > 1) || !Number.isFinite(textScore) || textScore < 1 || textScore > 5) { show("Enter all five 0–1 criterion scores and a 1–5 text score.", true); return; }
  const record = { reviewer_name: reviewer, timestamp_utc: new Date().toISOString(), backbone_id: state.current.backbone_id, source_id: state.current.source_id, title: $("title").textContent, ...values, text_score_1_to_5: textScore, reason: $("reason").value.trim() };
  const old = state.reviews.findIndex((item) => item.backbone_id === record.backbone_id && item.reviewer_name === reviewer); if (old >= 0) state.reviews.splice(old, 1); state.reviews.push(record); $("download").disabled = false; show(`${state.reviews.length} review(s) ready. Download the CSV before closing this tab.`);
}
function downloadCsv() { const columns = ["reviewer_name", "timestamp_utc", "backbone_id", "source_id", "title", ...criteria, "text_score_1_to_5", "reason"]; const csv = `\uFEFF${[columns, ...state.reviews.map((item) => columns.map((column) => item[column]))].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`; const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = `prism_backbone_reviews_${new Date().toISOString().replaceAll(/[:.]/g, "-")}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
$("reviewer").addEventListener("change", () => { state.reviewer = $("reviewer").value; }); $("case").addEventListener("change", (event) => loadCase(event.target.value)); $("previous").addEventListener("click", () => loadCase(state.cases[state.cases.indexOf(state.current) - 1].backbone_id)); $("next").addEventListener("click", () => loadCase(state.cases[state.cases.indexOf(state.current) + 1].backbone_id)); $("add-review").addEventListener("click", addReview); $("download").addEventListener("click", downloadCsv); $("change-name").addEventListener("click", () => { state.reviewer = ""; $("reviewer").value = ""; $("reviewer").focus(); });
loadData().catch((error) => show(error.message, true));
