import type {
  PackDefinition,
  RegisteredTemplate,
  TemplateDefinition,
  TemplateType,
} from './types'

type TemplateModule = {
  template?: TemplateDefinition
}

type PackModule = {
  pack?: Omit<PackDefinition, 'id'> & { id?: string }
}

const templateModules = import.meta.glob<TemplateModule>(
  '../templates/slides/*/*.tsx',
  { eager: true },
)

const packModules = import.meta.glob<PackModule>(
  '../templates/slides/*/pack.ts',
  { eager: true },
)

/** 从路径取 packId：.../slides/<packId>/file.tsx */
function packIdFromPath(path: string): string {
  const matched = path.match(/\/templates\/slides\/([^/]+)\//)
  if (!matched) {
    throw new Error(`[registry] cannot parse pack from path: ${path}`)
  }
  return matched[1]
}

function loadPacks(): PackDefinition[] {
  const fromDirs = new Set<string>()
  for (const path of Object.keys(templateModules)) {
    fromDirs.add(packIdFromPath(path))
  }
  for (const path of Object.keys(packModules)) {
    fromDirs.add(packIdFromPath(path))
  }

  const packs: PackDefinition[] = []
  for (const id of fromDirs) {
    const modPath = Object.keys(packModules).find((p) =>
      p.includes(`/slides/${id}/pack.ts`),
    )
    const meta = modPath ? packModules[modPath]?.pack : undefined
    packs.push({
      id,
      name: meta?.name ?? id,
      description: meta?.description,
      order: meta?.order ?? 100,
    })
  }

  return packs.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

function loadTemplates(): RegisteredTemplate[] {
  const list: RegisteredTemplate[] = []
  const seen = new Set<string>()

  for (const [path, mod] of Object.entries(templateModules)) {
    const t = mod.template
    if (!t) {
      console.warn(`[registry] skip ${path}: missing export const template`)
      continue
    }

    const pack = t.pack ?? packIdFromPath(path)
    if (seen.has(t.id)) {
      throw new Error(`[registry] duplicate template id: ${t.id} (${path})`)
    }
    seen.add(t.id)
    list.push({ ...t, pack, source: path })
  }

  return list.sort((a, b) => {
    if (a.pack !== b.pack) return a.pack.localeCompare(b.pack)
    return (a.order ?? 100) - (b.order ?? 100)
  })
}

export const PACKS = loadPacks()
export const TEMPLATES = loadTemplates()

export type {
  PackDefinition,
  RegisteredTemplate,
  TemplateDefinition,
  TemplateType,
}

export function getPack(id: string) {
  return PACKS.find((p) => p.id === id)
}

export function listPacks() {
  return [...PACKS]
}

export function getTemplate(id: string) {
  return TEMPLATES.find((t) => t.id === id)
}

export function listTemplates(filter?: {
  pack?: string
  type?: TemplateType
}) {
  return TEMPLATES.filter((t) => {
    if (filter?.pack && t.pack !== filter.pack) return false
    if (filter?.type && t.type !== filter.type) return false
    return true
  })
}
