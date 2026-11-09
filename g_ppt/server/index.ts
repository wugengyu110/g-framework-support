/**
 * G-PPT Node API（Hono）
 * 同进程：静态预览 + /api/* + 渲染引擎 + /docs（预生成 OpenAPI）
 *
 * 注意：运行时不加载 @hono/zod-openapi（与 engine 同进程在 vite-node 下会卡住）。
 * 请求体校验在 frontend/src/lib/api-body.ts（vite-node 根外文件不能静态 import npm 包）。
 * OpenAPI 由 `npm run catalog` → tools/export-openapi.ts 生成。
 */
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { swaggerUI } from '@hono/swagger-ui'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AudioConcatBodySchema,
  AudioTempoBodySchema,
  RenderMindmapBodySchema,
  RenderShowBodySchema,
  RenderSlideBodySchema,
} from '../frontend/src/lib/api-body'
import {
  apiConcatAudio,
  apiGetSchema,
  apiListPacks,
  apiListTemplates,
  apiGetLayoutRules,
  apiRenderShow,
  apiRenderSlide,
  apiTempoAudio,
  assetsDir,
  catalogFile,
  distDir,
  doctor,
  exportCatalog,
  getRenderConcurrency,
  outputDir,
  root,
  saveAsset,
} from '../tools/engine'
import { apiRenderMindmap } from '../tools/mindmap-video'
import { enqueueRenderMindmap, enqueueRenderShow, getJob, startJobWorkers } from '../tools/jobs'

const port = Number(process.env.PORT || process.env.G_PPT_PORT || 18800)
if (!process.env.G_PPT_RENDER_BASE_URL) {
  process.env.G_PPT_RENDER_BASE_URL = `http://127.0.0.1:${port}`
}

exportCatalog()
startJobWorkers()

const openapiFile = resolve(root, 'catalog/openapi.json')

const app = new Hono()
app.use('*', cors())

app.get('/api/health', (c) => c.json({ status: 'ok' }))
app.get('/api/doctor', (c) => c.json(doctor()))

app.get('/api/packs', (c) => {
  try {
    const refresh = c.req.query('refresh') !== 'false'
    return c.json(apiListPacks(refresh))
  } catch (e) {
    return c.json({ error: String((e as Error).message) }, 500)
  }
})

app.get('/api/templates', (c) => {
  try {
    return c.json(
      apiListTemplates({
        pack: c.req.query('pack') || undefined,
        type: c.req.query('type') || undefined,
        refresh: c.req.query('refresh') !== 'false',
      }),
    )
  } catch (e) {
    return c.json({ error: String((e as Error).message) }, 500)
  }
})

app.get('/api/templates/:id/schema', (c) => {
  try {
    return c.json(
      apiGetSchema(c.req.param('id'), c.req.query('refresh') !== 'false'),
    )
  } catch (e) {
    return c.json({ error: String((e as Error).message) }, 404)
  }
})

app.get('/api/layout-rules', (c) => {
  try {
    return c.json(apiGetLayoutRules(c.req.query('refresh') !== 'false'))
  } catch (e) {
    return c.json({ error: String((e as Error).message) }, 500)
  }
})

app.post('/api/catalog/refresh', (c) => {
  const catalog = exportCatalog()
  return c.json({
    ok: true,
    packs: catalog.packs.length,
    templates: catalog.templates.length,
  })
})

app.post('/api/assets', async (c) => {
  try {
    const body = await c.req.parseBody()
    const file = body.file
    if (!file || typeof file === 'string') {
      return c.json(
        { ok: false as const, error: 'multipart field "file" required' },
        400,
      )
    }
    const buf = Buffer.from(await file.arrayBuffer())
    const saved = saveAsset(buf, file.name || 'upload.bin')
    return c.json({
      ok: true as const,
      ...saved,
      src: `asset:${saved.id}`,
    })
  } catch (e) {
    return c.json({ ok: false, error: String((e as Error).message) }, 400)
  }
})

app.post('/api/render/slide', async (c) => {
  try {
    const parsed = RenderSlideBodySchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json(
        { ok: false as const, error: parsed.error.issues[0]?.message ?? 'invalid body' },
        400,
      )
    }
    return c.json(await apiRenderSlide(parsed.data))
  } catch (e) {
    return c.json({ ok: false, error: String((e as Error).message) }, 400)
  }
})

async function handleRenderShow(c: {
  req: { json: () => Promise<unknown> }
  json: (body: unknown, status?: number) => Response
}) {
  try {
    const parsed = RenderShowBodySchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json(
        { ok: false as const, error: parsed.error.issues[0]?.message ?? 'invalid body' },
        400,
      )
    }
    return c.json(await apiRenderShow(parsed.data))
  } catch (e) {
    return c.json({ ok: false, error: String((e as Error).message) }, 400)
  }
}

async function handleEnqueueRenderShow(c: {
  req: { json: () => Promise<unknown> }
  json: (body: unknown, status?: number) => Response
}) {
  try {
    const parsed = RenderShowBodySchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json(
        { ok: false as const, error: parsed.error.issues[0]?.message ?? 'invalid body' },
        400,
      )
    }
    const job = enqueueRenderShow(parsed.data)
    return c.json({
      ok: true as const,
      job_id: job.id,
      status: 'queued' as const,
    })
  } catch (e) {
    return c.json({ ok: false, error: String((e as Error).message) }, 400)
  }
}

app.post('/api/render/show', (c) => handleRenderShow(c))

app.post('/api/render/mindmap', async (c) => {
  try {
    const parsed = RenderMindmapBodySchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json(
        { ok: false as const, error: parsed.error.issues[0]?.message ?? 'invalid body' },
        400,
      )
    }
    return c.json(await apiRenderMindmap(parsed.data))
  } catch (e) {
    return c.json({ ok: false, error: String((e as Error).message) }, 400)
  }
})

