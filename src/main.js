import { IMAGE_PRESETS, VIDEO_PRESETS } from "./presets.js";
import { analyzeImage } from "./imagePipeline.js";
import { preloadFFmpeg, probeVideo } from "./videoPipeline.js";
import { diagnoseImage, diagnoseVideo } from "./diagnostics.js";
import { ProgressTracker, formatEta } from "./progress.js";

const dropSection = document.getElementById("drop-section");
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const browseButton = document.getElementById("browse-button");

const analyzeSection = document.getElementById("analyze-section");
const analyzeFilename = document.getElementById("analyze-filename");
const analyzePercent = document.getElementById("analyze-percent");
const analyzeBar = document.getElementById("analyze-bar");
const analyzeLabel = document.getElementById("analyze-label");
const analyzeEta = document.getElementById("analyze-eta");

const appSection = document.getElementById("app-section");
const fileInfoEl = document.getElementById("file-info");
const platformListEl = document.getElementById("platform-list");

const resultSection = document.getElementById("result-section");
const resultCard = document.getElementById("result-card");
const resetButton = document.getElementById("reset-button");

let currentKind = null; // "image" | "video"
let analyzed = null; // analyzeImage() または probeVideo() の結果
let activePresetId = null;

function showView(name) {
  dropSection.classList.toggle("hidden", name !== "drop");
  analyzeSection.classList.toggle("hidden", name !== "analyze");
  appSection.classList.toggle("hidden", name !== "app");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function detectKind(file) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

// --- 1. ファイル読み込み〜解析フェーズ ---

async function handleFile(file) {
  const kind = detectKind(file);
  if (!kind) {
    alert("対応していないファイル形式です（画像または動画を選択してください）");
    return;
  }

  currentKind = kind;
  analyzed = null;
  activePresetId = null;
  resultSection.classList.add("hidden");

  analyzeFilename.textContent = file.name;
  analyzeLabel.textContent = "解析を開始しています…";
  analyzeEta.textContent = "";
  analyzeBar.style.width = "0%";
  analyzePercent.textContent = "0%";
  showView("analyze");

  const tracker = new ProgressTracker(({ percent, etaSec, label }) => {
    analyzeBar.style.width = `${percent}%`;
    analyzePercent.textContent = `${percent}%`;
    if (label) analyzeLabel.textContent = label;
    analyzeEta.textContent = formatEta(etaSec);
  });

  try {
    if (kind === "image") {
      tracker.update(0.3, "画像を読み込み中…");
      analyzed = await analyzeImage(file);
      tracker.done("解析完了");
    } else {
      const ffmpeg = await preloadFFmpeg((r) => tracker.update(r * 0.9, "ffmpeg.wasmを読み込み中…"));
      tracker.update(0.92, "動画のコーデック・ビットレートを確認中…");
      analyzed = await probeVideo(ffmpeg, file);
      tracker.done("解析完了");
    }
  } catch (err) {
    console.error(err);
    alert(`解析中にエラーが発生しました: ${err.message ?? err}`);
    showView("drop");
    return;
  }

  fileInfoEl.innerHTML = `
    <span class="name"></span>
    <span class="meta">${kind === "image" ? "画像" : "動画"} ・ ${analyzed.width}×${analyzed.height} ・ ${formatBytes(file.size)}${
    analyzed.durationSec ? ` ・ ${analyzed.durationSec.toFixed(1)}秒` : ""
  }</span>
  `;
  // ファイル名は利用者が決めた文字列なので、HTMLとして解釈されないようtextContentで入れる
  fileInfoEl.querySelector(".name").textContent = file.name;

  renderPlatformList();
  showView("app");
}

// --- 2. プラットフォーム選択 ---

function renderPlatformList() {
  const presets = currentKind === "image" ? IMAGE_PRESETS : VIDEO_PRESETS;
  platformListEl.innerHTML = "";
  presets.forEach((preset) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "platform-card";
    card.dataset.presetId = preset.id;
    card.innerHTML = `<span class="label">${preset.label}</span><span class="note">${preset.note}</span>`;
    card.addEventListener("click", () => selectPreset(preset));
    platformListEl.appendChild(card);
  });
}

