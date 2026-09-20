import { fetchWithProgress } from "./progress.js";

// @ffmpeg/ffmpeg本体はvendor/配下に同梱（同一オリジン配信）。
// worker.jsはESMの相対import（./const.js等）を使うため、別オリジンから直接
// new Worker()するとSecurityErrorになる（Workerの生成自体は同一オリジンが必須）。
// 一方、ffmpeg-core本体（js+wasm、約30MB）はworker内部のfetch/importで読み込まれるため
// CORSさえ通ればCDNのままで問題ない。事前に同じURLへ進捗付きfetchをかけてHTTPキャッシュを
// 温めてから、ffmpeg.load()には素のCDN URLを渡す（ストリーミングコンパイルも効いて高速）。
const FFMPEG_VENDOR_URL = new URL("../vendor/ffmpeg/index.js", import.meta.url).href;
const FFMPEG_CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
const FFMPEG_CORE_JS_URL = `${FFMPEG_CORE_BASE}/ffmpeg-core.js`;
const FFMPEG_CORE_WASM_URL = `${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`;

let ffmpegInstance = null;
let ffmpegLoadingPromise = null;
let activeLogHandler = null;

function fetchFile(file) {
  return file.arrayBuffer().then((buf) => new Uint8Array(buf));
}

/**
 * ffmpeg.wasm本体（約30MB）を読み込む（「解析」フェーズの主要処理）。
 * onProgress(ratio: 0-1) でダウンロード進捗を通知する。
 */
export async function preloadFFmpeg(onProgress) {
  if (ffmpegInstance) {
    onProgress?.(1);
    return ffmpegInstance;
  }
  if (!ffmpegLoadingPromise) {
    ffmpegLoadingPromise = (async () => {
      const { FFmpeg } = await import(/* @vite-ignore */ FFMPEG_VENDOR_URL);
      onProgress?.(0.02);

      // coreのjs/wasmを進捗付きで先にダウンロードし、HTTPキャッシュを温めておく。
      // wasmが大半のサイズを占めるため、js:5% wasm:95%の重みで進捗を合成する。
      await fetchWithProgress(FFMPEG_CORE_JS_URL, () => {});
      onProgress?.(0.07);
      await fetchWithProgress(FFMPEG_CORE_WASM_URL, (ratio) => {
        onProgress?.(0.07 + ratio * 0.83);
      });

      const ffmpeg = new FFmpeg();
      ffmpeg.on("log", (data) => activeLogHandler?.(data));

      // 直前のfetchでキャッシュ済みのため、ここは通常ほぼ瞬時に完了する。
      await ffmpeg.load({ coreURL: FFMPEG_CORE_JS_URL, wasmURL: FFMPEG_CORE_WASM_URL });
      onProgress?.(1);
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })();
  }
  return ffmpegLoadingPromise;
}

function parseProbeLogs(lines) {
  const durationLine = lines.find((l) => l.includes("Duration:"));
  const videoLine = lines.find((l) => l.includes("Video:"));
  const audioLine = lines.find((l) => l.includes("Audio:"));

  let durationSec = null;
  let overallBitrateKbps = null;
  if (durationLine) {
    const durMatch = durationLine.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (durMatch) {
      durationSec = Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3]);
    }
    const brMatch = durationLine.match(/bitrate:\s*(\d+)\s*kb\/s/);
    if (brMatch) overallBitrateKbps = Number(brMatch[1]);
  }

  let videoCodec = null;
  let width = null;
  let height = null;
  let fps = null;
  let videoBitrateKbps = null;
  if (videoLine) {
    const codecMatch = videoLine.match(/Video:\s*([a-zA-Z0-9_]+)/);
    if (codecMatch) videoCodec = codecMatch[1].toLowerCase();
    const resMatch = videoLine.match(/(\d{2,5})x(\d{2,5})/);
    if (resMatch) {
      width = Number(resMatch[1]);
      height = Number(resMatch[2]);
    }
    const fpsMatch = videoLine.match(/([\d.]+)\s*fps/);
    if (fpsMatch) fps = Number(fpsMatch[1]);
    const vbrMatch = videoLine.match(/(\d+)\s*kb\/s/);
    if (vbrMatch) videoBitrateKbps = Number(vbrMatch[1]);
  }

  let audioCodec = null;
  let audioBitrateKbps = null;
  let audioSampleRate = null;
  if (audioLine) {
    const codecMatch = audioLine.match(/Audio:\s*([a-zA-Z0-9_]+)/);
    if (codecMatch) audioCodec = codecMatch[1].toLowerCase();
    const hzMatch = audioLine.match(/(\d+)\s*Hz/);
    if (hzMatch) audioSampleRate = Number(hzMatch[1]);
    const abrMatch = audioLine.match(/(\d+)\s*kb\/s/);
    if (abrMatch) audioBitrateKbps = Number(abrMatch[1]);
  }

  if (videoBitrateKbps == null && overallBitrateKbps != null) {
    videoBitrateKbps = Math.max(0, overallBitrateKbps - (audioBitrateKbps ?? 0));
  }

  return {
    durationSec,
    width,
    height,
    fps,
    videoCodec,
    videoBitrateKbps,
    hasAudio: !!audioLine,
    audioCodec,
    audioBitrateKbps,
    audioSampleRate,
  };
}

/**
 * 「解析」フェーズ: ffmpegに動画ファイルのヘッダを読ませ、実際のコーデック・解像度・
 * フレームレート・ビットレート・音声情報を取得する（実際の再エンコードは行わない）。
 */
export async function probeVideo(ffmpeg, file) {
  const inputExt = file.name.split(".").pop() || "mp4";
  const inputName = `probe_input.${inputExt}`;
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  const lines = [];
  activeLogHandler = (data) => {
    const message = data?.message ?? "";
    if (message) lines.push(message);
  };
  try {
    // -iのみでは出力先が無くffmpegはエラー終了するが、その前に
    // ストリーム情報（コーデック/解像度/fps/ビットレート等）がログに出力される。
    await ffmpeg.exec(["-i", inputName]);
  } catch {
    // 想定内（出力ファイル未指定によるエラー）。ログの内容だけ使う。
  } finally {
    activeLogHandler = null;
  }

  await ffmpeg.deleteFile(inputName).catch(() => {});

  const parsed = parseProbeLogs(lines);
  return {
    file,
    url: URL.createObjectURL(file),
    bytes: file.size,
    width: parsed.width ?? 0,
    height: parsed.height ?? 0,
    fps: parsed.fps,
    durationSec: parsed.durationSec ?? 0,
    videoCodec: parsed.videoCodec,
    videoBitrateKbps: parsed.videoBitrateKbps,
    hasAudio: parsed.hasAudio,
    audioCodec: parsed.audioCodec,
    audioBitrateKbps: parsed.audioBitrateKbps,
    audioSampleRate: parsed.audioSampleRate,
  };
}
