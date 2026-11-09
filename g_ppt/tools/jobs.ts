/**
 * 轻量异步任务：磁盘 JSON + 同进程 worker，内部复用 apiRenderShow。
 */
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import {
  apiRenderShow,
  getRenderConcurrency,
  root,
  type PresenterOverlay,
  type Scene,
} from './engine'
import { apiRenderMindmap, type RenderMindmapInput } from './mindmap-video'

export const jobsDir = resolve(root, 'jobs')

export type JobStatus = 'queued' | 'running' | 'done' | 'error'

export type RenderShowJobRequest = {
  scenes: Scene[]
  filename?: string
  subtitle_src?: string
  burn_in?: boolean
  keep_video_audio?: boolean
  bgm_src?: string
  bgm_volume?: number
  presenter?: PresenterOverlay
}

export type JobProgress = { scene?: number; frame?: number; total: number }

export type JobResult = {
  path: string
  paths?: string[]
  timeline_path?: string
  subtitle_path?: string
  total_sec?: number
  scenes?: number
  frames?: number
  format?: 'mp4' | 'png'
}

export type JobRecord = {
  id: string
  kind: 'render_show' | 'render_mindmap'
  status: JobStatus
  created_at: string
  started_at?: string
  finished_at?: string
  request: RenderShowJobRequest | RenderMindmapInput
  progress?: JobProgress | null
  result?: JobResult
  error?: string
}

const pending: string[] = []
const waiters: Array<() => void> = []
let workersStarted = false

function wake() {
  waiters.shift()?.()
}

function jobPath(id: string) {
  return resolve(jobsDir, `${id}.json`)
}

function writeJob(job: JobRecord) {
  mkdirSync(jobsDir, { recursive: true })
  writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2) + '\n')
}

function readJobFile(id: string): JobRecord | null {
  const p = jobPath(id)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8')) as JobRecord
}

function patchJob(id: string, patch: Partial<JobRecord>): JobRecord {
  const cur = readJobFile(id)
  if (!cur) throw new Error(`job not found: ${id}`)
  const next = { ...cur, ...patch }
  writeJob(next)
  return next
}

async function nextQueuedId(): Promise<string> {
  for (;;) {
    const id = pending.shift()
    if (id) return id
    await new Promise<void>((r) => waiters.push(r))
  }
}

function isShowRequest(
  request: JobRecord['request'],
): request is RenderShowJobRequest {
  return Array.isArray((request as RenderShowJobRequest).scenes)
}

async function processJob(id: string) {
  const job = readJobFile(id)
  if (!job || job.status !== 'queued') return
  const request = job.request

  if (job.kind === 'render_show' && isShowRequest(request)) {
    patchJob(id, {
      status: 'running',
      started_at: new Date().toISOString(),
      error: undefined,
      progress: { scene: 0, total: request.scenes.length },
    })
    try {
      const result = await apiRenderShow({
        ...request,
        onProgress: (p) => {
          try {
            patchJob(id, { progress: p })
          } catch {
            /* ignore mid-flight write races */
          }
        },
      })
      patchJob(id, {
        status: 'done',
        finished_at: new Date().toISOString(),
        progress: {
          scene: request.scenes.length,
          total: request.scenes.length,
        },
        result: {
          path: result.path,
          timeline_path: result.timeline_path,
          subtitle_path: result.subtitle_path,
          total_sec: result.total_sec,
          scenes: result.scenes,
          format: 'mp4',
        },
      })
    } catch (e) {
      patchJob(id, {
        status: 'error',
        finished_at: new Date().toISOString(),
        error: String((e as Error)?.message || e),
      })
    }
    return
  }

  const mindmap = request as RenderMindmapInput
  patchJob(id, {
    status: 'running',
    started_at: new Date().toISOString(),
    error: undefined,
    progress: { frame: 0, total: 1 },
  })
  try {
    const result = await apiRenderMindmap({
      ...mindmap,
      onProgress: (p) => {
        try {
          patchJob(id, { progress: { frame: p.frame, total: p.total } })
        } catch {
          /* ignore mid-flight write races */
        }
      },
    })
    patchJob(id, {
      status: 'done',
      finished_at: new Date().toISOString(),
      progress: { frame: result.frames, total: result.frames },
      result: {
        path: result.path,
        paths: result.paths,
        total_sec: result.total_sec,
        frames: result.frames,
        format: result.format,
      },
    })
  } catch (e) {
    patchJob(id, {
      status: 'error',
      finished_at: new Date().toISOString(),
      error: String((e as Error)?.message || e),
    })
  }
}

function recoverOnBoot() {
  mkdirSync(jobsDir, { recursive: true })
  for (const name of readdirSync(jobsDir)) {
    if (!name.endsWith('.json')) continue
    const id = name.slice(0, -'.json'.length)
    const job = readJobFile(id)
    if (!job) continue
    if (job.status === 'running') {
      writeJob({
        ...job,
        status: 'error',
        finished_at: new Date().toISOString(),
        error: 'interrupted by process restart',
      })
    } else if (job.status === 'queued') {
      pending.push(id)
    }
  }
}

export function enqueueRenderShow(request: RenderShowJobRequest): JobRecord {
  if (!request.scenes?.length) throw new Error('scenes empty')
  const id = randomUUID()
  const job: JobRecord = {
    id,
    kind: 'render_show',
    status: 'queued',
    created_at: new Date().toISOString(),
    request,
    progress: { scene: 0, total: request.scenes.length },
  }
  writeJob(job)
  pending.push(id)
  wake()
  return job
}

export function enqueueRenderMindmap(request: RenderMindmapInput): JobRecord {
  if (!request.canvas?.nodes?.length) throw new Error('canvas.nodes empty')
  if (!request.shots?.length) throw new Error('shots empty')
  const id = randomUUID()
  const stored: RenderMindmapInput = { ...request }
  delete stored.onProgress
  const job: JobRecord = {
    id,
    kind: 'render_mindmap',
    status: 'queued',
    created_at: new Date().toISOString(),
    request: stored,
    progress: { frame: 0, total: 1 },
  }
  writeJob(job)
  pending.push(id)
  wake()
  return job
}

export function getJob(id: string): JobRecord | null {
  return readJobFile(id)
}

/** API 启动时调用一次 */
export function startJobWorkers() {
  if (workersStarted) return
  workersStarted = true
  recoverOnBoot()
  const n = Math.max(1, getRenderConcurrency())
  for (let i = 0; i < n; i++) {
    void (async () => {
      for (;;) {
        const id = await nextQueuedId()
        await processJob(id)
      }
    })()
  }
  console.log(`[g-ppt] job workers ${n} (dir ${jobsDir})`)
}