function updatePlatformCardStates() {
  platformListEl.querySelectorAll(".platform-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.presetId === activePresetId);
  });
}

function selectPreset(preset) {
  activePresetId = preset.id;
  updatePlatformCardStates();

  const result = currentKind === "image" ? diagnoseImage(analyzed, preset) : diagnoseVideo(analyzed, preset);
  renderResult(result);
}

// --- 3. 診断結果表示 ---

const STATUS_ICON = { ok: "✓", warn: "!", bad: "×" };
const OVERALL_LABEL = { ok: "良好です", warn: "注意点があります", bad: "リスクがあります" };
const STATUS_WEIGHT = { ok: 1, warn: 0.5, bad: 0 };
const STATUS_ORDER = { bad: 0, warn: 1, ok: 2 };

function computeScore(checks) {
  if (checks.length === 0) return 100;
  const sum = checks.reduce((acc, c) => acc + STATUS_WEIGHT[c.status], 0);
  return Math.round((sum / checks.length) * 100);
}

function renderScoreRing(score, status) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  return `
    <svg class="score-ring" viewBox="0 0 96 96">
      <circle class="score-ring-track" cx="48" cy="48" r="${radius}" />
      <circle
        class="score-ring-value overall-${status}"
        cx="48" cy="48" r="${radius}"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${offset}"
        transform="rotate(-90 48 48)"
      />
      <text class="score-ring-label" x="48" y="50">${score}</text>
    </svg>
  `;
}

function renderCheckItem(c) {
  const fixHtml =
    c.status !== "ok" && c.fix
      ? `
      <div class="check-item-fix">
        <span class="check-item-fix-label">直し方</span>
        <p>${c.fix}</p>
      </div>
    `
      : "";

  return `
    <div class="check-item check-${c.status}">
      <div class="check-item-icon">${STATUS_ICON[c.status]}</div>
      <div class="check-item-body">
        <div class="check-item-head">
          <span class="check-item-title">${c.label}</span>
        </div>
        <div class="check-item-values">
          <span class="value-chip value-chip-actual">実測 ${c.actual}</span>
          <span class="value-chip">推奨 ${c.recommended}</span>
        </div>
        <p class="check-item-advice">${c.advice}</p>
        ${fixHtml}
      </div>
    </div>
  `;
}

function renderResult(result) {
  const previewIsVideo = currentKind === "video";
  const previewHtml = previewIsVideo
    ? `<video src="${result.previewURL}" controls muted class="preview-media"></video>`
    : `<img src="${result.previewURL}" alt="プレビュー" class="preview-media" />`;

  const score = computeScore(result.checks);
  const sortedChecks = [...result.checks].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  resultCard.innerHTML = `
    <div class="result-summary">
      ${renderScoreRing(score, result.overall.status)}
      <div class="result-summary-text">
        <span class="overall-badge overall-${result.overall.status}-text">${OVERALL_LABEL[result.overall.status]}</span>
        <p class="overall-sub">${result.preset.label} への投稿を想定した診断結果</p>
      </div>
    </div>
    ${previewHtml}
    <div class="check-timeline">${sortedChecks.map(renderCheckItem).join("")}</div>
  `;
  resultSection.classList.remove("hidden");
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

// --- イベント配線: ファイル選択 ---

browseButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
  fileInput.value = "";
});

resetButton.addEventListener("click", () => {
  window.location.reload();
});

// --- イベント配線: ドラッグ&ドロップ（ページ全体で受け付ける） ---
// dragover/drop両方でpreventDefault()しないと、ブラウザ既定の
// 「ファイルを開く（ページ遷移）」が発生し、ドロップが機能しないように見える。

let dragDepth = 0;

window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  document.body.classList.add("app-dragover");
  dropZone.classList.add("dragover");
});

window.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});

window.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    document.body.classList.remove("app-dragover");
    dropZone.classList.remove("dragover");
  }
});

window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("app-dragover");
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

// --- PWA: Service Worker登録 ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW登録失敗", err));
  });
}
