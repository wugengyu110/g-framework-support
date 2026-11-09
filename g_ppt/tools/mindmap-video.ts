/**
 * 思维导图播放视频。
 * 读 Obsidian .canvas 坐标，按时间轴移动镜头，Playwright 逐帧截图后 ffmpeg 编码。
 * 从 read 的 mindmap-video 迁入；背景动画复用 frontend/public 的行心身演示。
 */
import { execFile, execSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  type AbsoluteCue,
  concatAudioSourcesInWork,
  frontendRoot,
  muxNarrationOntoVideo,
  outputDir,
  probeDurationSec,
  resolveMediaSrc,
  runScreenshotWorker,
  safeOutputFilename,
  withRenderGate,
} from './engine'

const execFileAsync = promisify(execFile)

const COLORS: Record<string, [string, string]> = {
  '1': ['#e04b50', '#fff5f5'],
  '2': ['#d4842f', '#fff6ec'],
  '3': ['#a3993d', '#fbf8e6'],
  '4': ['#2fa85a', '#f1faf4'],
  '5': ['#2aabb0', '#f0fbfb'],
  '6': ['#8b6ad6', '#f7f3ff'],
}

const SIDE: Record<string, [number, number, number, number]> = {
  top: [0.5, 0, 0, -1],
  bottom: [0.5, 1, 0, 1],
  left: [0, 0.5, -1, 0],
  right: [1, 0.5, 1, 0],
}

const CHAPTER_FONT = 96
const IMG_SUFFIX = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])
const DEMO_FILES = [
  'xing-xin-shen-demo.html',
  'xing-xin-shen-demo.css',
  'xing-xin-shen-demo.js',
  'xing-xin-shen-tone.env',
]
const TONE_CSS = [
  'LINE_OPACITY',
  'BALL_DISK_OPACITY',
  'BALL_SHADOW_OPACITY',
  'STAGE_OPACITY',
  'ARENA_VIGNETTE_OPACITY',
  'BALL_0_TEXT',
  'BALL_1_TEXT',
  'BALL_2_TEXT',
  'ARENA_WATERMARK_FILL',
]
const BOARD_DEFAULTS: Record<string, string> = {
  GROUP_INK_MIX: '90',
  GROUP_BORDER_INK_MIX: '42',
  CARD_FILL_ALPHA: '1',
  CARD_BORDER_INK_MIX: '38',
  EDGE_STROKE_WIDTH: '3.2',
  EDGE_STROKE_OPACITY: '1',
  USE_DYNAMIC_BG: 'true',
  SOLID_BG_COLOR: '#000000',
}

const publicDir = resolve(frontendRoot, 'public')
const boardEnvFile = resolve(publicDir, 'mindmap-board.env')
const toneEnvFile = resolve(publicDir, 'xing-xin-shen-tone.env')

export type MindmapNode = {
  id: string
  type?: string
  x: number
  y: number
  width: number
  height: number
  color?: string
  text?: string
  label?: string
  file?: string
}

export type MindmapEdge = {
  fromNode?: string
  toNode?: string
  fromSide?: string
  toSide?: string
  color?: string
}

export type MindmapCanvas = {
  nodes: MindmapNode[]
  edges?: MindmapEdge[]
}

/** media `per_shot_narration[]` 与 shots 按下标对齐（可用 shot_index 覆盖） */
export type PerShotNarration = {
  shot_index?: number
  audio_src?: string
  duration_sec?: number
  text?: string
}

export type MindmapShot = {
  t: number
  focus: string | string[]
  move?: number
  padding?: number
  /** 本镜停留时长（到下一镜起始）；TTS 重定时后由 media 填入 */
  duration_sec?: number
  /** 单镜旁白 asset:<id>（无顶层 audio_src 时可按镜 concat） */
  audio_src?: string
}

export type RenderMindmapInput = {
  canvas: MindmapCanvas
  shots: MindmapShot[]
  width?: number
  height?: number
  fps?: number
  padding?: number
  hold_end?: number
  dynamic_bg?: boolean
  board?: Record<string, string>
  stills?: number[]
  filename?: string
  /** canvas `file` 相对路径 → asset:<id> 或本地路径 */
  files?: Record<string, string>
  /** 插图相对路径的根目录（read 仓库根） */
  vault?: string
  /** 旁白 asset:<id>；有则成片混入 AAC 音轨（时长以音频为准） */
  audio_src?: string
  /**
   * media PR #18：按镜 TTS 元数据；与 shots[] 对齐。
   * 无顶层 audio_src 时按镜 audio_src concat；duration_sec 参与重算 shots.t。
   */
  per_shot_narration?: PerShotNarration[]
  subtitle_src?: string
  burn_in?: boolean
  bgm_src?: string
  bgm_volume?: number
  /** 成片绝对时间轴字幕 cue（秒） */
  cues?: AbsoluteCue[]
  onProgress?: (progress: { frame: number; total: number }) => void
}

