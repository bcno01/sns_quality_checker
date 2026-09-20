// 進捗％と残り時間（ETA）の表示を助けるユーティリティ。

export class ProgressTracker {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.startedAt = performance.now();
    this.ratio = 0;
  }

  /** ratio: 0〜1 */
  update(ratio, label) {
    this.ratio = Math.min(1, Math.max(0, ratio));
    const elapsedSec = (performance.now() - this.startedAt) / 1000;
    let etaSec = null;
    if (this.ratio > 0.02 && this.ratio < 1) {
      etaSec = (elapsedSec * (1 - this.ratio)) / this.ratio;
    }
    this.onUpdate?.({
      percent: Math.round(this.ratio * 100),
      etaSec,
      label,
    });
  }

  done(label) {
    this.update(1, label);
  }
}

export function formatEta(etaSec) {
  if (etaSec == null || !Number.isFinite(etaSec)) return "";
  if (etaSec < 1) return "残り1秒未満";
  if (etaSec < 60) return `残り約${Math.ceil(etaSec)}秒`;
  const min = Math.floor(etaSec / 60);
  const sec = Math.round(etaSec % 60);
  return `残り約${min}分${sec}秒`;
}

/**
 * fetch + Content-Lengthベースのダウンロード進捗計測。
 * 取得したレスポンスはそのままブラウザのHTTPキャッシュに乗るため、
 * 直後に同じURLへ通常のfetch/importでアクセスするとキャッシュヒットして高速に読み込める。
 */
export async function fetchWithProgress(url, onRatio) {
  const response = await fetch(url);
  if (!response.body) {
    // ストリーミング非対応環境へのフォールバック
    await response.arrayBuffer();
    onRatio?.(1);
    return;
  }
  const totalStr = response.headers.get("content-length");
  const total = totalStr ? Number(totalStr) : null;
  const reader = response.body.getReader();
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.length;
    if (total) onRatio?.(loaded / total);
  }
  onRatio?.(1);
}
