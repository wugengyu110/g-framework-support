/**
 * 共享渲染引擎：CLI 与 Node API 共用
 */
import { execFile, execSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { buildCatalog, validateTemplateProps } from '../frontend/src/lib/catalog'
import { buildLayoutRules } from '../frontend/src/lib/layout-rules'
import { getTemplate, listPacks, listTemplates } from '../frontend/src/registry/templates'

const execFileAsync = promisify(execFile)

/** 渲染时再加载，避免 API 启动被 Vite 卡住 */
async function loadVite() {
  return import('vite')
}

/**
 * Playwright 必须在独立 Node 子进程里跑。
 * vite-node 会劫持动态 import，chromium.launch 时常报：
 * "The server is being restarted or closed. Request is outdated"
 */
type WorkerResult = {
  ok?: boolean
  error?: string
  path?: string
  trimStartSec?: number
  durationSec?: number
}

function runScreenshotWorker(job: Record<string, unknown>): Promise<WorkerResult> {
  const worker = resolve(root, 'tools/screenshot-worker.mjs')
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [worker], {
      cwd: frontendRoot,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []
    child.stdout.on('data', (c) => chunks.push(c))
    child.stderr.on('data', (c) => errChunks.push(c))
    child.on('error', reject)
    child.on('close', (code) => {
      const out = Buffer.concat(chunks).toString('utf8').trim()
      const errText = Buffer.concat(errChunks).toString('utf8').trim()
      let parsed: WorkerResult | null = null
      try {
        parsed = out ? (JSON.parse(out) as WorkerResult) : null
      } catch {
        /* fall through */
      }
      if (code === 0 && parsed?.ok) {
        resolvePromise(parsed)
        return
      }
      reject(
        new Error(
          parsed?.error ||
            errText ||
            out ||
            `screenshot-worker exited with code ${code}`,
        ),
      )
    })
    child.stdin.end(JSON.stringify(job))
  })
}

function isLiveTemplate(templateId: string): boolean {
  return Boolean(getTemplate(templateId)?.live)
}

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const frontendRoot = resolve(root, 'frontend')
export const outputDir = resolve(root, 'output')

