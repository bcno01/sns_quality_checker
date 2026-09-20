// 実ファイルの実測値をSNSごとの目安値と照らし合わせ、
// 「そのまま投稿して大丈夫か」を判定するロジック。
// 実際に再エンコードはしない（判定のみ）。

function check(id, label, status, actual, recommended, advice, fix = null) {
  return { id, label, status, actual, recommended, advice, fix };
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function summarize(checks) {
  const hasBad = checks.some((c) => c.status === "bad");
  const hasWarn = checks.some((c) => c.status === "warn");
  if (hasBad) {
    return { status: "bad", label: "劣化・不具合のリスクがあります" };
  }
  if (hasWarn) {
    return { status: "warn", label: "いくつか注意点があります" };
  }
  return { status: "ok", label: "良好です。そのまま投稿しても大丈夫そうです" };
}

export function diagnoseImage(analyzed, preset) {
  const checks = [];
  const longEdge = Math.max(analyzed.width, analyzed.height);

  if (longEdge <= preset.maxLongEdgeRecommended) {
    checks.push(
      check(
        "resolution",
        "解像度",
        "ok",
        `${analyzed.width}×${analyzed.height}`,
        `長辺${preset.maxLongEdgeRecommended}px以下`,
        "SNS側でのリサイズはほぼ発生しません。"
      )
    );
  } else {
    checks.push(
      check(
        "resolution",
        "解像度",
        "warn",
        `${analyzed.width}×${analyzed.height}`,
        `長辺${preset.maxLongEdgeRecommended}px程度`,
        `長辺${longEdge}pxはSNS側で${preset.maxLongEdgeRecommended}px程度まで縮小される可能性があります。`,
        `画像編集ソフトやオンラインツールで、長辺が${preset.maxLongEdgeRecommended}px程度になるようリサイズしてから投稿すると、意図しない縮小・再圧縮を防げます。`
      )
    );
  }

  const maxBytes = preset.maxFileSizeMB * 1024 * 1024;
  if (analyzed.file.size > maxBytes) {
    checks.push(
      check(
        "filesize",
        "ファイルサイズ",
        "bad",
        formatBytes(analyzed.file.size),
        `${preset.maxFileSizeMB}MB以下`,
        "上限を超えており、アップロード時に強く再圧縮される（または拒否される）可能性があります。",
        `長辺を小さくする、またはJPEG書き出し品質を80%前後まで下げて、${preset.maxFileSizeMB}MB以下になるように書き出し直してください。`
      )
    );
  } else if (analyzed.file.size > maxBytes * 0.7) {
    checks.push(
      check(
        "filesize",
        "ファイルサイズ",
        "warn",
        formatBytes(analyzed.file.size),
        `${preset.maxFileSizeMB}MB以下`,
        "上限に近いため、強めに再圧縮される可能性があります。",
        "JPEG書き出し品質を少し下げる（85%前後）と、上限に余裕を持たせつつ画質もある程度保てます。"
      )
    );
  } else {
    checks.push(
      check(
        "filesize",
        "ファイルサイズ",
        "ok",
        formatBytes(analyzed.file.size),
        `${preset.maxFileSizeMB}MB以下`,
        "余裕があります。"
      )
    );
  }

  if (preset.recommendedFormats.includes(analyzed.file.type)) {
    checks.push(check("format", "ファイル形式", "ok", analyzed.file.type || "不明", preset.recommendedFormats.join(" / "), "問題ありません。"));
  } else {
    checks.push(
      check(
        "format",
        "ファイル形式",
        "warn",
        analyzed.file.type || "不明",
        preset.recommendedFormats.join(" / "),
        "推奨形式以外のため、変換や追加の圧縮が行われる可能性があります。",
        "JPEGまたはPNG形式で書き出し直してから投稿してください。"
      )
    );
  }

  return { preset, checks, overall: summarize(checks), previewURL: URL.createObjectURL(analyzed.file) };
}

export function diagnoseVideo(probed, preset) {
  const checks = [];
  const codecFixHint = "HandBrake（無料の動画変換ソフト）やffmpegなどで、映像コーデックをH.264、音声コーデックをAACに指定して書き出し直してください。";

  // 映像コーデック
  if (!probed.videoCodec) {
    checks.push(check("videoCodec", "映像コーデック", "warn", "取得できませんでした", preset.codecOk.join(" / "), "自動判定に失敗しました。"));
  } else if (preset.codecOk.includes(probed.videoCodec)) {
    checks.push(check("videoCodec", "映像コーデック", "ok", probed.videoCodec.toUpperCase(), preset.codecOk.join(" / ").toUpperCase(), "対応コーデックです。"));
  } else {
    checks.push(
      check(
        "videoCodec",
        "映像コーデック",
        "bad",
        probed.videoCodec.toUpperCase(),
        preset.codecOk.join(" / ").toUpperCase(),
        "非対応の可能性があるコーデックです。アップロード時に強制的に再エンコードされ、劣化の原因になりやすいです。",
        codecFixHint
      )
    );
  }

  // 音声コーデック（音声トラックがある場合のみ）
  if (probed.hasAudio) {
    if (!probed.audioCodec) {
      checks.push(check("audioCodec", "音声コーデック", "warn", "取得できませんでした", preset.audioCodecOk.join(" / "), "自動判定に失敗しました。"));
    } else if (preset.audioCodecOk.includes(probed.audioCodec)) {
      checks.push(check("audioCodec", "音声コーデック", "ok", probed.audioCodec.toUpperCase(), preset.audioCodecOk.join(" / ").toUpperCase(), "対応コーデックです。"));
    } else {
      checks.push(
        check(
          "audioCodec",
          "音声コーデック",
          "warn",
          probed.audioCodec.toUpperCase(),
          preset.audioCodecOk.join(" / ").toUpperCase(),
          "再エンコードされる可能性があります。",
          "音声コーデックをAACに指定して書き出し直してください。"
        )
      );
    }
  }

  // 解像度
  if (probed.width <= preset.maxWidth && probed.height <= preset.maxHeight) {
    checks.push(
      check("resolution", "解像度", "ok", `${probed.width}×${probed.height}`, `${preset.recommendedWidth}×${preset.recommendedHeight}程度`, "縮小されずに投稿できる見込みです。")
    );
  } else {
    checks.push(
      check(
        "resolution",
        "解像度",
        "warn",
        `${probed.width}×${probed.height}`,
        `${preset.maxWidth}×${preset.maxHeight}以下`,
        "SNS側で縮小される可能性があります。",
        `編集ソフトの書き出し設定で解像度を${preset.maxWidth}×${preset.maxHeight}以下（推奨は${preset.recommendedWidth}×${preset.recommendedHeight}程度）に指定し直してください。`
      )
    );
  }

  // フレームレート
  if (probed.fps) {
    if (probed.fps <= preset.maxFps) {
      checks.push(check("fps", "フレームレート", "ok", `${probed.fps.toFixed(1)} fps`, `${preset.maxFps} fps以下`, "問題ありません。"));
    } else {
      checks.push(
        check(
          "fps",
          "フレームレート",
          "warn",
          `${probed.fps.toFixed(1)} fps`,
          `${preset.maxFps} fps以下`,
          "フレームが間引かれる可能性があります。",
          `書き出し設定のフレームレートを${preset.maxFps}fps以下に指定し直してください。`
        )
      );
    }
  }

  // 映像ビットレート
  if (probed.videoBitrateKbps == null) {
    checks.push(check("bitrate", "映像ビットレート", "warn", "取得できませんでした", `${preset.bitrateMinKbps}〜${preset.bitrateMaxKbps} kbps`, "自動判定に失敗しました。"));
  } else if (probed.videoBitrateKbps < preset.bitrateMinKbps * 0.5) {
    checks.push(
      check(
        "bitrate",
        "映像ビットレート",
        "bad",
        `${Math.round(probed.videoBitrateKbps)} kbps`,
        `${preset.bitrateMinKbps}〜${preset.bitrateMaxKbps} kbps`,
        "すでにかなり低いビットレートです。SNS側の再圧縮でブロックノイズ等が目立ちやすくなります。",
        `可能であれば元の高画質な素材（撮って出しファイルなど）から、ビットレート${preset.bitrateMinKbps}kbps以上を指定して書き出し直してください。一度低ビットレートで圧縮された動画は、再エンコードしても画質を戻すことはできません。`
      )
    );
  } else if (probed.videoBitrateKbps < preset.bitrateMinKbps) {
    checks.push(
      check(
        "bitrate",
        "映像ビットレート",
        "warn",
        `${Math.round(probed.videoBitrateKbps)} kbps`,
        `${preset.bitrateMinKbps}〜${preset.bitrateMaxKbps} kbps`,
        "推奨レンジよりやや低めです。再圧縮で劣化が目立つ可能性があります。",
        `書き出し時のビットレートを${preset.bitrateMinKbps}〜${preset.bitrateMaxKbps}kbps程度に上げて再エクスポートしてください。`
      )
    );
  } else {
    checks.push(
      check(
        "bitrate",
        "映像ビットレート",
        "ok",
        `${Math.round(probed.videoBitrateKbps)} kbps`,
        `${preset.bitrateMinKbps}〜${preset.bitrateMaxKbps} kbps`,
        probed.videoBitrateKbps > preset.bitrateMaxKbps
          ? "推奨レンジより高めですが、画質面では問題ありません（SNS側で圧縮されます）。"
          : "推奨レンジ内です。"
      )
    );
  }

  // ファイルサイズ
  const maxBytes = preset.maxFileSizeMB * 1024 * 1024;
  if (probed.bytes > maxBytes) {
    checks.push(
      check(
        "filesize",
        "ファイルサイズ",
        "bad",
        formatBytes(probed.bytes),
        `${preset.maxFileSizeMB}MB以下`,
        "上限を超えており、アップロードできない可能性があります。",
        `解像度やビットレートを下げて再エクスポートするか、不要な部分をカットして${preset.maxFileSizeMB}MB以下に収めてください。`
      )
    );
  } else if (probed.bytes > maxBytes * 0.7) {
    checks.push(
      check(
        "filesize",
        "ファイルサイズ",
        "warn",
        formatBytes(probed.bytes),
        `${preset.maxFileSizeMB}MB以下`,
        "上限に近いです。",
        "ビットレートを少し下げて書き出すと、上限に余裕を持たせられます。"
      )
    );
  } else {
    checks.push(check("filesize", "ファイルサイズ", "ok", formatBytes(probed.bytes), `${preset.maxFileSizeMB}MB以下`, "余裕があります。"));
  }

  // 長さ
  const durationLabel = `${Math.round(probed.durationSec)}秒`;
  if (probed.durationSec > preset.maxDurationSec) {
    checks.push(
      check(
        "duration",
        "動画の長さ",
        preset.durationSeverity === "hard" ? "bad" : "warn",
        durationLabel,
        `${preset.maxDurationSec}秒以下`,
        preset.durationSeverity === "hard"
          ? "上限を超えており、そのままの形式では投稿できない可能性があります。"
          : "上限を超えており、表示上不利になったり自動でカットされたりする可能性があります。",
        `動画編集ソフトで${preset.maxDurationSec}秒以内にトリミングしてから投稿してください。`
      )
    );
  } else {
    checks.push(check("duration", "動画の長さ", "ok", durationLabel, `${preset.maxDurationSec}秒以下`, "問題ありません。"));
  }

  return { preset, checks, overall: summarize(checks), previewURL: probed.url };
}
