import type { ComponentType } from 'react'
import type { z } from 'zod'

export type TemplateType =
  | 'title'
  | 'bullets'
  | 'compare'
  | 'process'
  | 'code'
  | 'math'
  | 'chart'
  | 'canvas'
  | string

/** 节目 / 模板组 */
export interface PackDefinition {
  id: string
  name: string
  description?: string
  order?: number
}

export interface TemplateDefinition<T = unknown> {
  /** 唯一 ID，Agent 调用时用这个（全局唯一） */
  id: string
  type: TemplateType
  name: string
  /** 给 Agent 的选版说明（何时用这个模板） */
  description: string
  tags: string[]
  /**
   * 选版：何时用这个 type（同 type 多模板时取第一条非空）。
   * 进入 catalog，由 media 生成提示词选版规则。
   */
  when?: string
  /**
   * 哪些口播 role 优先用这个 type。
   * 未填时：已知 type 用内置默认；新 type 默认 role = type 名。
   */
  roles?: string[]
  /** 列表排序，越小越靠前 */
  order?: number
  /**
   * 所属节目包。通常由所在文件夹自动推断，也可在此覆盖。
   * 例：slides/default/xxx.tsx → pack = "default"
   */
  pack?: string
  /**
   * 输入契约（必填）。catalog 会自动导出为 JSON Schema + inputs 摘要。
   * 数组请用 .min()/.max() 标明条数，Agent 才能知道「输几条」。
   */
  schema: z.ZodType<T>
  component: ComponentType<{ data: T }>
  /**
   * 合法示例 props（必填）。进入 catalog.demo，供 Agent few-shot。
   * 必须能通过 schema 校验。
   */
  demo: T
  /**
   * 成片时按 scene 时长实时录屏（含 iframe 动效），而非截一帧静图拉长。
   * 仅含持续动画的模板需要开启。
   */
  live?: boolean
}

/** 注册后的完整模板（必有 pack） */
export type RegisteredTemplate<T = unknown> = TemplateDefinition<T> & {
  pack: string
  /** 文件路径，便于调试 */
  source: string
}