/** 成片/截图输出名：保留中文，去掉空格与路径危险字符。 */
export function safeOutputFilename(name: string | undefined, fallback: string): string {
  const raw = (name || '').trim() || fallback
  const base = raw.split(/[/\\]/).pop() || fallback
  const cleaned = base
    .replace(/[\s\u00a0\u3000\\/:*?"<>|]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
  return cleaned || fallback
}
export const assetsDir = resolve(root, 'assets')
export const catalogFile = resolve(root, 'catalog/catalog.json')
export const distDir = resolve(frontendRoot, 'dist')

/** 同时进行的渲染任务上限，默认 1 */
export function getRenderConcurrency(): number {
  const n = Number(process.env.G_PPT_CONCURRENCY || 1)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

function createSemaphore(limit: number) {
  let active = 0
  const waiters: Array<() => void> = []
  return {
    async acquire() {
      if (active >= limit) {
        await new Promise<void>((r) => waiters.push(r))
      }
      active++
    },
    release() {
      active--
      waiters.shift()?.()
    },
  }
}

const renderGate = createSemaphore(getRenderConcurrency())

async function withRenderGate<T>(fn: () => Promise<T>): Promise<T> {
  await renderGate.acquire()
  try {
    return await fn()
  } finally {
    renderGate.release()
  }
}

/** 相对该 scene 起点的字幕 cue（秒） */
export type SubtitleCue = {
  start: number
  end: number
  text: string
}

/** 旁白 / 分段字幕（各 scene 可选） */
export type NarrationFields = {
  /** 该段旁白；有则画面时长跟音频走 */
  audio_src?: string
  /** 相对本段起点的字幕 */
  cues?: SubtitleCue[]
}

/** 模板页（缺省 kind，兼容旧 JSON） */
export type TemplateScene = {
  kind?: 'template'
  template_id: string
  props: Record<string, unknown>
  duration_sec?: number
} & NarrationFields

/** 时间轴上的静图片段 */
export type ImageScene = {
  kind: 'image'
  /** 单图：本地绝对路径 / assets 内文件名 / asset:<id> */
  src?: string
  /** 同页多图：与 src 二选一或同时给（优先 srcs）；引擎拼网格后再 contain */
  srcs?: string[]
  duration_sec?: number
  fit?: 'contain' | 'cover'
} & NarrationFields

/** 时间轴上的已有视频片段 */
export type VideoScene = {
  kind: 'video'
  src: string
  /** 裁剪起点（秒），默认 0 */
  trim_start_sec?: number
  /** 裁剪终点（秒）；省略则到片尾 */
  trim_end_sec?: number
} & NarrationFields

export type Scene = TemplateScene | ImageScene | VideoScene

/** Show 级右下角圆形人像画中画 */
export type PresenterOverlay = {
  /** asset:<id> / assets 相对路径 / 绝对路径 */
  src: string
  /** 圆形直径 px，默认 280 */
  size?: number
  /** 距右/下边距 px，默认 48 */
  margin?: number
  /** true 保留人像音轨；默认 false（静音） */
  keep_audio?: boolean
}

export type TimelineEntry = {
  index: number
  kind: 'template' | 'image' | 'video'
  template_id?: string
  src?: string
  audio_src?: string
  duration_sec: number
  start_sec: number
  end_sec: number
}

function sceneKind(sc: Scene): 'template' | 'image' | 'video' {
  if (sc.kind === 'image' || sc.kind === 'video') return sc.kind
  return 'template'
}

function encodeProps(props: unknown): string {
  return Buffer.from(JSON.stringify(props), 'utf8').toString('base64url')
}

async function withRenderOrigin<T>(fn: (origin: string) => Promise<T>): Promise<T> {
  const base = process.env.G_PPT_RENDER_BASE_URL?.replace(/\/$/, '')
  if (base) return fn(base)

  const { createServer } = await loadVite()
  const port = 42000 + Math.floor(Math.random() * 2000)
  const server = await createServer({
    root: frontendRoot,
    configFile: resolve(frontendRoot, 'vite.config.ts'),
    server: { port, strictPort: true, host: '127.0.0.1' },
  })
  await server.listen()
  const origin = `http://127.0.0.1:${port}`
  try {
    return await fn(origin)
  } finally {
    await server.close()
  }
}

function slideRenderUrl(
  origin: string,
  templateId: string,
  props: unknown,
): string {
  return `${origin}/?mode=render&id=${encodeURIComponent(templateId)}&props=${encodeProps(props)}`
}

export async function screenshotSlide(
  templateId: string,
  props: unknown,
  outPng: string,
): Promise<void> {
  const check = validateTemplateProps(templateId, props)
  if (!check.ok) {
    throw new Error(`props validation failed: ${check.error}`)
  }
  mkdirSync(dirname(outPng), { recursive: true })

  await withRenderOrigin(async (origin) => {
    await runScreenshotWorker({
      url: slideRenderUrl(origin, templateId, check.data),
      outPng,
    })
  })
}

/** live 模板：按时长录屏（webm），保留 iframe / CSS 动效 */
export async function recordSlide(
  templateId: string,
  props: unknown,
  outVideo: string,
  durationSec: number,
): Promise<{ trimStartSec: number; durationSec: number }> {
  const check = validateTemplateProps(templateId, props)
  if (!check.ok) {
    throw new Error(`props validation failed: ${check.error}`)
  }
  if (!(durationSec > 0)) {
    throw new Error(`invalid record duration: ${durationSec}`)
  }
  mkdirSync(dirname(outVideo), { recursive: true })

  return withRenderOrigin(async (origin) => {
    const result = await runScreenshotWorker({
      url: slideRenderUrl(origin, templateId, check.data),
      outVideo,
      durationSec,
    })
    return {
      trimStartSec: Number(result.trimStartSec ?? 0),
      durationSec: Number(result.durationSec ?? durationSec),
    }
  })
}

function whichCmd(cmd: string): string | null {
  try {
    return execSync(`command -v ${cmd}`, { encoding: 'utf8', shell: '/bin/sh' }).trim() || null
  } catch {
    return null
  }
}

function whichFfmpeg(): string | null {
  return whichCmd('ffmpeg')
}

function whichFfprobe(): string | null {
  return whichCmd('ffprobe')
}

function requireFfmpeg(): string {
  const ffmpeg = whichFfmpeg()
  if (!ffmpeg) {
    throw new Error(
      'ffmpeg not found on PATH; required for mp4 output. Install ffmpeg or use format=png',
    )
  }
  return ffmpeg
}

/** 成片画幅 4:3（与 frontend / screenshot-worker VIEWPORT 一致） */
const CANVAS_W = 1920
const CANVAS_H = 1440
/** 硬烧字幕：字号合适时按画幅算一行容量，避免 14 字就折 */
const SUB_FONT_SIZE = 72
const SUB_MARGIN_X = 140
const SUB_MARGIN_V = 96
const SUB_SPACING = 1
const SUB_MAX_PER_LINE = Math.max(
  8,
  Math.floor((CANVAS_W - SUB_MARGIN_X * 2 - 64) / (SUB_FONT_SIZE + SUB_SPACING)),
)
const VF_CONTAIN =
  `scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=decrease,pad=${CANVAS_W}:${CANVAS_H}:(ow-iw)/2:(oh-ih)/2,setsar=1`
const VF_COVER =
  `scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=increase,crop=${CANVAS_W}:${CANVAS_H},setsar=1`

function escapeConcatPath(p: string): string {
  return p.replace(/'/g, "'\\''")
}

/** 解析 scene.src → 本地可读路径 */
export function resolveMediaSrc(src: string): string {
  const raw = src.trim()
  if (!raw) throw new Error('media src is empty')

  if (raw.startsWith('asset:')) {
    const id = raw.slice('asset:'.length).replace(/^\/+/, '')
    const p = resolve(assetsDir, id)
    if (!p.startsWith(assetsDir) || !existsSync(p)) {
      throw new Error(`asset not found: ${id}`)
    }
    return p
  }

  if (raw.startsWith('/') || /^[A-Za-z]:[\\/]/.test(raw)) {
    const p = resolve(raw)
    if (!existsSync(p)) throw new Error(`media file not found: ${p}`)
    return p
  }

  const underAssets = resolve(assetsDir, raw)
  if (underAssets.startsWith(assetsDir) && existsSync(underAssets)) {
    return underAssets
  }

  const asAbs = resolve(raw)
  if (existsSync(asAbs)) return asAbs

  throw new Error(
    `media not found: ${src} (upload via POST /api/assets, or use asset:<id> / absolute path)`,
  )
}

export function saveAsset(
  data: Buffer,
  originalName: string,
): { id: string; path: string; url: string; content_type: string; size: number } {
  mkdirSync(assetsDir, { recursive: true })
  const base = originalName.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '') || 'file'
  const id = `${randomUUID()}_${base}`
  const dest = resolve(assetsDir, id)
  if (!dest.startsWith(assetsDir)) throw new Error('invalid asset name')
  writeFileSync(dest, data)
  const ext = base.split('.').pop()?.toLowerCase()
  const content_type =
    ext === 'mp4' || ext === 'webm' || ext === 'mov'
      ? `video/${ext === 'mov' ? 'quicktime' : ext}`
      : ext === 'png'
        ? 'image/png'
        : ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'gif'
              ? 'image/gif'
              : ext === 'mp3'
                ? 'audio/mpeg'
                : ext === 'wav'
                  ? 'audio/wav'
                  : ext === 'aac' || ext === 'm4a'
                    ? 'audio/mp4'
                    : ext === 'ogg' || ext === 'opus'
                      ? 'audio/ogg'
                      : ext === 'srt'
                        ? 'application/x-subrip'
                        : ext === 'vtt'
                          ? 'text/vtt'
                          : 'application/octet-stream'
  return {
    id,
    path: dest,
    url: `/media/${encodeURIComponent(id)}`,
    content_type,
    size: data.length,
  }
}

async function probeDurationSec(filePath: string): Promise<number> {
  const ffprobe = whichFfprobe()
  if (!ffprobe) {
    throw new Error('ffprobe not found on PATH; required for video scenes')
  }
  const { stdout } = await execFileAsync(
    ffprobe,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { encoding: 'utf8' },
  )
  const n = Number(String(stdout).trim())
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`cannot probe duration: ${filePath}`)
  }
  return n
}

async function hasAudioStream(filePath: string): Promise<boolean> {
  const ffprobe = whichFfprobe()
  if (!ffprobe) return false
  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_type',
        '-of',
        'csv=p=0',
        filePath,
      ],
      { encoding: 'utf8' },
    )
    return String(stdout).trim().length > 0
  } catch {
    return false
  }
}

