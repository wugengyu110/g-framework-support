/**
 * 导出 OpenAPI JSON（不加载 engine，避免与 vite-node 冲突）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getOpenApiDocument } from '../server/openapi-def'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'catalog/openapi.json')

const doc = getOpenApiDocument()
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(doc, null, 2) + '\n')
console.log(
  `[g-ppt] openapi exported → ${out} (${Object.keys(doc.paths ?? {}).length} paths)`,
)