export type RenderMindmapResult = {
  ok: true
  format: 'mp4' | 'png'
  path: string
  paths?: string[]
  total_sec: number
  frames: number
  width: number
  height: number
}

type Cam = { cx: number; cy: number; z: number }
type Key = { t: number; cam: Cam }

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function parseEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i < 0) continue
    out[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim()
  }
  return out
}

function clamp(num: string | undefined, lo: number, hi: number, fallback: number): number {
  const v = Number(num)
  const n = Number.isFinite(v) ? v : fallback
  return Math.max(lo, Math.min(hi, n))
}

function envBool(val: string | undefined, fallback = true): boolean {
  if (val == null) return fallback
  const v = val.trim().toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  if (['1', 'true', 'yes', 'on'].includes(v)) return true
  return fallback
}

function envKeyToQuery(key: string): string {
  const parts = key.toLowerCase().split('_')
  return parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
}

function boardEnv(overrides?: Record<string, string>): Record<string, string> {
  return { ...BOARD_DEFAULTS, ...parseEnv(boardEnvFile), ...overrides }
}

function boardStyleTokens(cfg: Record<string, string>) {
  const fillA = clamp(cfg.CARD_FILL_ALPHA, 0, 1, 1)
  const fmt = (n: number) => String(Number(n.toFixed(4)))
  return {
    group_ink_mix: `${fmt(clamp(cfg.GROUP_INK_MIX, 0, 100, 90))}%`,
    group_border_mix: `${fmt(clamp(cfg.GROUP_BORDER_INK_MIX, 0, 100, 42))}%`,
    card_fill_mix: `${fmt(fillA * 100)}%`,
    card_border_mix: `${fmt(clamp(cfg.CARD_BORDER_INK_MIX, 0, 100, 38))}%`,
    edge_width: fmt(clamp(cfg.EDGE_STROKE_WIDTH, 0.5, 12, 3.2)),
    edge_opacity: fmt(clamp(cfg.EDGE_STROKE_OPACITY, 0, 1, 1)),
  }
}

function buildBgSrc(tone: Record<string, string>): string {
  const params: Array<[string, string]> = [
    ['state', 'asymmetric'],
    ['embed', '1'],
    ['driven', '1'],
    ['fit', 'height'],
    ['tone', 'faint'],
  ]
  for (const key of TONE_CSS) {
    if (tone[key] != null) params.push([envKeyToQuery(key), tone[key]])
  }
  return `xing-xin-shen-demo.html?${params
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')}`
}

function inline(text: string): string {
  return escapeHtml(text)
    .split('`')
    .map((part, i) => (i % 2 ? `<code>${part}</code>` : part))
    .join('')
}

function cardBody(text: string): string {
  const blocks: string[] = []
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      i += 1
      const buf: string[] = []
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push(`<pre>${escapeHtml(buf.join('\n'))}</pre>`)
      continue
    }
    if (line.startsWith('### ')) blocks.push(`<h3>${inline(line.slice(4))}</h3>`)
    else if (line.startsWith('## ')) blocks.push(`<h2>${inline(line.slice(3))}</h2>`)
    else if (line.startsWith('# ')) blocks.push(`<h1>${inline(line.slice(2))}</h1>`)
    else if (line.trim()) blocks.push(`<p>${inline(line)}</p>`)
    i += 1
  }
  return blocks.join('')
}

function presentNodes(canvas: MindmapCanvas): MindmapNode[] {
  return canvas.nodes.map((raw) => {
    const node = { ...raw }
    const text = node.text || ''
    if (node.id === 'root' && text.startsWith('# ') && !text.startsWith('###')) {
      const title = text.slice(2).trim()
      const boxW = title.length * CHAPTER_FONT + 72
      const boxH = CHAPTER_FONT * 1.15 + 20
      const cx = node.x + node.width / 2
      const cy = node.y + node.height / 2
      node.width = boxW
      node.height = boxH
      node.x = cx - boxW / 2
      node.y = cy - boxH / 2 - 10
    }
    return node
  })
}