app.post('/api/jobs/render-mindmap', async (c) => {
  try {
    const parsed = RenderMindmapBodySchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json(
        { ok: false as const, error: parsed.error.issues[0]?.message ?? 'invalid body' },
        400,
      )
    }
    const job = enqueueRenderMindmap(parsed.data)
    return c.json({
      ok: true as const,
      job_id: job.id,
      status: 'queued' as const,
    })
  } catch (e) {
    return c.json({ ok: false, error: String((e as Error).message) }, 400)
  }
})

app.post('/api/audio/concat', async (c) => {
  try {
    const parsed = AudioConcatBodySchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json(
        { ok: false as const, error: parsed.error.issues[0]?.message ?? 'invalid body' },
        400,
      )
    }
    return c.json(await apiConcatAudio(parsed.data))
  } catch (e) {
    return c.json({ ok: false, error: String((e as Error).message) }, 400)
  }
})

app.post('/api/audio/tempo', async (c) => {
  try {
    const parsed = AudioTempoBodySchema.safeParse(await c.req.json())
    if (!parsed.success) {
      return c.json(
        { ok: false as const, error: parsed.error.issues[0]?.message ?? 'invalid body' },
        400,
      )
    }
    return c.json(await apiTempoAudio(parsed.data))
  } catch (e) {
    return c.json({ ok: false, error: String((e as Error).message) }, 400)
  }
})

app.post('/api/jobs/render-show', (c) => handleEnqueueRenderShow(c))

app.get('/api/jobs/:id', (c) => {
  const job = getJob(c.req.param('id'))
  if (!job) {
    return c.json({ ok: false as const, error: 'job not found' }, 404)
  }
  const { request: _request, ...publicJob } = job
  return c.json({ ok: true as const, ...publicJob })
})

app.get('/openapi.json', (c) => {
  if (!existsSync(openapiFile)) {
    return c.json(
      {
        error:
          'catalog/openapi.json missing — run npm run catalog (or rebuild image)',
      },
      503,
    )
  }
  return c.json(JSON.parse(readFileSync(openapiFile, 'utf8')))
})

app.get('/docs', swaggerUI({ url: '/openapi.json' }))

app.get('/output/:name', (c) => {
  const name = decodeURIComponent(c.req.param('name'))
  const file = resolve(outputDir, name)
  if (!existsSync(file) || !file.startsWith(outputDir)) {
    return c.notFound()
  }
  const buf = readFileSync(file)
  const type = name.endsWith('.mp4')
    ? 'video/mp4'
    : name.endsWith('.json')
      ? 'application/json'
      : name.endsWith('.srt')
        ? 'application/x-subrip'
        : name.endsWith('.m4a') || name.endsWith('.aac')
          ? 'audio/mp4'
          : name.endsWith('.mp3')
            ? 'audio/mpeg'
            : 'image/png'
  return c.body(buf, 200, { 'Content-Type': type })
})

app.get('/media/:name', (c) => {
  const name = decodeURIComponent(c.req.param('name'))
  const file = resolve(assetsDir, name)
  if (!existsSync(file) || !file.startsWith(assetsDir)) {
    return c.notFound()
  }
  const buf = readFileSync(file)
  const lower = name.toLowerCase()
  const type = lower.endsWith('.mp4')
    ? 'video/mp4'
    : lower.endsWith('.webm')
      ? 'video/webm'
      : lower.endsWith('.png')
        ? 'image/png'
        : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
          ? 'image/jpeg'
          : lower.endsWith('.webp')
            ? 'image/webp'
            : lower.endsWith('.gif')
              ? 'image/gif'
              : lower.endsWith('.mp3')
                ? 'audio/mpeg'
                : lower.endsWith('.wav')
                  ? 'audio/wav'
                  : lower.endsWith('.m4a') || lower.endsWith('.aac')
                    ? 'audio/mp4'
                    : lower.endsWith('.srt')
                      ? 'application/x-subrip'
                      : lower.endsWith('.vtt')
                        ? 'text/vtt'
                        : 'application/octet-stream'
  return c.body(buf, 200, { 'Content-Type': type })
})

const indexHtml = resolve(distDir, 'index.html')

/** Vite public/ → dist 根；先静态命中，未命中再走 SPA */
app.use(
  '*',
  serveStatic({
    root: distDir,
    rewriteRequestPath: (p) => decodeURIComponent(p),
  }),
)

function sendIndex(c: { html: (s: string) => Response }) {
  if (!existsSync(indexHtml)) {
    return c.html(
      '<p>frontend/dist missing — run <code>npm run build</code></p>',
      503,
    )
  }
  return c.html(readFileSync(indexHtml, 'utf8'))
}

app.get('*', (c) => {
  const p = c.req.path
  if (
    p.startsWith('/api') ||
    p.startsWith('/output') ||
    p.startsWith('/media') ||
    p === '/docs' ||
    p.startsWith('/docs/') ||
    p === '/openapi.json'
  ) {
    return c.notFound()
  }
  return sendIndex(c)
})

console.log(`[g-ppt] listening on http://0.0.0.0:${port}`)
console.log(`[g-ppt] preview  http://127.0.0.1:${port}/`)
console.log(`[g-ppt] docs     http://127.0.0.1:${port}/docs`)
console.log(`[g-ppt] openapi  http://127.0.0.1:${port}/openapi.json`)
console.log(`[g-ppt] catalog  ${catalogFile}`)
console.log(`[g-ppt] assets   ${assetsDir}`)
console.log(`[g-ppt] concurrency ${getRenderConcurrency()}`)

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' })
