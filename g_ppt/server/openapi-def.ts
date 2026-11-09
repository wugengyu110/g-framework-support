/**
 * 仅用于生成 OpenAPI 文档（不依赖 engine / Playwright）
 */
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from '@hono/zod-openapi'
import {
  AssetUploadResultSchema,
  AudioConcatBodySchema,
  AudioConcatResultSchema,
  AudioTempoBodySchema,
  AudioTempoResultSchema,
  CatalogRefreshResultSchema,
  DoctorSchema,
  ErrorSchema,
  FailSchema,
  HealthSchema,
  JobEnqueueResultSchema,
  JobIdParamSchema,
  JobRecordSchema,
  PackSchema,
  RefreshQuerySchema,
  RenderMindmapBodySchema,
  RenderMindmapResultSchema,
  RenderShowBodySchema,
  RenderShowResultSchema,
  RenderSlideBodySchema,
  RenderSlideResultSchema,
  TemplateContractSchema,
  TemplateIdParamSchema,
  TemplatesQuerySchema,
  LayoutRulesSchema,
} from './schemas'

const stub = () => {
  throw new Error('openapi stub — not for runtime')
}

export function buildOpenApiApp() {
  const app = new OpenAPIHono()

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/health',
      tags: ['system'],
      summary: '健康检查',
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: HealthSchema } },
        },
      },
    }),
    stub as never,
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/doctor',
      tags: ['system'],
      summary: '环境自检',
      responses: {
        200: {
          description: 'doctor',
          content: { 'application/json': { schema: DoctorSchema } },
        },
      },
    }),
    stub as never,
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/packs',
      tags: ['catalog'],
      summary: '节目包列表',
      request: { query: RefreshQuerySchema },
      responses: {
        200: {
          description: 'packs',
          content: { 'application/json': { schema: PackSchema.array() } },
        },
        500: {
          description: 'error',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    }),
    stub as never,
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/templates',
      tags: ['catalog'],
      summary: '模板列表（含 schema / demo / inputs）',
      description:
        'Agent 选版用。每项含 JSON Schema、示例 props、字段条数约束。默认 refresh 重建 catalog。',
      request: { query: TemplatesQuerySchema },
      responses: {
        200: {
          description: 'templates',
          content: {
            'application/json': { schema: TemplateContractSchema.array() },
          },
        },
        500: {
          description: 'error',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    }),
    stub as never,
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/templates/{id}/schema',
      tags: ['catalog'],
      summary: '单模板完整契约',
      request: {
        params: TemplateIdParamSchema,
        query: RefreshQuerySchema,
      },
      responses: {
        200: {
          description: 'contract',
          content: { 'application/json': { schema: TemplateContractSchema } },
        },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    }),
    stub as never,
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/layout-rules',
      tags: ['catalog'],
      summary: '选版规则（type.when / roles / 形状 / role→type）',
      description:
        '从当前 catalog 聚合。Agent / media 选版只读本接口，勿手写 type 清单。prompt.* 可直接注入 LLM。',
      request: { query: RefreshQuerySchema },
      responses: {
        200: {
          description: 'layout rules',
          content: { 'application/json': { schema: LayoutRulesSchema } },
        },
        500: {
          description: 'error',
          content: { 'application/json': { schema: ErrorSchema } },
        },
      },
    }),
    stub as never,
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/catalog/refresh',
      tags: ['catalog'],
      summary: '强制重建 catalog',
      responses: {
        200: {
          description: 'refreshed',
          content: {
            'application/json': { schema: CatalogRefreshResultSchema },
          },
        },
      },
    }),
    stub as never,
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/assets',
      tags: ['assets'],
      summary: '上传图片 / 视频 / 音频 / 字幕到媒体库',
      description:
        'multipart 字段名 file。返回 id / src（asset:<id>），可写入 show scene（含 audio_src、subtitle_src）。',
      request: {
        body: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: z
                .object({
                  file: z.any().openapi({
                    type: 'string',
                    format: 'binary',
                    description: '图片、mp4、音频或 srt',
                  }),
                })
                .openapi('AssetUploadBody'),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'uploaded',
          content: {
            'application/json': { schema: AssetUploadResultSchema },
          },
        },
        400: {
          description: 'missing file',
          content: { 'application/json': { schema: FailSchema } },
        },
      },
    }),
    stub as never,
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/audio/concat',
      tags: ['audio'],
      summary: '短语音拼接成长音频（工具）',
      description:
        '按顺序 concat 多段音频，写入 assets。成片主路径请用 render/show 的按段 audio_src，不必先拼长轨。',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: AudioConcatBodySchema } },
        },
      },
      responses: {
        200: {
          description: 'concatenated',
          content: {
            'application/json': { schema: AudioConcatResultSchema },
          },
        },
        400: {
          description: 'validation / ffmpeg error',
          content: { 'application/json': { schema: FailSchema } },
        },
      },
    }),
    stub as never,
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/audio/tempo',
      tags: ['audio'],
      summary: '整段音频 atempo 变速（工具）',
      description:
        '用 ffmpeg atempo 对已生成音频整体加速/减速（0.5–2.0），写入 assets。口播语速请走此路径，不要依赖 TTS speed。',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: AudioTempoBodySchema } },
        },
      },
      responses: {
        200: {
          description: 'tempo applied',
          content: {
            'application/json': { schema: AudioTempoResultSchema },
          },
        },
        400: {
          description: 'validation / ffmpeg error',
          content: { 'application/json': { schema: FailSchema } },
        },
      },
    }),
    stub as never,
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/render/slide',
      tags: ['render'],
      summary: '渲染单页 PNG / MP4',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: RenderSlideBodySchema } },
        },
      },
      responses: {
        200: {
          description: 'rendered',
          content: { 'application/json': { schema: RenderSlideResultSchema } },
        },
        400: {
          description: 'validation / render error',
          content: { 'application/json': { schema: FailSchema } },
        },
      },
    }),
    stub as never,
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/render/show',
      tags: ['render'],
      summary: '时间轴合成成片（画面 + 可选旁白 + 字幕）',
      description:
        '同步等待成片。长任务请用 POST /api/jobs/render-show，避免网关超时。scenes 可混排 template / image / video；每段可带 audio_src 与 cues。',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: RenderShowBodySchema } },
        },
      },
      responses: {
        200: {
          description: 'show mp4',
          content: {
            'application/json': { schema: RenderShowResultSchema },
          },
        },
        400: {
          description: 'validation / render error',
          content: { 'application/json': { schema: FailSchema } },
        },
      },
    }),
    stub as never,
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/render/mindmap',
      tags: ['render'],
      summary: '思维导图画布按时间轴出片',
      description:
        '读 Obsidian canvas 节点坐标，移动 16:9/自定义镜头并导出 mp4；可传 audio_src（及 bgm/subtitle）混入旁白。传 stills 时只出静帧。长片请用 POST /api/jobs/render-mindmap。',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: RenderMindmapBodySchema } },
        },
      },
      responses: {
        200: {
          description: 'mindmap mp4 or stills',
          content: {
            'application/json': { schema: RenderMindmapResultSchema },
          },
        },
        400: {
          description: 'validation / render error',
          content: { 'application/json': { schema: FailSchema } },
        },
      },
    }),
    stub as never,
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/jobs/render-mindmap',
      tags: ['jobs'],
      summary: '异步提交思维导图成片',
      description: '请求体与 POST /api/render/mindmap 相同，立刻返回 job_id。',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: RenderMindmapBodySchema } },
        },
      },
      responses: {
        200: {
          description: 'queued',
          content: {
            'application/json': { schema: JobEnqueueResultSchema },
          },
        },
        400: {
          description: 'validation error',
          content: { 'application/json': { schema: FailSchema } },
        },
      },
    }),
    stub as never,
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/jobs/render-show',
      tags: ['jobs'],
      summary: '异步提交 show 成片任务',
      description:
        '请求体与 POST /api/render/show 相同，立刻返回 job_id。用 GET /api/jobs/{id} 轮询 status。',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: RenderShowBodySchema } },
        },
      },
      responses: {
        200: {
          description: 'queued',
          content: {
            'application/json': { schema: JobEnqueueResultSchema },
          },
        },
        400: {
          description: 'validation error',
          content: { 'application/json': { schema: FailSchema } },
        },
      },
    }),
    stub as never,
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/jobs/{id}',
      tags: ['jobs'],
      summary: '查询异步任务状态',
      request: {
        params: JobIdParamSchema,
      },
      responses: {
        200: {
          description: 'job',
          content: {
            'application/json': {
              schema: JobRecordSchema.extend({
                ok: z.literal(true),
              }),
            },
          },
        },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: FailSchema } },
        },
      },
    }),
    stub as never,
  )

  return app
}

export function getOpenApiDocument() {
  const app = buildOpenApiApp()
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: 'G-PPT API',
      version: '0.1.0',
      description:
        '模板 catalog + 媒体资产 + 时间轴渲染（可叠旁白/字幕）+ 思维导图播放视频。长成片用 POST /api/jobs/render-show 或 /api/jobs/render-mindmap 异步提交，再 GET /api/jobs/{id} 轮询。',
    },
    tags: [
      { name: 'catalog', description: '模板 / 节目包契约' },
      { name: 'assets', description: '图片 / 视频 / 音频 / 字幕上传' },
      { name: 'audio', description: '音频工具（concat）' },
      { name: 'render', description: 'PNG / MP4 同步渲染' },
      { name: 'jobs', description: '异步成片任务' },
      { name: 'system', description: '健康与自检' },
    ],
  })
}
