/**
 * OpenAPI 契约（仅供 `npm run catalog` / export-openapi 生成文档）。
 * 运行时请求体校验见 frontend/src/lib/api-body.ts（纯 zod，避免加载 @hono/zod-openapi）。
 * 改 body 字段时请同步本文件对应 schema。
 */
import { z } from '@hono/zod-openapi'

export const ErrorSchema = z
  .object({
    error: z.string(),
  })
  .openapi('Error')

export const FailSchema = z
  .object({
    ok: z.literal(false),
    error: z.string(),
  })
  .openapi('Fail')

export const RefreshQuerySchema = z.object({
  refresh: z
    .enum(['true', 'false'])
    .optional()
    .openapi({
      description: '默认重建 catalog；传 false 读磁盘缓存',
      example: 'true',
    }),
})

export const PackSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    order: z.number().optional(),
  })
  .openapi('Pack')

export const TemplateInputFieldSchema = z
  .object({
    name: z.string(),
    required: z.boolean(),
    type: z.string(),
    items: z.string().optional(),
    minItems: z.number().optional(),
    maxItems: z.number().optional(),
    fields: z.array(z.any()).optional().openapi({
      description: '嵌套 object 字段（结构同本 schema）',
    }),
  })
  .openapi('TemplateInputField')

export const TemplateContractSchema = z
  .object({
    id: z.string().openapi({ example: 'compare_two_col_v1' }),
    pack: z.string(),
    type: z.string(),
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
    order: z.number().optional(),
    schema: z.record(z.string(), z.any()).openapi({
      description: 'JSON Schema（由模板 Zod 导出）',
    }),
    demo: z.record(z.string(), z.any()).openapi({
      description: '合法示例 props，可作 few-shot',
    }),
    inputs: z.array(TemplateInputFieldSchema).openapi({
      description: '字段摘要：必填 / 类型 / minItems / maxItems',
    }),
    when: z.string().optional().openapi({
      description: '选版：何时用这个 type',
    }),
    roles: z.array(z.string()).optional().openapi({
      description: '哪些口播 role 优先用这个 type',
    }),
  })
  .openapi('TemplateContract')

export const LayoutTypeRuleSchema = z
  .object({
    type: z.string(),
    when: z.string(),
    roles: z.array(z.string()),
    shape: z.string().openapi({
      description: '该 type 常见调用形状，如 title(badge?, title)',
    }),
    template_ids: z.array(z.string()),
  })
  .openapi('LayoutTypeRule')

export const LayoutRulesPromptSchema = z
  .object({
    type_rules: z.string(),
    type_shapes: z.string(),
    role_map: z.string(),
    valid_roles: z.string(),
    type_when: z.string(),
  })
  .openapi('LayoutRulesPrompt')

export const LayoutRulesSchema = z
  .object({
    types: z.array(LayoutTypeRuleSchema),
    role_to_types: z.record(z.string(), z.array(z.string())),
    valid_roles: z.array(z.string()),
    structural_roles: z.array(z.string()),
    prompt: LayoutRulesPromptSchema,
  })
  .openapi('LayoutRules')

export const TemplatesQuerySchema = RefreshQuerySchema.extend({
  pack: z.string().optional().openapi({ example: 'default' }),
  type: z.string().optional().openapi({ example: 'compare' }),
})

export const TemplateIdParamSchema = z.object({
  id: z
    .string()
    .min(1)
    .openapi({
      param: { name: 'id', in: 'path' },
      example: 'compare_two_col_v1',
    }),
})

export const CatalogRefreshResultSchema = z
  .object({
    ok: z.literal(true),
    packs: z.number(),
    templates: z.number(),
  })
  .openapi('CatalogRefreshResult')

export const HealthSchema = z
  .object({
    status: z.literal('ok'),
  })
  .openapi('Health')

export const DoctorSchema = z
  .object({
    npm: z.boolean(),
    node: z.boolean(),
    ffmpeg: z.boolean(),
    ffprobe: z.boolean().optional(),
    catalog_exists: z.boolean(),
    web_dist_exists: z.boolean(),
    repo_root: z.string(),
    render_base_url: z.string().nullable(),
    output_dir: z.string(),
    assets_dir: z.string().optional(),
    jobs_dir: z.string().optional(),
    concurrency: z.number().optional(),
  })
  .openapi('Doctor')

