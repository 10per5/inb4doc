export function formatBytes(bytes: number, sign: boolean = true): string {
  const s = sign && bytes >= 0 ? "+" : bytes < 0 ? "-" : ""
  const abs = Math.abs(bytes)
  if (abs < 1024) return `${s}${abs} B`
  if (abs < 1024 * 1024) return `${s}${(abs / 1024).toFixed(1)} KB`
  return `${s}${(abs / (1024 * 1024)).toFixed(2)} MB`
}