/** 静帧 → 统一规格 clip（含静音轨，便于 concat） */
export async function pngToMp4(pngPath: string, mp4Path: string, durationSec: number) {
  await imageToClip(pngPath, mp4Path, durationSec, 'contain')
}

function imageSceneSources(img: ImageScene): string[] {
  const many = (img.srcs ?? []).map((s) => String(s || '').trim()).filter(Boolean)
  if (many.length) return many
  const one = String(img.src || '').trim()
  return one ? [one] : []
}

/** 多张静图拼成一页网格（深色底），再交给 imageToClip。 */
async function composeImageGrid(paths: string[], outPng: string): Promise<string> {
  if (paths.length === 1) return paths[0]
  const ffmpeg = requireFfmpeg()
  mkdirSync(dirname(outPng), { recursive: true })
  const n = paths.length
  const cols = n <= 3 ? n : n <= 4 ? 2 : 3
  const rows = Math.ceil(n / cols)
  const gap = 28
  const cellW = Math.max(160, Math.floor((CANVAS_W - gap * (cols + 1)) / cols))
  const cellH = Math.max(160, Math.floor((CANVAS_H - gap * (rows + 1)) / rows))
  const scales = paths.map(
    (_, i) =>
      `[${i}:v]scale=${cellW}:${cellH}:force_original_aspect_ratio=decrease,pad=${cellW}:${cellH}:(ow-iw)/2:(oh-ih)/2:color=0x0f1419,setsar=1[s${i}]`,
  )
  const layout = paths
    .map((_, i) => {
      const r = Math.floor(i / cols)
      const c = i % cols
      return `${gap + c * (cellW + gap)}_${gap + r * (cellH + gap)}`
    })
    .join('|')
  const stacked = `${paths.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${n}:layout=${layout}:fill=0x0f1419[v]`
  const args: string[] = ['-y']
  for (const p of paths) {
    args.push('-i', p)
  }
  args.push('-filter_complex', `${scales.join(';')};${stacked}`, '-map', '[v]', '-frames:v', '1', outPng)
  await execFileAsync(ffmpeg, args)
  return outPng
}

async function imageToClip(
  imagePath: string,
  mp4Path: string,
  durationSec: number,
  fit: 'contain' | 'cover' = 'contain',
) {
  const ffmpeg = requireFfmpeg()
  mkdirSync(dirname(mp4Path), { recursive: true })
  const vf = fit === 'cover' ? VF_COVER : VF_CONTAIN
  await execFileAsync(ffmpeg, [
    '-y',
    '-loop',
    '1',
    '-i',
    imagePath,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-t',
    String(durationSec),
    '-r',
    '30',
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    mp4Path,
  ])
}

async function videoToClip(
  videoPath: string,
  mp4Path: string,
  opts: { trim_start_sec?: number; trim_end_sec?: number } = {},
): Promise<number> {
  const ffmpeg = requireFfmpeg()
  mkdirSync(dirname(mp4Path), { recursive: true })
  const start = Math.max(0, Number(opts.trim_start_sec ?? 0))
  const full = await probeDurationSec(videoPath)
  const end =
    opts.trim_end_sec !== undefined ? Number(opts.trim_end_sec) : full
  if (!(end > start)) {
    throw new Error(`invalid video trim: start=${start} end=${end}`)
  }
  const duration = end - start
  const args = ['-y', '-ss', String(start), '-to', String(end), '-i', videoPath]
  const audio = await hasAudioStream(videoPath)
  if (!audio) {
    args.push(
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=44100',
    )
  }
  args.push(
    '-vf',
    `${VF_CONTAIN},fps=30`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-t',
    String(duration),
  )
  if (audio) {
    args.push('-map', '0:v:0', '-map', '0:a:0?', '-shortest')
  } else {
    args.push('-map', '0:v:0', '-map', '1:a:0', '-shortest')
  }
  args.push(mp4Path)
  await execFileAsync(ffmpeg, args)
  return duration
}