export const RenderSlideBodySchema = z
  .object({
    template_id: z.string().openapi({ example: 'compare_two_col_v1' }),
    props: z
      .record(z.string(), z.any())
      .optional()
      .openapi({ description: '省略则用模板 demo' }),
    format: z.enum(['png', 'mp4']).optional().openapi({ example: 'png' }),
    duration_sec: z.number().positive().optional().openapi({ example: 5 }),
    filename: z.string().optional(),
  })
  .openapi('RenderSlideBody')

export const RenderSlideResultSchema = z
  .object({
    ok: z.literal(true),
    template_id: z.string(),
    format: z.string(),
    duration_sec: z.number().optional(),
    path: z.string(),
  })
  .openapi('RenderSlideResult')

export const TemplateSceneSchema = z
  .object({
    kind: z.literal('template').optional().openapi({
      description: '省略时默认为 template（兼容旧 JSON）',
    }),
    template_id: z.string().openapi({ example: 'title_mark_split_v1' }),
    props: z.record(z.string(), z.any()),
    duration_sec: z.number().positive().optional().openapi({
      description: '无 audio_src 时的画面时长；有旁白则以音频时长为准',
      example: 3,
    }),
    audio_src: z.string().optional().openapi({
      description: '该段旁白 asset:<id>；有则画面时长跟音频',
      example: 'asset:narration_01.mp3',
    }),
    cues: z
      .array(
        z.object({
          start: z.number().nonnegative(),
          end: z.number().positive(),
          text: z.string(),
        }),
      )
      .optional()
      .openapi({ description: '相对本段起点的字幕 cue（秒）' }),
  })
  .openapi('TemplateScene')

export const ImageSceneSchema = z
  .object({
    kind: z.literal('image'),
    src: z
      .string()
      .optional()
      .openapi({
        description: '单图：asset:<id> / assets 内文件名 / 容器内绝对路径',
        example: 'asset:1710000000_photo.png',
      }),
    srcs: z
      .array(z.string())
      .min(2)
      .optional()
      .openapi({
        description: '同页多图；引擎拼网格。与 src 二选一或同时给（优先 srcs）',
        example: ['asset:a.png', 'asset:b.png'],
      }),
    duration_sec: z.number().positive().optional().openapi({ example: 4 }),
    fit: z.enum(['contain', 'cover']).optional().openapi({ example: 'contain' }),
    audio_src: z.string().optional().openapi({
      description: '该段旁白；有则画面时长跟音频',
    }),
    cues: z
      .array(
        z.object({
          start: z.number().nonnegative(),
          end: z.number().positive(),
          text: z.string(),
        }),
      )
      .optional(),
  })
  .openapi('ImageScene')

export const VideoSceneSchema = z
  .object({
    kind: z.literal('video'),
    src: z.string().openapi({
      description: 'asset:<id> / assets 内文件名 / 容器内绝对路径',
      example: 'asset:1710000000_clip.mp4',
    }),
    trim_start_sec: z.number().nonnegative().optional().openapi({ example: 0 }),
    trim_end_sec: z.number().positive().optional().openapi({
      description: '省略则到片尾',
      example: 10,
    }),
    audio_src: z.string().optional().openapi({
      description: '替换该段音轨的旁白；有则按音频时长对齐画面',
    }),
    cues: z
      .array(
        z.object({
          start: z.number().nonnegative(),
          end: z.number().positive(),
          text: z.string(),
        }),
      )
      .optional(),
  })
  .openapi('VideoScene')

export const SceneSchema = z
  .union([TemplateSceneSchema, ImageSceneSchema, VideoSceneSchema])
  .openapi('Scene')

export const PresenterOverlaySchema = z
  .object({
    src: z.string().openapi({
      description: '人像 mp4：asset:<id> / assets 相对路径 / 绝对路径',
      example: 'presenter/talking.mp4',
    }),
    size: z.number().positive().optional().openapi({
      description: '圆形直径 px，默认 280',
      example: 280,
    }),
    margin: z.number().nonnegative().optional().openapi({
      description: '距右/下边距 px，默认 48',
      example: 48,
    }),
    keep_audio: z.boolean().optional().openapi({
      description: 'true 保留人像音轨；默认 false（静音，只用主片旁白）',
      example: false,
    }),
  })
  .openapi('PresenterOverlay')

