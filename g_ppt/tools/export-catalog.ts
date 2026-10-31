/**
 * 仅从 registry 导出 catalog，不拉取 Playwright / Vite server。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCatalog } from '../frontend/src/lib/catalog'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogFile = resolve(root, 'catalog/catalog.json')

const catalog = buildCatalog()
mkdirSync(dirname(catalogFile), { recursive: true })
writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + '\n')
console.log(
  `[g-ppt] catalog exported → ${catalogFile} (${catalog.packs.length} packs, ${catalog.templates.length} templates)`,
)