function anchor(node: MindmapNode, side: string): [number, number, number, number] {
  const [fx, fy, nx, ny] = SIDE[side] ?? SIDE.right
  return [node.x + node.width * fx, node.y + node.height * fy, nx, ny]
}

function edgePath(a: MindmapNode, b: MindmapNode, fromSide: string, toSide: string): string {
  const [ax, ay, anx, any] = anchor(a, fromSide)
  const [bx, by, bnx, bny] = anchor(b, toSide)
  const dist = Math.hypot(bx - ax, by - ay)
  const pull = Math.max(28, Math.min(96, dist * 0.33))
  const c1x = ax + anx * pull
  const c1y = ay + any * pull
  const c2x = bx + bnx * pull
  const c2y = by + bny * pull
  const n = (v: number) => v.toFixed(1)
  return `M ${n(ax)} ${n(ay)} C ${n(c1x)} ${n(c1y)}, ${n(c2x)} ${n(c2y)}, ${n(bx)} ${n(by)}`
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function buildHtml(
  canvas: MindmapCanvas,
  width: number,
  height: number,
  bgSrc: string,
  board: Record<string, string>,
  useDynamicBg: boolean,
  imageSrc: Map<string, string>,
): string {
  const tok = boardStyleTokens(board)
  const pageBg = useDynamicBg ? '#ffffff' : board.SOLID_BG_COLOR || '#000000'
  const nodes = new Map(presentNodes(canvas).map((n) => [n.id, n]))
  let worldW = 1
  let worldH = 1
  for (const n of nodes.values()) {
    worldW = Math.max(worldW, n.x + n.width)
    worldH = Math.max(worldH, n.y + n.height)
  }
  const groups: string[] = []
  const cards: string[] = []
  for (const node of nodes.values()) {
    const [ink, fill] = COLORS[node.color || '6'] ?? COLORS['6']
    const style =
      `left:${node.x}px;top:${node.y}px;` +
      `width:${node.width}px;height:${node.height}px;` +
      `--ink:${ink};--fill:${fill}`
    if (node.type === 'group') {
      if (node.id === 'frame_board') continue
      const label = escapeHtml(node.label || '')
      const tag = label ? `<span class='tag'>${label}</span>` : ''
      groups.push(`<div class='group' style='${style}'>${tag}</div>`)
    } else if (node.type === 'file') {
      const img = imageSrc.get(node.id)
      if (img) {
        cards.push(
          `<div class='card file' style='${style}'><img src='${escapeHtml(img)}' alt=''></div>`,
        )
      } else {
        const miss = escapeHtml((node.file || '').trim() || '(无 file 路径)')
        cards.push(`<div class='card file missing' style='${style}'>图缺失：${miss}</div>`)
      }
    } else if (node.type === 'text' || node.text != null) {
      const text = node.text || ''
      let kind = text.startsWith('# ') && !text.startsWith('###') ? ' title' : ''
      if (node.id === 'root') kind += ' chapter'
      cards.push(`<div class='card${kind}' style='${style}'>${cardBody(text)}</div>`)
    }
  }
  const paths: string[] = []
  for (const edge of canvas.edges ?? []) {
    const src = edge.fromNode ? nodes.get(edge.fromNode) : undefined
    const dst = edge.toNode ? nodes.get(edge.toNode) : undefined
    if (!src || !dst) continue
    const [ink] = COLORS[edge.color || '6'] ?? COLORS['6']
    const d = edgePath(src, dst, edge.fromSide || 'right', edge.toSide || 'left')
    paths.push(`<path d='${d}' stroke='${ink}'/>`)
  }
  const svg =
    `<svg class='edges' width='${worldW}' height='${worldH}'>` +
    paths.join('') +
    `</svg>`
  const body = groups.join('') + cards.join('') + svg
  const bg = useDynamicBg ? `<iframe id="bg" src="${escapeHtml(bgSrc)}"></iframe>` : ''
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  html, body {
    margin: 0; width: ${width}px; height: ${height}px; overflow: hidden;
    background: ${pageBg};
  }
  #bg {
    position: absolute; left: 0; top: 0; z-index: 0;
    width: ${width}px; height: ${height}px; border: 0; pointer-events: none;
  }
  #viewport {
    position: absolute; left: 0; top: 0; z-index: 1;
    width: ${width}px; height: ${height}px; overflow: hidden;
    background: transparent;
  }
  #world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .group {
    position: absolute; z-index: 0; box-sizing: border-box; border-radius: 16px;
    background: color-mix(in srgb, var(--ink) ${tok.group_ink_mix}, transparent);
    border: 2px solid color-mix(in srgb, var(--ink) ${tok.group_border_mix}, white);
  }
  .tag {
    position: absolute; top: 5px; left: 12px;
    font: 600 13px/16px "PingFang SC", "Noto Sans CJK SC", "WenQuanYi Zen Hei", "Hiragino Sans GB", sans-serif;
    color: var(--ink);
  }
  .card {
    position: absolute; z-index: 1; box-sizing: border-box; overflow: hidden;
    border-radius: 10px;
    background: color-mix(in srgb, var(--fill) ${tok.card_fill_mix}, transparent);
    border: 1.5px solid color-mix(in srgb, var(--ink) ${tok.card_border_mix}, white);
    box-shadow: 0 1px 2px rgba(40, 30, 20, 0.06);
    padding: 18px 14px 12px;
    font: 13.5px/28px "PingFang SC", "Noto Sans CJK SC", "WenQuanYi Zen Hei", "Hiragino Sans GB", sans-serif;
    color: #2c2a28;
  }
  .card.file {
    padding: 6px;
    display: flex; align-items: center; justify-content: center;
    background: #faf9f7;
  }
  .card.file img {
    max-width: 100%; max-height: 100%; width: 100%; height: 100%;
    object-fit: contain; display: block;
  }
  .card.file.missing { font: 12px/1.4 sans-serif; color: #8a4a4a; }
  .card.title {
    display: flex; align-items: center; justify-content: center;
    padding: 8px 12px; text-align: center;
  }
  .card h1 { margin: 0; font-size: 16px; line-height: 1.35; font-weight: 650; color: #1f1d1b; }
  .card.chapter h1 {
    font-size: ${CHAPTER_FONT}px; line-height: 1.1; font-weight: 700; letter-spacing: 0.04em;
  }
  .card h2, .card h3 { margin: 0; font-size: 15px; line-height: 35px; font-weight: 650; color: #1f1d1b; }
  .card p { margin: 0; }
  .card code { font-family: "SF Mono", ui-monospace, Menlo, monospace; font-size: 0.92em; }
  .card pre {
    margin: 2px 0 4px; padding: 6px 8px; white-space: pre;
    background: rgba(255,255,255,.78); border-radius: 6px;
    font: 8.4px/20px "SF Mono", ui-monospace, Menlo, monospace;
    color: #243028;
  }
  .edges { position: absolute; left: 0; top: 0; z-index: 2; overflow: visible; pointer-events: none; }
  .edges path {
    fill: none; stroke-width: ${tok.edge_width}; stroke-linecap: round;
    opacity: ${tok.edge_opacity};
  }
</style>
</head>
<body>
${bg}
<div id="viewport"><div id="world" style="width:${worldW}px;height:${worldH}px">${body}</div></div>
<script>
const world = document.getElementById("world");
const vx = ${width / 2}, vy = ${height / 2};
window.setCamera = (cx, cy, z) => {
  world.style.transform = \`translate(\${vx}px, \${vy}px) scale(\${z}) translate(\${-cx}px, \${-cy}px)\`;
};
</script>
</body>
</html>
`
}

function fit(
  nodes: Map<string, MindmapNode>,
  focus: string | string[],
  pad: number,
  vw: number,
  vh: number,
): Cam {
  const ids = typeof focus === 'string' ? [focus] : focus
  const missing = ids.filter((id) => !nodes.has(id))
  if (missing.length) throw new Error(`时间轴里的节点不在画布中：${missing.join(', ')}`)
  const picked = ids.map((id) => nodes.get(id)!)
  const x0 = Math.min(...picked.map((n) => n.x)) - pad
  const y0 = Math.min(...picked.map((n) => n.y)) - pad
  const x1 = Math.max(...picked.map((n) => n.x + n.width)) + pad
  const y1 = Math.max(...picked.map((n) => n.y + n.height)) + pad
  const z = Math.min(vw / (x1 - x0), vh / (y1 - y0))
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, z }
}

function cameraKeys(
  shots: MindmapShot[],
  nodes: Map<string, MindmapNode>,
  padding: number,
  width: number,
  height: number,
): Key[] {
  return [...shots]
    .sort((a, b) => a.t - b.t)
    .map((shot) => ({
      t: shot.t,
      cam: fit(nodes, shot.focus, shot.padding ?? padding, width, height),
    }))
}

function shotMoves(shots: MindmapShot[]): number[] {
  const sorted = [...shots].sort((a, b) => a.t - b.t)
  const moves = [0]
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].t - sorted[i - 1].t
    moves.push(sorted[i].move ?? gap)
  }
  return moves
}