async function concatClips(clipPaths: string[], mp4Path: string) {
  const ffmpeg = requireFfmpeg()
  if (!clipPaths.length) throw new Error('no clips to concat')
  const dir = mkdtempSync(resolve(tmpdir(), 'g-ppt-show-'))
  try {
    const listPath = resolve(dir, 'concat.txt')
    const lines = clipPaths.map((p) => `file '${escapeConcatPath(p)}'`)
    writeFileSync(listPath, lines.join('\n') + '\n')
    mkdirSync(dirname(mp4Path), { recursive: true })
    await execFileAsync(ffmpeg, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c',
      'copy',
      mp4Path,
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 用旁白替换 clip 音轨；画面时长已按音频对齐时用 -shortest 即可 */
async function replaceAudioTrack(
  videoPath: string,
  audioPath: string,
  outPath: string,
  durationSec: number,
) {
  const ffmpeg = requireFfmpeg()
  mkdirSync(dirname(outPath), { recursive: true })
  await execFileAsync(ffmpeg, [
    '-y',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-t',
    String(durationSec),
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-shortest',
    outPath,
  ])
}

/** 旁白与原片音轨混音；无原片音轨时退化为 replaceAudioTrack */
async function mixNarrationWithOriginal(
  videoPath: string,
  audioPath: string,
  outPath: string,
  durationSec: number,
) {
  const ffmpeg = requireFfmpeg()
  mkdirSync(dirname(outPath), { recursive: true })
  if (!(await hasAudioStream(videoPath))) {
    await replaceAudioTrack(videoPath, audioPath, outPath, durationSec)
    return
  }
  await execFileAsync(ffmpeg, [
    '-y',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-t',
    String(durationSec),
    '-filter_complex',
    '[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0[a]',
    '-map',
    '0:v:0',
    '-map',
    '[a]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-shortest',
    outPath,
  ])
}

/**
 * 成片混入循环 BGM。
 * volume：0–1（相对旁白/主音轨）；主片无音轨时仅用 BGM。
 */
async function mixBgmTrack(
  videoPath: string,
  bgmPath: string,
  outPath: string,
  durationSec: number,
  volume: number,
) {
  const ffmpeg = requireFfmpeg()
  mkdirSync(dirname(outPath), { recursive: true })
  const vol = Math.max(0, Math.min(1, volume))
  const t = Math.max(0.05, durationSec)
  const mainHasAudio = await hasAudioStream(videoPath)
  if (!mainHasAudio) {
    await execFileAsync(ffmpeg, [
      '-y',
      '-stream_loop',
      '-1',
      '-i',
      bgmPath,
      '-i',
      videoPath,
      '-t',
      String(t),
      '-filter_complex',
      `[0:a]volume=${vol}[a]`,
      '-map',
      '1:v:0',
      '-map',
      '[a]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-shortest',
      outPath,
    ])
    return
  }
  await execFileAsync(ffmpeg, [
    '-y',
    '-i',
    videoPath,
    '-stream_loop',
    '-1',
    '-i',
    bgmPath,
    '-t',
    String(t),
    '-filter_complex',
    `[1:a]volume=${vol},atrim=0:${t},asetpts=PTS-STARTPTS[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0[a]`,
    '-map',
    '0:v:0',
    '-map',
    '[a]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-shortest',
    outPath,
  ])
}

/** 将画面 clip 对齐到目标时长（长则截断；短则循环再截断，与 presenter 一致） */
async function fitClipDuration(
  clipPath: string,
  outPath: string,
  targetSec: number,
  sourceSec: number,
) {
  const ffmpeg = requireFfmpeg()
  const needLoop = sourceSec + 0.05 < targetSec
  const args: string[] = ['-y']
  if (needLoop) args.push('-stream_loop', '-1')
  args.push(
    '-i',
    clipPath,
    '-t',
    String(targetSec),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    outPath,
  )
  await execFileAsync(ffmpeg, args)
}

function sceneAudioSrc(sc: Scene): string | undefined {
  return sc.audio_src?.trim() || undefined
}

/** 有旁白时以音频时长为准；否则用 fallback */
async function resolveNarratedDuration(
  audioSrc: string | undefined,
  fallbackSec: number,
): Promise<{ duration_sec: number; audioPath?: string }> {
  if (!audioSrc) return { duration_sec: fallbackSec }
  const audioPath = resolveMediaSrc(audioSrc)
  const duration_sec = await probeDurationSec(audioPath)
  return { duration_sec, audioPath }
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function formatSrtTimestamp(sec: number): string {
  const s = Math.max(0, sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const whole = Math.floor(s % 60)
  const ms = Math.round((s - Math.floor(s)) * 1000)
  return `${pad2(h)}:${pad2(m)}:${pad2(whole)},${String(ms).padStart(3, '0')}`
}

function buildSrtFromSceneCues(
  timeline: TimelineEntry[],
  scenes: Scene[],
): string | null {
  const blocks: string[] = []
  let idx = 1
  for (let i = 0; i < scenes.length; i++) {
    const cues = scenes[i].cues
    if (!cues?.length) continue
    const base = timeline[i]?.start_sec ?? 0
    for (const cue of cues) {
      const start = Number(cue.start)
      const end = Number(cue.end)
      const text = String(cue.text ?? '').trim()
      if (!(end > start) || !text) continue
      blocks.push(
        `${idx}\n${formatSrtTimestamp(base + start)} --> ${formatSrtTimestamp(base + end)}\n${text}\n`,
      )
      idx++
    }
  }
  return blocks.length ? blocks.join('\n') + '\n' : null
}

function escapeSubtitlesFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

/** 中文硬烧折行：优先标点，其次定长；仅在超出一行容量时才折。 */
function wrapZhSubtitle(text: string, maxPerLine = SUB_MAX_PER_LINE): string {
  const s = text.replace(/[\r\n]+/g, '').trim()
  if (!s) return ''
  if (s.length <= maxPerLine) return s
  const lines: string[] = []
  let rest = s
  while (rest.length > maxPerLine) {
    let cut = maxPerLine
    const window = rest.slice(0, maxPerLine + 6)
    let punct = -1
    for (const ch of ['，', '。', '、', '；', '！', '？', ',', '!', '?', '：', ':']) {
      punct = Math.max(punct, window.lastIndexOf(ch))
    }
    if (punct >= Math.floor(maxPerLine * 0.45)) cut = punct + 1
    lines.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest) lines.push(rest)
  return lines.join('\\N')
}

function srtTimestampToAss(ts: string): string {
  const m = ts.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/)
  if (!m) return '0:00:00.00'
  const h = Number(m[1])
  const min = pad2(Number(m[2]))
  const sec = pad2(Number(m[3]))
  const frac = m[4].padEnd(3, '0').slice(0, 3)
  const cs = pad2(Math.min(99, Math.round(Number(frac) / 10)))
  return `${h}:${min}:${sec}.${cs}`
}

/** SRT → ASS（显式 PlayRes + 折行）。SRT+force_style 对中文长句经常不换行。 */
function srtToAss(srtBody: string): string {
  const blocks = srtBody.replace(/^\uFEFF/, '').trim().split(/\n\s*\n/)
  const dialogues: string[] = []
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trimEnd())
    if (lines.length < 2) continue
    let i = 0
    if (/^\d+$/.test(lines[0].trim())) i = 1
    const m = lines[i]?.match(
      /^(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/,
    )
    if (!m) continue
    const text = lines
      .slice(i + 1)
      .join('')
      .replace(/\{\\an\d\}/g, '')
      .trim()
    if (!text) continue
    dialogues.push(
      `Dialogue: 0,${srtTimestampToAss(m[1])},${srtTimestampToAss(m[2])},Default,,0,0,0,,${wrapZhSubtitle(text)}`,
    )
  }
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${CANVAS_W}`,
    `PlayResY: ${CANVAS_H}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // ChillRoundM（寒蝉半圆体）：圆润易读；4:3 画幅下略抬底边距
    `Style: Default,ChillRoundM,${SUB_FONT_SIZE},&H00FFFFFF,&H000000FF,&H00202020,&H80000000,0,0,0,0,100,100,${SUB_SPACING},0,1,3.5,1.5,2,${SUB_MARGIN_X},${SUB_MARGIN_X},${SUB_MARGIN_V},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...dialogues,
    '',
  ].join('\n')
}

async function burnSubtitles(videoPath: string, srtPath: string, outPath: string) {
  const ffmpeg = requireFfmpeg()
  mkdirSync(dirname(outPath), { recursive: true })
  // 经实测：subtitles=…:force_style 对长中文常常不换行且字号失控；改 ASS+ass= 滤镜
  const assPath = srtPath.replace(/\.srt$/i, '.ass')
  writeFileSync(assPath, srtToAss(readFileSync(srtPath, 'utf8')))
  const escaped = escapeSubtitlesFilterPath(assPath)
  await execFileAsync(ffmpeg, [
    '-y',
    '-i',
    videoPath,
    '-vf',
    `ass=${escaped}`,
    '-c:a',
    'copy',
    outPath,
  ])
}

async function muxSoftSubtitles(videoPath: string, srtPath: string, outPath: string) {
  const ffmpeg = requireFfmpeg()
  mkdirSync(dirname(outPath), { recursive: true })
  await execFileAsync(ffmpeg, [
    '-y',
    '-i',
    videoPath,
    '-i',
    srtPath,
    '-c:v',
    'copy',
    '-c:a',
    'copy',
    '-c:s',
    'mov_text',
    '-metadata:s:s:0',
    'language=zho',
    outPath,
  ])
}

/** title 封面时段不叠人像（ffmpeg overlay enable 表达式；null=全程显示） */
function presenterEnableExpr(timeline: TimelineEntry[]): string | null {
  const hide = timeline.filter((e) => {
    if (e.kind !== 'template' || !e.template_id) return false
    return getTemplate(e.template_id)?.type === 'title'
  })
  if (!hide.length) return null
  if (hide.length === timeline.length) return '0'
  const parts = hide.map(
    (e) => `between(t,${e.start_sec.toFixed(3)},${e.end_sec.toFixed(3)})`,
  )
  return `not(${parts.join('+')})`
}

/** 右下角圆形人像：短于主片则循环，长于主片则裁剪；默认静音；可按时间轴隐藏 */
async function overlayPresenter(
  mainPath: string,
  outPath: string,
  opts: PresenterOverlay,
  mainDurationSec: number,
  enableExpr?: string | null,
) {
  const ffmpeg = requireFfmpeg()
  const presenterPath = resolveMediaSrc(opts.src)
  const rawSize = Math.max(64, Math.floor(Number(opts.size ?? 280)))
  const size = rawSize % 2 === 0 ? rawSize : rawSize + 1
  const margin = Math.max(0, Math.floor(Number(opts.margin ?? 48)))
  const keepAudio = Boolean(opts.keep_audio)
  const presenterDur = await probeDurationSec(presenterPath)
  const needLoop = presenterDur + 0.05 < mainDurationSec
  const mainHasAudio = await hasAudioStream(mainPath)
  const presenterHasAudio = keepAudio ? await hasAudioStream(presenterPath) : false

  mkdirSync(dirname(outPath), { recursive: true })
  const args: string[] = ['-y', '-i', mainPath]
  if (needLoop) args.push('-stream_loop', '-1')
  args.push('-i', presenterPath)

  const circle = [
    `[1:v]scale=${size}:${size}:force_original_aspect_ratio=increase`,
    `crop=${size}:${size}`,
    'format=yuva420p',
    `geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='if(lte(hypot(X-W/2,Y-H/2),W/2),255,0)'[circ]`,
  ].join(',')
  const enable =
    enableExpr && enableExpr !== '1'
      ? `:enable='${enableExpr.replace(/'/g, "\\'")}'`
      : ''
  const overlay = `[0:v][circ]overlay=W-w-${margin}:H-h-${margin}${enable}:shortest=1[v]`

  if (mainHasAudio && presenterHasAudio) {
    args.push(
      '-filter_complex',
      `${circle};${overlay};[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0[a]`,
      '-map',
      '[v]',
      '-map',
      '[a]',
    )
  } else {
    args.push('-filter_complex', `${circle};${overlay}`, '-map', '[v]')
    if (mainHasAudio) args.push('-map', '0:a:0')
  }

  args.push(
    '-t',
    String(mainDurationSec),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
  )
  if (mainHasAudio || presenterHasAudio) {
    args.push('-c:a', 'aac', '-ar', '44100', '-ac', '2')
  } else {
    args.push('-an')
  }
  args.push(outPath)
  await execFileAsync(ffmpeg, args)
}

/** 对整段音频做 ffmpeg atempo 变速（不经过 TTS speed），写入 assets。 */
export async function apiTempoAudio(options: {
  source: string
  speed: number
  filename?: string
}) {
  const source = String(options.source || '').trim()
  if (!source) throw new Error('source empty')
  let speed = Number(options.speed)
  if (!Number.isFinite(speed)) speed = 1
  speed = Math.max(0.5, Math.min(2.0, speed))
  requireFfmpeg()

  const srcPath = resolveMediaSrc(source)
  if (Math.abs(speed - 1) < 1e-6) {
    const duration_sec = await probeDurationSec(srcPath)
    return {
      ok: true as const,
      id: '',
      path: srcPath,
      url: '',
      src: source.startsWith('asset:') ? source : `asset:${source}`,
      duration_sec,
      speed,
    }
  }

  const work = mkdtempSync(resolve(tmpdir(), 'g-ppt-tempo-'))
  try {
    const outWav = resolve(work, 'sped.wav')
    await execFileAsync(requireFfmpeg(), [
      '-y',
      '-i',
      srcPath,
      '-filter:a',
      `atempo=${speed.toFixed(4)}`,
      '-vn',
      outWav,
    ])
    const baseName =
      safeOutputFilename(options.filename, 'tempo.wav').replace(/\.[^.]+$/, '') +
      '.wav'
    const data = readFileSync(outWav)
    const saved = saveAsset(data, baseName)
    const duration_sec = await probeDurationSec(saved.path)
    return {
      ok: true as const,
      id: saved.id,
      path: saved.path,
      url: saved.url,
      src: `asset:${saved.id}`,
      duration_sec,
      speed,
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** 工具 A：短语音拼接成长音频，写入 assets 便于后续引用 */
export async function apiConcatAudio(options: {
  sources: string[]
  filename?: string
}) {
  const sources = options.sources.map((s) => s.trim()).filter(Boolean)
  if (sources.length < 1) throw new Error('sources empty')
  requireFfmpeg()

  const work = mkdtempSync(resolve(tmpdir(), 'g-ppt-audio-'))
  try {
    const normalized: string[] = []
    for (let i = 0; i < sources.length; i++) {
      const srcPath = resolveMediaSrc(sources[i])
      const part = resolve(work, `part_${String(i).padStart(3, '0')}.m4a`)
      await execFileAsync(requireFfmpeg(), [
        '-y',
        '-i',
        srcPath,
        '-vn',
        '-c:a',
        'aac',
        '-ar',
        '44100',
        '-ac',
        '2',
        part,
      ])
      normalized.push(part)
    }

    const listPath = resolve(work, 'concat.txt')
    writeFileSync(
      listPath,
      normalized.map((p) => `file '${escapeConcatPath(p)}'`).join('\n') + '\n',
    )
    const merged = resolve(work, 'merged.m4a')
    await execFileAsync(requireFfmpeg(), [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c',
      'copy',
      merged,
    ])

    const baseName =
      (options.filename || 'concat.m4a').replace(/[^a-zA-Z0-9._-]+/g, '_') ||
      'concat.m4a'
    const data = readFileSync(merged)
    const saved = saveAsset(data, baseName.endsWith('.m4a') ? baseName : `${baseName}.m4a`)
    const duration_sec = await probeDurationSec(saved.path)
    return {
      ok: true as const,
      id: saved.id,
      path: saved.path,
      url: saved.url,
      src: `asset:${saved.id}`,
      duration_sec,
      parts: sources.length,
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

export function exportCatalog() {
  const catalog = buildCatalog()
  mkdirSync(dirname(catalogFile), { recursive: true })
  writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + '\n')
  return catalog
}

export function loadCatalogFromDisk() {
  if (!existsSync(catalogFile)) {
    return exportCatalog()
  }
  return JSON.parse(readFileSync(catalogFile, 'utf8')) as ReturnType<
    typeof buildCatalog
  >
}

/** 默认从内存 registry 重建并落盘，保证新模板的 schema/demo/inputs 自动齐全 */
export function getCatalog(refresh = true) {
  if (refresh || !existsSync(catalogFile)) return exportCatalog()
  return loadCatalogFromDisk()
}

export function apiListPacks(refresh = true) {
  return getCatalog(refresh).packs
}

export function apiListTemplates(filter?: {
  pack?: string
  type?: string
  /** 默认 true：从 registry 重建，新增模板自动带上契约 */
  refresh?: boolean
}) {
  return getCatalog(filter?.refresh !== false)
    .templates.filter((t) => {
      if (filter?.pack && t.pack !== filter.pack) return false
      if (filter?.type && t.type !== filter.type) return false
      return true
    })
}

/** 选版规则：type.when / roles / 调用形状 / role→type。Agent 与 media 只读此接口，勿手写 type 清单。 */
export function apiGetLayoutRules(refresh = true) {
  const catalog = getCatalog(refresh)
  if (catalog.layout_rules) return catalog.layout_rules
  return buildLayoutRules(catalog.templates)
}

/** 单模板完整契约：meta + schema + demo + inputs */
export function apiGetSchema(templateId: string, refresh = true) {
  const t = getCatalog(refresh).templates.find((x) => x.id === templateId)
  if (!t) throw new Error(`unknown template_id: ${templateId}`)
  return t
}

export async function apiRenderSlide(options: {
  template_id: string
  props?: Record<string, unknown>
  format?: 'png' | 'mp4'
  duration_sec?: number
  filename?: string
}) {
  return withRenderGate(async () => {
    const id = options.template_id
    let props = options.props
    if (props === undefined) {
      const t = getTemplate(id)
      if (!t) throw new Error(`unknown template: ${id}`)
      props = t.demo as Record<string, unknown>
    }
    const format = options.format ?? 'png'
    const duration = options.duration_sec ?? 5
    const jobId = randomUUID()
    mkdirSync(outputDir, { recursive: true })
    const out = resolve(
      outputDir,
      safeOutputFilename(
        options.filename,
        `${jobId}.${format === 'mp4' ? 'mp4' : 'png'}`,
      ),
    )

    if (format === 'png') {
      await screenshotSlide(id, props, out)
    } else if (isLiveTemplate(id)) {
      const work = mkdtempSync(resolve(tmpdir(), 'g-ppt-slide-'))
      try {
        const webm = resolve(work, 'slide.webm')
        const rec = await recordSlide(id, props, webm, duration)
        await videoToClip(webm, out, {
          trim_start_sec: rec.trimStartSec,
          trim_end_sec: rec.trimStartSec + rec.durationSec,
        })
      } finally {
        rmSync(work, { recursive: true, force: true })
      }
    } else {
      const work = mkdtempSync(resolve(tmpdir(), 'g-ppt-slide-'))
      try {
        const pngOut = resolve(work, 'slide.png')
        await screenshotSlide(id, props, pngOut)
        await pngToMp4(pngOut, out, duration)
      } finally {
        rmSync(work, { recursive: true, force: true })
      }
    }

    return {
      ok: true as const,
      template_id: id,
      format,
      duration_sec: format === 'mp4' ? duration : undefined,
      path: out,
    }
  })
}

export async function apiRenderShow(options: {
  scenes: Scene[]
  filename?: string
  /** 成片绝对时间轴 SRT（优先于各 scene cues 合并） */
  subtitle_src?: string
  /** true 硬烧字幕；false（默认）写 sidecar .srt 并尝试软挂 mov_text */
  burn_in?: boolean
  /** 右下角圆形人像画中画 */
  presenter?: PresenterOverlay
  /**
   * 有 scene.audio_src 时是否保留该段原片音轨并与旁白混音。
   * 默认 false（旁白替换原声）。
   */
  keep_video_audio?: boolean
  /** 成片级循环 BGM（asset:<id> / assets 相对路径 / 绝对路径） */
  bgm_src?: string
  /** BGM 相对音量 0–1，默认 0.25 */
  bgm_volume?: number
  /** 异步任务进度回调（1-based scene index） */
  onProgress?: (p: { scene: number; total: number }) => void
}) {
  return withRenderGate(async () => {
    const list = options.scenes
    if (!list.length) throw new Error('scenes empty')
    mkdirSync(outputDir, { recursive: true })
    const out = resolve(
      outputDir,
      safeOutputFilename(options.filename, `${randomUUID()}.mp4`),
    )
    const work = mkdtempSync(resolve(tmpdir(), 'g-ppt-scenes-'))
    const timeline: TimelineEntry[] = []

    try {
      let cursor = 0
      const clips: string[] = []
      for (let i = 0; i < list.length; i++) {
        options.onProgress?.({ scene: i + 1, total: list.length })
        const sc = list[i]
        const kind = sceneKind(sc)
        const clip = resolve(work, `clip_${String(i).padStart(3, '0')}.mp4`)
        const narrated = resolve(work, `narr_${String(i).padStart(3, '0')}.mp4`)
        let dur = 0
        const audioSrc = sceneAudioSrc(sc)
        let audioPath: string | undefined

        if (kind === 'image') {
          const img = sc as ImageScene
          const sources = imageSceneSources(img)
          if (!sources.length) {
            throw new Error(`image scene ${i + 1} missing src/srcs`)
          }
          const resolved = await resolveNarratedDuration(
            audioSrc,
            Number(img.duration_sec ?? 5),
          )
          dur = resolved.duration_sec
          audioPath = resolved.audioPath
          const localPaths = sources.map((s) => resolveMediaSrc(s))
          const gridPath = resolve(work, `grid_${String(i).padStart(3, '0')}.png`)
          const still = await composeImageGrid(localPaths, gridPath)
          await imageToClip(
            still,
            clip,
            dur,
            img.fit ?? 'contain',
          )
          timeline.push({
            index: i,
            kind,
            src: sources[0],
            audio_src: audioSrc,
            duration_sec: dur,
            start_sec: cursor,
            end_sec: cursor + dur,
          })
        } else if (kind === 'video') {
          const vid = sc as VideoScene
          const rawClip = resolve(work, `vraw_${String(i).padStart(3, '0')}.mp4`)
          const rawDur = await videoToClip(resolveMediaSrc(vid.src), rawClip, {
            trim_start_sec: vid.trim_start_sec,
            trim_end_sec: vid.trim_end_sec,
          })
          if (audioSrc) {
            const resolved = await resolveNarratedDuration(audioSrc, rawDur)
            dur = resolved.duration_sec
            audioPath = resolved.audioPath
            await fitClipDuration(rawClip, clip, dur, rawDur)
          } else {
            dur = rawDur
            copyFileSync(rawClip, clip)
          }
          timeline.push({
            index: i,
            kind,
            src: vid.src,
            audio_src: audioSrc,
            duration_sec: dur,
            start_sec: cursor,
            end_sec: cursor + dur,
          })
        } else {
          const tpl = sc as TemplateScene
          const resolved = await resolveNarratedDuration(
            audioSrc,
            Number(tpl.duration_sec ?? 5),
          )
          dur = resolved.duration_sec
          audioPath = resolved.audioPath
          if (isLiveTemplate(tpl.template_id)) {
            const webm = resolve(work, `slide_${String(i).padStart(3, '0')}.webm`)
            const rec = await recordSlide(tpl.template_id, tpl.props, webm, dur)
            await videoToClip(webm, clip, {
              trim_start_sec: rec.trimStartSec,
              trim_end_sec: rec.trimStartSec + rec.durationSec,
            })
          } else {
            const png = resolve(work, `slide_${String(i).padStart(3, '0')}.png`)
            await screenshotSlide(tpl.template_id, tpl.props, png)
            await imageToClip(png, clip, dur, 'contain')
          }
          timeline.push({
            index: i,
            kind: 'template',
            template_id: tpl.template_id,
            audio_src: audioSrc,
            duration_sec: dur,
            start_sec: cursor,
            end_sec: cursor + dur,
          })
        }

        if (audioPath) {
          if (options.keep_video_audio) {
            await mixNarrationWithOriginal(clip, audioPath, narrated, dur)
          } else {
            await replaceAudioTrack(clip, audioPath, narrated, dur)
          }
          clips.push(narrated)
        } else {
          clips.push(clip)
        }
        cursor += dur
      }
      await concatClips(clips, out)

      // 字幕前叠人像，避免软挂字幕后重编码丢轨；title 封面时段不显示
      if (options.presenter?.src?.trim()) {
        const enable = presenterEnableExpr(timeline)
        if (enable !== '0') {
          const stagedPip = resolve(work, 'with_presenter.mp4')
          await overlayPresenter(out, stagedPip, options.presenter, cursor, enable)
          try {
            unlinkSync(out)
            renameSync(stagedPip, out)
          } catch {
            copyFileSync(stagedPip, out)
          }
        }
      }

      const bgmSrc = options.bgm_src?.trim()
      if (bgmSrc) {
        const stagedBgm = resolve(work, 'with_bgm.mp4')
        const vol =
          typeof options.bgm_volume === 'number' && Number.isFinite(options.bgm_volume)
            ? options.bgm_volume
            : 0.25
        await mixBgmTrack(out, resolveMediaSrc(bgmSrc), stagedBgm, cursor, vol)
        try {
          unlinkSync(out)
          renameSync(stagedBgm, out)
        } catch {
          copyFileSync(stagedBgm, out)
        }
      }

      let subtitle_path: string | undefined
      let srtBody: string | null = null
      if (options.subtitle_src?.trim()) {
        srtBody = readFileSync(resolveMediaSrc(options.subtitle_src.trim()), 'utf8')
      } else {
        srtBody = buildSrtFromSceneCues(timeline, list)
      }

      if (srtBody) {
        subtitle_path = out.replace(/\.mp4$/i, '.srt')
        writeFileSync(subtitle_path, srtBody)
        const staged = resolve(work, 'with_subs.mp4')
        try {
          if (options.burn_in) {
            await burnSubtitles(out, subtitle_path, staged)
          } else {
            await muxSoftSubtitles(out, subtitle_path, staged)
          }
          try {
            unlinkSync(out)
            renameSync(staged, out)
          } catch {
            copyFileSync(staged, out)
          }
        } catch {
          // 软挂/硬烧失败时仍保留画面 + sidecar .srt
        }
      }

      const timelinePath = out.replace(/\.mp4$/i, '.timeline.json')
      writeFileSync(
        timelinePath,
        JSON.stringify(
          {
            total_sec: cursor,
            subtitle_path: subtitle_path ?? null,
            burn_in: Boolean(options.burn_in),
            keep_video_audio: Boolean(options.keep_video_audio),
            bgm_src: bgmSrc || null,
            bgm_volume:
              typeof options.bgm_volume === 'number' && Number.isFinite(options.bgm_volume)
                ? options.bgm_volume
                : bgmSrc
                  ? 0.25
                  : null,
            presenter: options.presenter?.src
              ? {
                  src: options.presenter.src,
                  size: options.presenter.size ?? 280,
                  margin: options.presenter.margin ?? 48,
                  keep_audio: Boolean(options.presenter.keep_audio),
                }
              : null,
            scenes: timeline,
          },
          null,
          2,
        ) + '\n',
      )
      return {
        ok: true as const,
        path: out,
        timeline_path: timelinePath,
        subtitle_path,
        total_sec: cursor,
        scenes: timeline.length,
      }
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })
}

function whichOk(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return true
  } catch {
    return false
  }
}

export function doctor() {
  return {
    npm: whichOk('npm'),
    node: whichOk('node'),
    ffmpeg: whichFfmpeg() !== null,
    ffprobe: whichFfprobe() !== null,
    catalog_exists: existsSync(catalogFile),
    web_dist_exists: existsSync(resolve(distDir, 'index.html')),
    repo_root: root,
    render_base_url: process.env.G_PPT_RENDER_BASE_URL || null,
    concurrency: getRenderConcurrency(),
    output_dir: outputDir,
    assets_dir: assetsDir,
    jobs_dir: resolve(root, 'jobs'),
  }
}

export { buildCatalog, getTemplate, listPacks, listTemplates }
