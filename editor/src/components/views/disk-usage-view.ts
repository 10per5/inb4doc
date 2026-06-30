import { colors } from "../../theme"
import { formatBytes } from "../../utils/format"
import type { TreeNode } from "../panels/sidebar"

const PIE_COLORS = [
  "#5e81ac", "#bf616a", "#a3be8c", "#ebcb8b",
  "#d08770", "#b48ead", "#88c0d0", "#8fbcbb",
  "#4c566a", "#e5e9f0", "#81a1c1", "#b082c2",
]

interface Segment {
  label: string
  count: number
  files: string[]
  color: string
}

export interface DiskUsageData {
  tree: TreeNode
  fileSizes: Map<string, number>
  lastModified: Map<string, number>
  providerName: string
  sessionStarted: number
}

export function mountDiskUsageView(
  container: HTMLElement,
  data: DiskUsageData,
  onClose: () => void,
) {
  const old = container.querySelector(".disk-usage-wrapper")
  if (old) old.remove()

  const wrapper = document.createElement("div")
  wrapper.className = "disk-usage-wrapper"
  container.appendChild(wrapper)

  const header = document.createElement("div")
  header.className = "disk-usage-header"
  header.innerHTML = `<span>Disk Usage</span>`
  const closeBtn = document.createElement("button")
  closeBtn.className = "disk-usage-close"
  closeBtn.textContent = "✕"
  closeBtn.addEventListener("click", onClose)
  header.appendChild(closeBtn)
  wrapper.appendChild(header)

  const modeToggle = document.createElement("div")
  modeToggle.className = "disk-usage-mode-toggle"
  const byDirBtn = document.createElement("button")
  byDirBtn.className = "disk-usage-mode-btn active"
  byDirBtn.textContent = "By Directory"
  const bySizeBtn = document.createElement("button")
  bySizeBtn.className = "disk-usage-mode-btn"
  bySizeBtn.textContent = "By Size"
  modeToggle.appendChild(byDirBtn)
  modeToggle.appendChild(bySizeBtn)
  wrapper.appendChild(modeToggle)

  const chartArea = document.createElement("div")
  chartArea.className = "disk-usage-chart-area"
  wrapper.appendChild(chartArea)

  const statsArea = document.createElement("div")
  statsArea.className = "disk-usage-stats"
  wrapper.appendChild(statsArea)

  let currentMode: "dir" | "size" = "dir"

  function renderChart() {
    const segments = currentMode === "dir" ? getDirSegments(data) : getSizeSegments(data)
    renderPieChart(chartArea, segments)
    renderStats(statsArea, data, segments)
  }

  byDirBtn.addEventListener("click", () => {
    currentMode = "dir"
    byDirBtn.classList.add("active")
    bySizeBtn.classList.remove("active")
    renderChart()
  })

  bySizeBtn.addEventListener("click", () => {
    currentMode = "size"
    bySizeBtn.classList.add("active")
    byDirBtn.classList.remove("active")
    renderChart()
  })

  renderChart()
}

function collectLeaves(tree: TreeNode, prefix = ""): { path: string; name: string }[] {
  const leaves: { path: string; name: string }[] = []
  for (const [key, val] of Object.entries(tree)) {
    const fullPath = prefix ? `${prefix}/${key}` : key
    if (val === null || (typeof val === "object" && "weight" in val)) {
      const pagePath = fullPath.replace(/\.md$/, "")
      leaves.push({ path: pagePath, name: key })
    } else if (typeof val === "object" && val !== null) {
      leaves.push(...collectLeaves(val as TreeNode, fullPath))
    }
  }
  return leaves
}

function getDirSegments(data: DiskUsageData): Segment[] {
  const leaves = collectLeaves(data.tree)
  const dirMap = new Map<string, string[]>()

  for (const leaf of leaves) {
    const dir = leaf.path.includes("/") ? leaf.path.split("/")[0] : "(root)"
    if (!dirMap.has(dir)) dirMap.set(dir, [])
    dirMap.get(dir)!.push(leaf.path)
  }

  const entries = Array.from(dirMap.entries()).sort((a, b) => b[1].length - a[1].length)
  return entries.map(([dir, files], i) => ({
    label: dir,
    count: files.length,
    files,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }))
}