function narrationByShotIndex(items?: PerShotNarration[]): Map<number, PerShotNarration> {
  const map = new Map<number, PerShotNarration>()
  if (!items?.length) return map
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const idx = item.shot_index ?? i
    if (idx >= 0) map.set(idx, item)
  }
  return map
}

/** 按镜 duration_sec / per_shot_narration 重算 shots.t 与成片尾停顿时长 */
export async function retimeMindmapShots(
  shots: MindmapShot[],
  holdEnd: number,
  perShotNarration?: PerShotNarration[],
): Promise<{ shots: MindmapShot[]; endHoldSec: number; retimed: boolean }> {
  const narr = narrationByShotIndex(perShotNarration)
  const n = shots.length
  const segmentSec: number[] = []

  for (let i = 0; i < n; i++) {
    const shot = shots[i]
    const meta = narr.get(i)
    let seg: number | undefined

    if (typeof shot.duration_sec === 'number' && shot.duration_sec > 0) {
      seg = shot.duration_sec
    } else if (typeof meta?.duration_sec === 'number' && meta.duration_sec > 0) {
      seg = meta.duration_sec
    } else {
      const audioRef = shot.audio_src?.trim() || meta?.audio_src?.trim()
      if (audioRef) {
        seg = await probeDurationSec(resolveMediaSrc(audioRef))
      } else if (i < n - 1) {
        const gap = shots[i + 1].t - shot.t
        if (gap > 0) seg = gap
      }
    }
    segmentSec.push(seg ?? (i === n - 1 ? holdEnd : 0))
  }

  const needsRetime = shots.some(
    (s, i) =>
      (typeof s.duration_sec === 'number' && s.duration_sec > 0) ||
      narr.has(i) ||
      Boolean(s.audio_src?.trim()),
  )

  if (!needsRetime) {
    const ordered = [...shots]
    return { shots: ordered, endHoldSec: holdEnd, retimed: false }
  }

  let t = 0
  const retimedShots: MindmapShot[] = []
  for (let i = 0; i < n; i++) {
    const shot = shots[i]
    retimedShots.push({ ...shot, t })
    if (i < n - 1 && segmentSec[i] > 0) t += segmentSec[i]
  }
  const endHoldSec =
    segmentSec[n - 1] > 0 ? segmentSec[n - 1] : holdEnd

  return { shots: retimedShots, endHoldSec, retimed: true }
}

