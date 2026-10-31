import type { CatalogTemplate } from './catalog'

export type LayoutTypeRule = {
  type: string
  when: string
  roles: string[]
  shape: string
  template_ids: string[]
}

export type LayoutRulesPrompt = {
  type_rules: string
  type_shapes: string
  role_map: string
  valid_roles: string
  type_when: string
}

export type LayoutRules = {
  types: LayoutTypeRule[]
  role_to_types: Record<string, string[]>
  valid_roles: string[]
  structural_roles: string[]
  prompt: LayoutRulesPrompt
}

const STRUCTURAL_ROLES = [
  'hook',
  'open',
  'close',
  'concept',
  'example',
  'summary',
] as const

const DEFAULT_ROLES_BY_TYPE: Record<string, string[]> = {
  title: ['hook', 'open', 'close'],
  bullets: ['concept', 'example', 'summary'],
  process: ['steps'],
  compare: ['compare'],
  code: ['code'],
  math: ['math'],
  chart: ['chart'],
  canvas: ['canvas'],
}

const WHEN_FALLBACK: Record<string, string> = {
  title: '开场/收束封面',
  bullets: '概念/要点/示例',
  compare: '对照两边',
  process: '线性步骤',
  code: '可演示代码',
  math: '公式/方程/定理（与讲解同屏：画面公式+白话要点，不要让公式独占整页）',
  chart: '可比数字/占比/趋势',
  canvas: '概念/模块关系网（非线性步骤）',
}

const FALLBACK_PREFERRED: Record<string, string[]> = {
  summary: ['bullets', 'title'],
  code: ['code', 'bullets'],
  chart: ['chart', 'bullets'],
  canvas: ['canvas', 'bullets'],
}

const ROLE_ORDER = [
  'hook',
  'open',
  'close',
  'concept',
  'example',
  'summary',
  'compare',
  'steps',
  'code',
  'math',
  'chart',
  'canvas',
] as const

const VALID_ROLE_ORDER = [
  'hook',
  'open',
  'concept',
  'compare',
  'steps',
  'code',
  'math',
  'chart',
  'canvas',
  'example',
  'summary',
  'close',
] as const

function groupByType(templates: CatalogTemplate[]): Map<string, CatalogTemplate[]> {
  const byType = new Map<string, CatalogTemplate[]>()
  for (const t of templates) {
    const ttype = String(t.type || '').trim().toLowerCase()
    if (!ttype) continue
    const list = byType.get(ttype) ?? []
    list.push(t)
    byType.set(ttype, list)
  }
  return byType
}

function rolesForType(ttype: string, items: CatalogTemplate[]): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  for (const t of items) {
    for (const raw of t.roles ?? []) {
      const role = String(raw || '').trim().toLowerCase()
      if (role && !seen.has(role)) {
        seen.add(role)
        found.push(role)
      }
    }
  }
  if (found.length) return found
  if (DEFAULT_ROLES_BY_TYPE[ttype]) return [...DEFAULT_ROLES_BY_TYPE[ttype]]
  return [ttype]
}

function whenForType(ttype: string, items: CatalogTemplate[]): string {
  for (const t of items) {
    const when = String(t.when || '').trim()
    if (when) return when
  }
  if (WHEN_FALLBACK[ttype]) return WHEN_FALLBACK[ttype]
  for (const t of items) {
    const desc = String(t.description || '').trim()
    if (desc) return desc.split('。')[0].split('；')[0]
  }
  return ''
}

function rangeSig(minItems?: number, maxItems?: number): string {
  const hasMin = typeof minItems === 'number'
  const hasMax = typeof maxItems === 'number'
  if (hasMin && hasMax) return `[${minItems}–${maxItems}]`
  if (hasMin) return `[${minItems}+]`
  if (hasMax) return `[≤${maxItems}]`
  return ''
}

function fieldSig(field: {
  name: string
  required: boolean
  type: string
  minItems?: number
  maxItems?: number
  fields?: Array<{
    name: string
    required: boolean
    type: string
    minItems?: number
    maxItems?: number
    fields?: unknown[]
  }>
}): string {
  const name = String(field.name || '').trim()
  if (!name) return ''
  const suffix = field.required ? '' : '?'
  if (field.type === 'array') {
    const rng = rangeSig(field.minItems, field.maxItems)
    const nested = field.fields
    if (Array.isArray(nested) && nested.length) {
      const inner = nested
        .map((n) => fieldSig(n as typeof field))
        .filter(Boolean)
        .join(', ')
      return `${name}[{${inner}}]${rng}${suffix}`
    }
    return `${name}${rng}${suffix}`
  }
  if (field.type === 'object') {
    const nested = field.fields
    if (Array.isArray(nested) && nested.length) {
      const inner = nested
        .map((n) => fieldSig(n as typeof field))
        .filter(Boolean)
        .join(', ')
      return `${name}{${inner}}${suffix}`
    }
    return `${name}${suffix}`
  }
  return `${name}${suffix}`
}

