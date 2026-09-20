// 画像ファイルの実測値（解像度など）を取得する「解析」フェーズのみを担当。
// 判定（診断）ロジックはdiagnostics.jsに、実際の再エンコードは行わない。

export async function analyzeImage(file) {
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close?.();
  return { file, width, height };
}