async function resolveMindmapNarrationSrc(
  input: RenderMindmapInput,
  narr: Map<number, PerShotNarration>,
  workDir: string,
): Promise<string | undefined> {
  const top = input.audio_src?.trim()
  if (top) return top

  const sources: string[] = []
  for (let i = 0; i < input.shots.length; i++) {
    const shot = input.shots[i]
    const meta = narr.get(i)
    const src = shot.audio_src?.trim() || meta?.audio_src?.trim()
    if (src) sources.push(src)
  }
  if (!sources.length) return undefined
  if (sources.length === 1) return sources[0]
  const merged = await concatAudioSourcesInWork(sources, workDir)
  return merged
}

function smoothstep(u: number): number {
  const x = Math.max(0, Math.min(1, u))
  return x * x * (3 - 2 * x)
}

function sample(keys: Key[], moves: number[], t: number): Cam {
  if (t <= keys[0].t) return keys[0].cam
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t > b.t) continue
    const gap = b.t - a.t
    const move = Math.max(0, Math.min(moves[i + 1], gap))
    const start = b.t - move
    if (t <= start || move === 0) return a.cam
    const s = smoothstep((t - start) / move)
    const z = Math.exp(Math.log(a.cam.z) + (Math.log(b.cam.z) - Math.log(a.cam.z)) * s)
    return {
      cx: a.cam.cx + (b.cam.cx - a.cam.cx) * s,
      cy: a.cam.cy + (b.cam.cy - a.cam.cy) * s,
      z,
    }
  }
  return keys[keys.length - 1].cam
}

