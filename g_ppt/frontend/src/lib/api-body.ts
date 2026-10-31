/**
 * API 请求体运行时校验（纯 zod）。
 * 必须放在 frontend/ 下：vite-node 对「根外文件再静态 import npm 包」会卡住。
 */
import { z } from 'zod'

export const SubtitleCueSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().positive(),
  text: z.string().min(1),
})

const narrationFields = {
  audio_src: z.string().min(1).optional(),
  cues: z.array(SubtitleCueSchema).optional(),
}

/** 兼容旧 JSON：无 kind 时视为 template */
export const TemplateSceneBodySchema = z.object({
  kind: z.literal('template').optional(),
  template_id: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
  duration_sec: z.number().positive().optional(),
  ...narrationFields,
})

export const ImageSceneBodySchema = z
  .object({
    kind: z.literal('image'),
    src: z.string().min(1).optional(),
    srcs: z.array(z.string().min(1)).min(2).optional(),
    duration_sec: z.number().positive().optional(),
    fit: z.enum(['contain', 'cover']).optional(),
    ...narrationFields,
  })
  .refine((v) => Boolean(v.src) || Boolean(v.srcs?.length), {
    message: 'image scene 需要 src 或 srcs',
  })

export const VideoSceneBodySchema = z.object({
  kind: z.literal('video'),
  src: z.string().min(1),
  trim_start_sec: z.number().nonnegative().optional(),
  trim_end_sec: z.number().positive().optional(),
  ...narrationFields,
})

export const SceneBodySchema = z.union([
  ImageSceneBodySchema,
  VideoSceneBodySchema,
  TemplateSceneBodySchema,
])

export const RenderSlideBodySchema = z.object({
  template_id: z.string().min(1),
  props: z.record(z.string(), z.unknown()).optional(),
  format: z.enum(['png', 'mp4']).optional(),
  duration_sec: z.number().positive().optional(),
  filename: z.string().optional(),
})

export const PresenterOverlayBodySchema = z.object({
  /** asset:<id> / assets 相对路径 / 绝对路径 */
  src: z.string().min(1),
  /** 圆形直径 px，默认 280 */
  size: z.number().positive().optional(),
  /** 距右/下边距 px，默认 48 */
  margin: z.number().nonnegative().optional(),
  /** 是否保留人像音轨；默认 false（静音，只用主片旁白） */
  keep_audio: z.boolean().optional(),
})

export const RenderShowBodySchema = z.object({
  scenes: z.array(SceneBodySchema).min(1),
  filename: z.string().optional(),
  /** 成片绝对时间 SRT；优先于各 scene.cues */
  subtitle_src: z.string().min(1).optional(),
  /** true 硬烧；默认软挂 + sidecar .srt */
  burn_in: z.boolean().optional(),
  /** 有旁白时是否保留原片音轨并混音；默认 false */
  keep_video_audio: z.boolean().optional(),
  /** 成片级循环 BGM */
  bgm_src: z.string().min(1).optional(),
  /** BGM 相对音量 0–1，默认 0.25 */
  bgm_volume: z.number().min(0).max(1).optional(),
  /** 右下角圆形人像画中画；按时长循环或裁剪；title 封面时段不显示 */
  presenter: PresenterOverlayBodySchema.optional(),
})

export const AudioConcatBodySchema = z.object({
  sources: z.array(z.string().min(1)).min(1),
  filename: z.string().optional(),
})

export const AudioTempoBodySchema = z.object({
  source: z.string().min(1),
  speed: z.number().min(0.5).max(2.0),
  filename: z.string().optional(),
})

export type RenderSlideBody = z.infer<typeof RenderSlideBodySchema>
export type RenderShowBody = z.infer<typeof RenderShowBodySchema>
export type AudioConcatBody = z.infer<typeof AudioConcatBodySchema>
export type AudioTempoBody = z.infer<typeof AudioTempoBodySchema>
export type SceneBody = z.infer<typeof SceneBodySchema>