export const RenderShowBodySchema = z
  .object({
    scenes: z.array(SceneSchema).min(1),
    filename: z.string().optional().openapi({ example: 'show.mp4' }),
    subtitle_src: z.string().optional().openapi({
      description: '成片绝对时间轴 SRT（asset:<id>）；优先于各 scene.cues',
      example: 'asset:full.srt',
    }),
    burn_in: z.boolean().optional().openapi({
      description: 'true 硬烧字幕；默认 false（sidecar .srt + 软挂 mov_text）',
      example: false,
    }),
    keep_video_audio: z.boolean().optional().openapi({
      description:
        '有 scene.audio_src 时是否保留该段原片音轨并与旁白混音；默认 false（旁白替换原声）',
      example: false,
    }),
    bgm_src: z.string().optional().openapi({
      description: '成片级循环背景音乐：asset:<id> / assets 相对路径 / 绝对路径',
      example: 'asset:1710000000_bgm.mp3',
    }),
    bgm_volume: z.number().min(0).max(1).optional().openapi({
      description: 'BGM 相对音量 0–1，默认 0.25',
      example: 0.25,
    }),
    presenter: PresenterOverlaySchema.optional().openapi({
      description:
        '右下角圆形人像画中画；短于主片则循环，长于主片则裁剪；type=title 封面时段不显示',
    }),
  })
  .openapi('RenderShowBody')

export const RenderShowResultSchema = z
  .object({
    ok: z.literal(true),
    path: z.string(),
    timeline_path: z.string(),
    subtitle_path: z.string().optional(),
    total_sec: z.number(),
    scenes: z.number(),
  })
  .openapi('RenderShowResult')

export const AudioConcatBodySchema = z
  .object({
    sources: z
      .array(z.string())
      .min(1)
      .openapi({
        description: '短语音 asset:<id> 列表，按顺序拼接',
        example: ['asset:a.mp3', 'asset:b.mp3'],
      }),
    filename: z.string().optional().openapi({ example: 'full_narration.m4a' }),
  })
  .openapi('AudioConcatBody')

export const AudioConcatResultSchema = z
  .object({
    ok: z.literal(true),
    id: z.string(),
    path: z.string(),
    url: z.string(),
    src: z.string().openapi({ example: 'asset:….m4a' }),
    duration_sec: z.number(),
    parts: z.number(),
  })
  .openapi('AudioConcatResult')

export const AudioTempoBodySchema = z
  .object({
    source: z.string().min(1).openapi({
      description: '待变速音频 asset:<id> 或可解析路径',
      example: 'asset:narration_000.wav',
    }),
    speed: z.number().min(0.5).max(2.0).openapi({
      description: 'ffmpeg atempo 倍率，0.5–2.0；1=不变',
      example: 1.2,
    }),
    filename: z.string().optional().openapi({ example: 'narration_000.wav' }),
  })
  .openapi('AudioTempoBody')

export const AudioTempoResultSchema = z
  .object({
    ok: z.literal(true),
    id: z.string(),
    path: z.string(),
    url: z.string(),
    src: z.string().openapi({ example: 'asset:….wav' }),
    duration_sec: z.number(),
    speed: z.number(),
  })
  .openapi('AudioTempoResult')

export const JobIdParamSchema = z.object({
  id: z
    .string()
    .min(1)
    .openapi({
      param: { name: 'id', in: 'path' },
      example: '550e8400-e29b-41d4-a716-446655440000',
    }),
})

export const JobProgressSchema = z
  .object({
    scene: z.number(),
    total: z.number(),
  })
  .openapi('JobProgress')

export const JobResultSchema = z
  .object({
    path: z.string(),
    timeline_path: z.string(),
    subtitle_path: z.string().optional(),
    total_sec: z.number(),
    scenes: z.number(),
  })
  .openapi('JobResult')

export const JobRecordSchema = z
  .object({
    id: z.string(),
    kind: z.literal('render_show'),
    status: z.enum(['queued', 'running', 'done', 'error']),
    created_at: z.string(),
    started_at: z.string().optional(),
    finished_at: z.string().optional(),
    progress: JobProgressSchema.nullable().optional(),
    result: JobResultSchema.optional(),
    error: z.string().optional(),
  })
  .openapi('JobRecord')

export const JobEnqueueResultSchema = z
  .object({
    ok: z.literal(true),
    job_id: z.string(),
    status: z.literal('queued'),
  })
  .openapi('JobEnqueueResult')

export const AssetUploadResultSchema = z
  .object({
    ok: z.literal(true),
    id: z.string(),
    path: z.string(),
    url: z.string().openapi({ example: '/media/1710000000_photo.png' }),
    content_type: z.string(),
    size: z.number(),
    /** 写入 show scene.src 时用 */
    src: z.string().openapi({ example: 'asset:1710000000_photo.png' }),
  })
  .openapi('AssetUploadResult')