function typeShapeLine(ttype: string, inputs: CatalogTemplate['inputs']): string {
  const inner = (inputs ?? [])
    .map((f) => fieldSig(f))
    .filter(Boolean)
    .join(', ')
  return inner ? `${ttype}(${inner})` : `${ttype}()`
}

function roleToTypes(
  byType: Map<string, CatalogTemplate[]>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [ttype, group] of byType) {
    for (const role of rolesForType(ttype, group)) {
      const bucket = out[role] ?? []
      if (!bucket.includes(ttype)) bucket.push(ttype)
      out[role] = bucket
    }
  }
  for (const [role, extra] of Object.entries(FALLBACK_PREFERRED)) {
    if (!out[role]) continue
    for (const ttype of extra) {
      if (byType.has(ttype) && !out[role].includes(ttype)) out[role].push(ttype)
    }
  }
  return out
}

function validRoles(
  byType: Map<string, CatalogTemplate[]>,
  mapping: Record<string, string[]>,
): string[] {
  const roles = new Set<string>(STRUCTURAL_ROLES)
  for (const role of Object.keys(mapping)) roles.add(role)
  for (const ttype of byType.keys()) roles.add(ttype)
  return [...roles]
}

function validRolesBrief(roles: string[]): string {
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const role of VALID_ROLE_ORDER) {
    if (roles.includes(role) && !seen.has(role)) {
      seen.add(role)
      ordered.push(role)
    }
  }
  for (const role of [...roles].sort()) {
    if (!seen.has(role)) {
      seen.add(role)
      ordered.push(role)
    }
  }
  return ordered.join('|') || 'hook|open|concept|summary|close'
}

function typeRulesText(types: LayoutTypeRule[]): string {
  if (!types.length) return '（无可用模板类型）'
  return types
    .map((t) => {
      let head = `- ${t.type}`
      if (t.when) head += `：${t.when}`
      if (t.roles.length) head += `。roles: ${t.roles.join(', ')}`
      return head
    })
    .join('\n')
}

function typeShapesText(types: LayoutTypeRule[]): string {
  if (!types.length) {
    return '（对照下方可用模板的 inputs 填 props；demo 只示意形状）'
  }
  return [
    '字段名以各模板 inputs 为准；下列为该 type 常见形状，demo 禁止照抄：',
    ...types.map((t) => `- ${t.shape}`),
  ].join('\n')
}

function roleMapText(mapping: Record<string, string[]>): string {
  const entries = Object.entries(mapping)
  if (!entries.length) return '（无 role 映射，按 type.when 选）'
  const grouped = new Map<string, string[]>()
  for (const [role, types] of entries) {
    const key = types.join(',')
    const list = grouped.get(key) ?? []
    list.push(role)
    grouped.set(key, list)
  }
  const lines: string[] = []
  const seen = new Set<string>()
  for (const role of ROLE_ORDER) {
    const types = mapping[role]
    if (!types?.length) continue
    const key = types.join(',')
    if (seen.has(key)) continue
    seen.add(key)
    const roles = grouped.get(key) ?? [role]
    const ordered: string[] = ROLE_ORDER.filter((r) => roles.includes(r))
    ordered.push(...roles.filter((r) => !ordered.includes(r)))
    lines.push(`- ${ordered.join(' / ')} → ${types.join(', ')}`)
  }
  for (const [key, roles] of grouped) {
    if (seen.has(key)) continue
    lines.push(`- ${roles.join(' / ')} → ${key.split(',').join(', ')}`)
  }
  return lines.join('\n')
}

function typeWhenText(types: LayoutTypeRule[]): string {
  if (!types.length) return '（无可用模板类型，按 role 惯例切断）'
  return types
    .map((t) => `- ${t.type}` + (t.when ? `：${t.when}` : ''))
    .join('\n')
}

/** 从 catalog 模板聚合 type 级选版规则（供 GET /api/layout-rules）。 */
export function buildLayoutRules(templates: CatalogTemplate[]): LayoutRules {
  const byType = groupByType(templates)
  const types: LayoutTypeRule[] = [...byType.keys()]
    .sort()
    .map((ttype) => {
      const group = byType.get(ttype) ?? []
      return {
        type: ttype,
        when: whenForType(ttype, group),
        roles: rolesForType(ttype, group),
        shape: typeShapeLine(ttype, group[0]?.inputs ?? []),
        template_ids: group.map((t) => t.id).filter(Boolean),
      }
    })
  const mapping = roleToTypes(byType)
  const roles = validRoles(byType, mapping)
  return {
    types,
    role_to_types: mapping,
    valid_roles: roles,
    structural_roles: [...STRUCTURAL_ROLES],
    prompt: {
      type_rules: typeRulesText(types),
      type_shapes: typeShapesText(types),
      role_map: roleMapText(mapping),
      valid_roles: validRolesBrief(roles),
      type_when: typeWhenText(types),
    },
  }
}
