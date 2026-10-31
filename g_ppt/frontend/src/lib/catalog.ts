import { z } from 'zod'
import { listPacks, listTemplates, getTemplate } from '../registry/templates'
import { buildLayoutRules, type LayoutRules } from './layout-rules'

export type CatalogPack = {
  id: string
  name: string
  description?: string
  order?: number
}

/** Agent 可读的字段摘要（由 JSON Schema 自动推导） */
export type TemplateInputField = {
  name: string
  required: boolean
  type: string
  /** 数组元素类型 */
  items?: string
  minItems?: number
  maxItems?: number
  /** 嵌套 object 字段 */
  fields?: TemplateInputField[]
}

export type CatalogTemplate = {
  id: string
  pack: string
  type: string
  name: string
  description: string
  tags: string[]
  order?: number
  /** 选版：何时用这个 type */
  when?: string
  /** 哪些口播 role 优先用这个 type */
  roles?: string[]
  /** JSON Schema（Zod → JSON Schema） */
  schema: Record<string, unknown>
  /** 合法示例 props，可直接当 few-shot */
  demo: Record<string, unknown>
  /** 扁平字段说明：输什么、几条 */
  inputs: TemplateInputField[]
}

export type Catalog = {
  version: number
  generatedAt: string
  packs: CatalogPack[]
  templates: CatalogTemplate[]
  layout_rules: LayoutRules
}

function schemaToJson(schema: z.ZodType): Record<string, unknown> {
  // Zod 4 built-in JSON Schema export
  return z.toJSONSchema(schema) as Record<string, unknown>
}

function jsonSchemaToInputs(
  schema: Record<string, unknown>,
): TemplateInputField[] {
  const props = schema.properties
  if (!props || typeof props !== 'object') return []
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((x): x is string => typeof x === 'string')
      : [],
  )

  return Object.entries(props as Record<string, Record<string, unknown>>).map(
    ([name, def]) => {
      const type = typeof def.type === 'string' ? def.type : 'unknown'
      const field: TemplateInputField = {
        name,
        required: required.has(name),
        type,
      }
      if (type === 'array') {
        const items = def.items as Record<string, unknown> | undefined
        field.items =
          items && typeof items.type === 'string' ? items.type : 'unknown'
        if (typeof def.minItems === 'number') field.minItems = def.minItems
        if (typeof def.maxItems === 'number') field.maxItems = def.maxItems
        if (items?.type === 'object') {
          field.fields = jsonSchemaToInputs(items)
        }
      }
      if (type === 'object') {
        field.fields = jsonSchemaToInputs(def)
      }
      return field
    },
  )
}

export function buildCatalog(): Catalog {
  const packs = listPacks().map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    order: p.order,
  }))

  const templates: CatalogTemplate[] = listTemplates().map((t) => {
    const schema = schemaToJson(t.schema)
    return {
      id: t.id,
      pack: t.pack,
      type: t.type,
      name: t.name,
      description: t.description,
      tags: [...t.tags],
      order: t.order,
      ...(t.when ? { when: t.when } : {}),
      ...(t.roles?.length ? { roles: [...t.roles] } : {}),
      schema,
      demo: t.demo as Record<string, unknown>,
      inputs: jsonSchemaToInputs(schema),
    }
  })

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    packs,
    templates,
    layout_rules: buildLayoutRules(templates),
  }
}

export function validateTemplateProps(
  templateId: string,
  props: unknown,
): { ok: true; data: unknown } | { ok: false; error: string } {
  const t = getTemplate(templateId)
  if (!t) {
    return { ok: false, error: `unknown template_id: ${templateId}` }
  }
  const parsed = t.schema.safeParse(props)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    }
  }
  return { ok: true, data: parsed.data }
}
