/**
 * 独立 Node 进程截图 / 录屏，避免 vite-node 与 Playwright 动态 import 冲突
 * （Error: The server is being restarted or closed. Request is outdated）。
 *
 * stdin JSON:
 *   截图: { url: string, outPng: string }
 *   录屏: { url: string, outVideo: string, durationSec: number }
 * stdout: { ok: true, path } | { ok: false, error }
 */
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../frontend')
const require = createRequire(resolve(frontendRoot, 'package.json'))
const { chromium } = require('playwright')

/** 与 frontend canvas / engine.ts VF_* 保持一致：4:3 */
const VIEWPORT = { width: 1920, height: 1440 }

function readStdin() {
  return new Promise((resolvePromise, reject) => {
    const chunks = []
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => chunks.push(c))
    process.stdin.on('end', () => resolvePromise(chunks.join('')))
    process.stdin.on('error', reject)
  })
}

async function preparePage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-slide-ready="true"]', { timeout: 30000 })
  // 等 ChillRoundM 等本地字体就绪，避免封面落到回退字
  await page.evaluate(() => document.fonts.ready)
  // 给 iframe 动效脚本一点启动时间（rAF / 嵌套资源）
  await page.waitForTimeout(400)
  await page.evaluate(async () => {
    const frames = [...document.querySelectorAll('iframe')]
    await Promise.all(
      frames.map(
        (frame) =>
          new Promise((resolveFrame) => {
            if (frame.contentDocument?.readyState === 'complete') {
              resolveFrame()
              return
            }
            frame.addEventListener('load', () => resolveFrame(), { once: true })
            setTimeout(resolveFrame, 2000)
          }),
      ),
    )
  })
  await page.waitForTimeout(200)
}

async function screenshot(url, outPng) {
  mkdirSync(dirname(outPng), { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
    })
    await preparePage(page, url)
    await page.locator('[data-slide-ready="true"]').screenshot({
      path: outPng,
      type: 'png',
    })
  } finally {
    await browser.close()
  }
  return outPng
}

async function record(url, outVideo, durationSec) {
  const dur = Number(durationSec)
  if (!(dur > 0)) throw new Error('screenshot-worker: durationSec must be > 0')
  mkdirSync(dirname(outVideo), { recursive: true })
  const videoDir = mkdtempSync(resolve(tmpdir(), 'g-ppt-rec-'))
  const browser = await chromium.launch({ headless: true })
  /** 录屏从 newPage 起算，需裁掉加载段 */
  let trimStartSec = 0
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      recordVideo: {
        dir: videoDir,
        size: VIEWPORT,
      },
    })
    const page = await context.newPage()
    const started = Date.now()
    await preparePage(page, url)
    trimStartSec = Math.max(0, (Date.now() - started) / 1000)
    await page.waitForTimeout(Math.round(dur * 1000))
    const video = page.video()
    await page.close()
    await context.close()
    if (!video) throw new Error('screenshot-worker: no video handle')
    await video.saveAs(outVideo)
  } finally {
    await browser.close()
    rmSync(videoDir, { recursive: true, force: true })
  }
  return { path: outVideo, trimStartSec, durationSec: dur }
}

const PHYS_HZ = 60

function reportFrame(i, total) {
  process.stderr.write(`mindmap-frame ${i + 1} ${total}\n`)
}

/** 按时间轴对焦 Obsidian 画布并逐帧截图。stdin: mode=mindmap */
async function grabMindmap(job) {
  const {
    url,
    width,
    height,
    times,
    cameras,
    outDir,
    suffix,
    quality,
    useDynamicBg,
  } = job
  if (!url) throw new Error('screenshot-worker: url required')
  if (!Array.isArray(times) || !times.length) {
    throw new Error('screenshot-worker: times required')
  }
  if (!Array.isArray(cameras) || cameras.length !== times.length) {
    throw new Error('screenshot-worker: cameras length must match times')
  }
  const w = Number(width)
  const h = Number(height)
  if (!(w > 0) || !(h > 0)) throw new Error('screenshot-worker: width/height required')
  mkdirSync(outDir, { recursive: true })
  const ext = suffix === 'png' ? 'png' : 'jpeg'
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
    })
    page.setDefaultTimeout(120000)
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForFunction(() => document.readyState === 'complete')
    if (useDynamicBg) {
      await page.waitForFunction(() => {
        const frame = document.getElementById('bg')
        const win = frame && frame.contentWindow
        return !!(win && win.stepFrames)
      })
    }
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(
      () =>
        new Promise((resolveFrame) =>
          requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
        ),
    )
    let stepped = 0
    for (let i = 0; i < times.length; i++) {
      const t = Number(times[i])
      if (useDynamicBg) {
        const target = Math.round(t * PHYS_HZ)
        if (target > stepped) {
          const steps = target - stepped
          await page.evaluate((n) => {
            document.getElementById('bg').contentWindow.stepFrames(n)
          }, steps)
          stepped = target
        }
      }
      const cam = cameras[i]
      await page.evaluate(({ cx, cy, z }) => {
        window.setCamera(cx, cy, z)
      }, cam)
      const file = resolve(outDir, `frame_${String(i).padStart(4, '0')}.${suffix === 'png' ? 'png' : 'jpg'}`)
      const shot = { path: file, type: ext }
      if (ext === 'jpeg') shot.quality = Number(quality ?? 86)
      await page.screenshot(shot)
      reportFrame(i, times.length)
    }
  } finally {
    await browser.close()
  }
  return outDir
}

async function main() {
  const raw = (await readStdin()).trim()
  if (!raw) throw new Error('screenshot-worker: empty stdin')
  const job = JSON.parse(raw)
  if (job.mode === 'mindmap') {
    const path = await grabMindmap(job)
    process.stdout.write(JSON.stringify({ ok: true, path }) + '\n')
    return
  }
  const { url, outPng, outVideo, durationSec } = job
  if (!url) throw new Error('screenshot-worker: url required')

  if (outVideo) {
    const result = await record(url, outVideo, durationSec)
    process.stdout.write(JSON.stringify({ ok: true, ...result }) + '\n')
    return
  }
  if (outPng) {
    const path = await screenshot(url, outPng)
    process.stdout.write(JSON.stringify({ ok: true, path }) + '\n')
    return
  }
  throw new Error('screenshot-worker: outPng or outVideo required')
}

main().catch((e) => {
  process.stdout.write(
    JSON.stringify({ ok: false, error: String(e?.message || e) }) + '\n',
  )
  process.exitCode = 1
})