function getSizeSegments(data: DiskUsageData): Segment[] {
  const buckets: { label: string; max: number; files: string[] }[] = [
    { label: "< 1 KB", max: 1024, files: [] },
    { label: "1-10 KB", max: 10240, files: [] },
    { label: "10-100 KB", max: 102400, files: [] },
    { label: "> 100 KB", max: Infinity, files: [] },
  ]

  for (const [path, size] of data.fileSizes) {
    for (const bucket of buckets) {
      if (size < bucket.max) {
        bucket.files.push(path)
        break
      }
    }
  }

  return buckets.map((b, i) => ({
    label: b.label,
    count: b.files.length,
    files: b.files,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }))
}

function renderPieChart(area: HTMLElement, segments: Segment[]) {
  area.innerHTML = ""
  if (segments.length === 0) {
    area.textContent = "No files"
    return
  }

  const total = segments.reduce((s, seg) => s + seg.count, 0)
  if (total === 0) {
    area.textContent = "No files"
    return
  }

  const svgContainer = document.createElement("div")
  svgContainer.className = "disk-usage-svg-container"

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 240 240")
  svg.classList.add("disk-usage-pie")

  const cx = 120, cy = 120, r = 100
  let startAngle = -Math.PI / 2

  for (const seg of segments) {
    const angle = (seg.count / total) * 2 * Math.PI
    const endAngle = startAngle + angle
    const largeArc = angle > Math.PI ? 1 : 0

    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)

    const d = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.setAttribute("d", d)
    path.setAttribute("fill", seg.color)
    path.dataset.label = seg.label
    path.style.cursor = "pointer"
    svg.appendChild(path)

    startAngle = endAngle
  }

  svgContainer.appendChild(svg)

  const legend = document.createElement("div")
  legend.className = "disk-usage-legend"

  const tooltip = document.createElement("div")
  tooltip.className = "disk-usage-tooltip"
  tooltip.style.display = "none"
  svgContainer.appendChild(tooltip)

  svg.addEventListener("mouseover", (e) => {
    const target = (e.target as SVGElement).closest("path") as SVGPathElement | null
    if (!target || !target.dataset.label) {
      tooltip.style.display = "none"
      return
    }
    const seg = segments.find(s => s.label === target.dataset.label)
    if (!seg) return
    tooltip.innerHTML = `<strong>${seg.label}</strong> (${seg.count})<br>${seg.files.join("<br>")}`
    tooltip.style.display = "block"
    const rect = svg.getBoundingClientRect()
    const parentRect = svgContainer.getBoundingClientRect()
    tooltip.style.left = `${e.clientX - parentRect.left + 12}px`
    tooltip.style.top = `${e.clientY - parentRect.top - 10}px`
  })

  svg.addEventListener("mouseout", () => {
    tooltip.style.display = "none"
  })

  area.appendChild(svgContainer)

  for (const seg of segments) {
    const item = document.createElement("div")
    item.className = "legend-item"
    const swatch = document.createElement("span")
    swatch.className = "legend-swatch"
    swatch.style.background = seg.color
    const pct = ((seg.count / total) * 100).toFixed(1)
    item.appendChild(swatch)
    item.innerHTML += `<span class="legend-label">${seg.label}</span><span class="legend-value">${seg.count} (${pct}%)</span>`
    legend.appendChild(item)
  }
  area.appendChild(legend)
}

function renderStats(area: HTMLElement, data: DiskUsageData, segments: Segment[]) {
  area.innerHTML = ""
  const totalFiles = segments.reduce((s, seg) => s + seg.count, 0)
  const totalSize = Array.from(data.fileSizes.values()).reduce((s, v) => s + v, 0)
  const sizeStr = formatBytes(totalSize, false)

  const lastMod = Array.from(data.lastModified.values()).reduce((max, t) => Math.max(max, t), 0)
  const lastModStr = lastMod > 0 ? new Date(lastMod).toLocaleString() : "N/A"
  const startedStr = data.sessionStarted > 0 ? new Date(data.sessionStarted).toLocaleString() : "N/A"

  const rows: { label: string; value: string }[] = [
    { label: "Total Files", value: String(totalFiles) },
    { label: "Total Size", value: sizeStr },
    { label: "Provider", value: data.providerName },
    { label: "Session Started", value: startedStr },
    { label: "Last Modified", value: lastModStr },
  ]

  const table = document.createElement("div")
  table.className = "disk-usage-stat-table"
  for (const row of rows) {
    const r = document.createElement("div")
    r.className = "disk-usage-stat-row"
    r.innerHTML = `<span class="stat-label">${row.label}</span><span class="stat-value">${row.value}</span>`
    table.appendChild(r)
  }
  area.appendChild(table)
}