function writableOutputDir(): string {
  try {
    mkdirSync(outputDir, { recursive: true })
    const probe = resolve(outputDir, `.write-probe-${process.pid}`)
    writeFileSync(probe, '')
    rmSync(probe)
    return outputDir
  } catch {
    return mkdtempSync(resolve(tmpdir(), 'g-ppt-out-'))
  }
}

function whichFfmpeg(): string {
  try {
    const exe = execSync('command -v ffmpeg', { encoding: 'utf8', shell: '/bin/sh' }).trim()
    if (exe) return exe
  } catch {
    /* fall through */
  }
  throw new Error('ffmpeg not found on PATH; required for mindmap mp4')
}

function mime(file: string): string {
  switch (extname(file).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return 'text/plain; charset=utf-8'
  }
}

function serveDir(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      let rel = decodeURIComponent(url.pathname)
      if (rel.endsWith('/')) rel += 'board.html'
      const file = resolve(dir, `.${rel}`)
      const rootDir = dir.endsWith('/') ? dir : `${dir}/`
      if (!file.startsWith(rootDir) || !existsSync(file)) {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, {
        'Content-Type': mime(file),
        'Cache-Control': 'no-store',
      })
      res.end(readFileSync(file))
    } catch {
      res.writeHead(400)
      res.end()
    }
  })
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolvePromise({
        url: `http://127.0.0.1:${port}/board.html`,
        close: () =>
          new Promise((done) => {
            server.close(() => done())
          }),
      })
    })
  })
}

function copyDemo(dest: string) {
  for (const name of DEMO_FILES) {
    const file = resolve(publicDir, name)
    if (!existsSync(file)) {
      if (name.endsWith('.env')) continue
      throw new Error(`找不到动态图标：${file}`)
    }
    copyFileSync(file, resolve(dest, name))
  }
}

function stageImages(
  canvas: MindmapCanvas,
  assetDir: string,
  files: Record<string, string> | undefined,
  vault: string | undefined,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const node of canvas.nodes) {
    if (node.type !== 'file') continue
    const rel = (node.file || '').trim()
    const mapped = (rel && files?.[rel]) || rel
    if (!mapped) continue
    let src: string | null = null
    const candidates = [mapped]
    if (vault && rel) candidates.push(resolve(vault, rel))
    for (const cand of candidates) {
      try {
        src = resolveMediaSrc(cand)
        break
      } catch {
        src = null
      }
    }
    if (!src || !IMG_SUFFIX.has(extname(src).toLowerCase())) continue
    mkdirSync(assetDir, { recursive: true })
    const destName = `${safeId(node.id)}${extname(src).toLowerCase()}`
    copyFileSync(src, resolve(assetDir, destName))
    out.set(node.id, `assets/${destName}`)
  }
  return out
}

async function encodeJpg(framesDir: string, fps: number, outPath: string) {
  mkdirSync(dirname(outPath), { recursive: true })
  await execFileAsync(whichFfmpeg(), [
    '-y',
    '-framerate',
    String(fps),
    '-start_number',
    '0',
    '-i',
    resolve(framesDir, 'frame_%04d.jpg'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '18',
    '-movflags',
    '+faststart',
    outPath,
  ])
}

export function loadMindmapTimeline(timelinePath: string, vault?: string): RenderMindmapInput {
  const timelineFile = resolve(timelinePath)
  const timeline = JSON.parse(readFileSync(timelineFile, 'utf8')) as {
    canvas: string
    width?: number
    height?: number
    fps?: number
    padding?: number
    hold_end?: number
    shots: MindmapShot[]
  }
  const canvasPath = resolve(dirname(timelineFile), timeline.canvas)
  if (!existsSync(canvasPath)) throw new Error(`找不到画布：${canvasPath}`)
  const canvas = JSON.parse(readFileSync(canvasPath, 'utf8')) as MindmapCanvas
  return {
    canvas,
    shots: timeline.shots,
    width: timeline.width,
    height: timeline.height,
    fps: timeline.fps,
    padding: timeline.padding,
    hold_end: timeline.hold_end,
    vault: vault ? resolve(vault) : undefined,
  }
}

export async function apiRenderMindmap(
  input: RenderMindmapInput,
): Promise<RenderMindmapResult> {
  if (!input.canvas?.nodes?.length) throw new Error('canvas.nodes 为空')
  if (!input.shots?.length) throw new Error('shots 为空')
  const width = input.width ?? 2560
  const height = input.height ?? 1440
  const fps = input.fps ?? 24
  const padding = input.padding ?? 48
  const hold = input.hold_end ?? 1.5
  const board = boardEnv(input.board)
  const useDynamicBg =
    input.dynamic_bg == null ? envBool(board.USE_DYNAMIC_BG, true) : input.dynamic_bg
  const timeline = await retimeMindmapShots(
    input.shots,
    hold,
    input.per_shot_narration,
  )
  const shots = timeline.shots
  const nodes = new Map(input.canvas.nodes.map((n) => [n.id, n]))
  const keys = cameraKeys(shots, nodes, padding, width, height)
  const moves = shotMoves(shots)
  const duration = keys[keys.length - 1].t + timeline.endHoldSec
  const narrByIndex = narrationByShotIndex(input.per_shot_narration)
  const stills = input.stills?.filter((t) => Number.isFinite(t))
  const times = stills?.length
    ? stills
    : Array.from({ length: Math.round(duration * fps) }, (_, i) => i / fps)
  if (!times.length) throw new Error('没有可渲染的帧')
  const cameras = times.map((t) => sample(keys, moves, t))
  const stem = safeOutputFilename(
    input.filename,
    stills?.length ? 'mindmap-still.png' : 'mindmap.mp4',
  ).replace(/\.(mp4|png|jpe?g)$/i, '')

  const destRoot = writableOutputDir()
  return withRenderGate(async () => {
    const work = mkdtempSync(resolve(tmpdir(), 'g-ppt-mindmap-'))
    const framesDir = resolve(work, 'frames')
    let server: { close: () => Promise<void> } | null = null
    try {
      const assetDir = resolve(work, 'assets')
      const imageSrc = stageImages(input.canvas, assetDir, input.files, input.vault)
      const bgSrc = useDynamicBg ? buildBgSrc(parseEnv(toneEnvFile)) : ''
      writeFileSync(
        resolve(work, 'board.html'),
        buildHtml(input.canvas, width, height, bgSrc, board, useDynamicBg, imageSrc),
      )
      if (useDynamicBg) copyDemo(work)
      const served = await serveDir(work)
      server = served
      await runScreenshotWorker(
        {
          mode: 'mindmap',
          url: served.url,
          width,
          height,
          times,
          cameras,
          outDir: framesDir,
          suffix: stills?.length ? 'png' : 'jpg',
          quality: stills?.length ? 100 : 86,
          useDynamicBg,
        },
        {
          onStderr: (line) => {
            const m = /^mindmap-frame (\d+) (\d+)$/.exec(line.trim())
            if (!m || !input.onProgress) return
            input.onProgress({ frame: Number(m[1]), total: Number(m[2]) })
          },
        },
      )
      mkdirSync(destRoot, { recursive: true })
      if (stills?.length) {
        const paths = times.map((_, i) => {
          const name = `${stem}_${String(i).padStart(4, '0')}.png`
          const dest = resolve(destRoot, name)
          copyFileSync(resolve(framesDir, `frame_${String(i).padStart(4, '0')}.png`), dest)
          return dest
        })
        return {
          ok: true,
          format: 'png',
          path: paths[0],
          paths,
          total_sec: duration,
          frames: paths.length,
          width,
          height,
        }
      }
      const dest = resolve(destRoot, `${stem}.mp4`)
      const silentMp4 = resolve(work, 'silent.mp4')
      await encodeJpg(framesDir, fps, silentMp4)
      const audioSrc = await resolveMindmapNarrationSrc(input, narrByIndex, work)
      let totalSec = duration
      if (audioSrc) {
        const muxed = await muxNarrationOntoVideo(
          silentMp4,
          dest,
          {
            audio_src: audioSrc,
            bgm_src: input.bgm_src,
            bgm_volume: input.bgm_volume,
            subtitle_src: input.subtitle_src,
            cues: input.cues,
            burn_in: input.burn_in,
          },
          work,
        )
        totalSec = muxed.total_sec
      } else {
        copyFileSync(silentMp4, dest)
      }
      return {
        ok: true,
        format: 'mp4',
        path: dest,
        total_sec: totalSec,
        frames: times.length,
        width,
        height,
      }
    } finally {
      if (server) await server.close()
      rmSync(work, { recursive: true, force: true })
    }
  })
}
