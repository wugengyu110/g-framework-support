/**
 * G-PPT CLI — 薄封装，逻辑在 engine.ts
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  apiConcatAudio,
  apiGetSchema,
  apiListTemplates,
  apiGetLayoutRules,
  apiRenderShow,
  apiRenderSlide,
  exportCatalog,
  listPacks,
  root,
  type Scene,
} from './engine'

function printJson(data: unknown) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n')
}

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {}
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positionals.push(a)
    }
  }
  return { flags, positionals }
}

function cmdPreview(flags: Record<string, string | boolean>) {
  const pack = flags.pack ? String(flags.pack) : ''
  const template = flags.template ? String(flags.template) : ''
  const q = new URLSearchParams()
  if (pack) q.set('pack', pack)
  if (template) q.set('template', template)
  const openUrl = `http://127.0.0.1:5173/${q.toString() ? `?${q}` : ''}`

  const child = spawn(
    'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'],
    { cwd: root, stdio: 'inherit', shell: true, env: process.env },
  )
  setTimeout(() => {
    const opener =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'start'
          : 'xdg-open'
    spawn(opener, [openUrl], {
      shell: true,
      stdio: 'ignore',
      detached: true,
    }).unref()
  }, 1500)
  child.on('exit', (code) => process.exit(code ?? 0))
}

async function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  const { flags, positionals } = parseArgs(argv.slice(1))

  switch (cmd) {
    case 'catalog': {
      const catalog = exportCatalog()
      printJson({
        ok: true,
        path: resolve(root, 'catalog/catalog.json'),
        packs: catalog.packs.length,
        templates: catalog.templates.length,
      })
      break
    }
    case 'list-packs':
      printJson(listPacks())
      break
    case 'list-templates':
      printJson(
        apiListTemplates({
          pack: flags.pack ? String(flags.pack) : undefined,
          type: flags.type ? String(flags.type) : undefined,
        }),
      )
      break
    case 'layout-rules':
      printJson(apiGetLayoutRules())
      break
    case 'schema': {
      const id = positionals[0] || String(flags.id || '')
      if (!id) throw new Error('schema <template_id> required')
      printJson(apiGetSchema(id))
      break
    }
    case 'render-slide': {
      const id = String(flags.id || '')
      if (!id) throw new Error('--id required')
      let props: Record<string, unknown> | undefined
      if (flags.props) props = JSON.parse(String(flags.props))
      else if (flags['props-file']) {
        props = JSON.parse(readFileSync(String(flags['props-file']), 'utf8'))
      }
      const format = (String(flags.format || 'png') as 'png' | 'mp4')
      const result = await apiRenderSlide({
        template_id: id,
        props,
        format,
        duration_sec: Number(flags.duration ?? flags['duration-sec'] ?? 5),
        filename: flags.out
          ? String(flags.out).split(/[/\\]/).pop()
          : undefined,
      })
      if (flags.out) {
        // apiRenderSlide writes to output/; if custom out path requested, move via re-render to that name
        const { renameSync, copyFileSync, existsSync } = await import('node:fs')
        const dest = resolve(String(flags.out))
        if (result.path !== dest && existsSync(result.path)) {
          try {
            renameSync(result.path, dest)
          } catch {
            copyFileSync(result.path, dest)
          }
          result.path = dest
        }
      }
      printJson(result)
      break
    }
    case 'render-show': {
      const scenesPath = String(flags.scenes || '')
      if (!scenesPath) throw new Error('--scenes <file.json> required')
      const raw = JSON.parse(readFileSync(resolve(scenesPath), 'utf8')) as
        | Scene[]
        | {
            scenes: Scene[]
            subtitle_src?: string
            burn_in?: boolean
            keep_video_audio?: boolean
            bgm_src?: string
            bgm_volume?: number
            presenter?: import('./engine').PresenterOverlay
          }
      const list = Array.isArray(raw) ? raw : raw.scenes
      const result = await apiRenderShow({
        scenes: list,
        subtitle_src: Array.isArray(raw) ? undefined : raw.subtitle_src,
        burn_in: Array.isArray(raw) ? undefined : raw.burn_in,
        keep_video_audio: Array.isArray(raw) ? undefined : raw.keep_video_audio,
        bgm_src: Array.isArray(raw) ? undefined : raw.bgm_src,
        bgm_volume: Array.isArray(raw) ? undefined : raw.bgm_volume,
        presenter: Array.isArray(raw) ? undefined : raw.presenter,
        filename: flags.out
          ? String(flags.out).split(/[/\\]/).pop()
          : 'show.mp4',
      })
      if (flags.out) {
        const { renameSync, copyFileSync, existsSync } = await import('node:fs')
        const dest = resolve(String(flags.out))
        if (result.path !== dest && existsSync(result.path)) {
          try {
            renameSync(result.path, dest)
          } catch {
            copyFileSync(result.path, dest)
          }
          result.path = dest
        }
      }
      printJson(result)
      break
    }
    case 'audio-concat': {
      const sourcesPath = String(flags.sources || '')
      let sources: string[]
      if (sourcesPath) {
        const raw = JSON.parse(readFileSync(resolve(sourcesPath), 'utf8')) as
          | string[]
          | { sources: string[] }
        sources = Array.isArray(raw) ? raw : raw.sources
      } else if (flags.source) {
        sources = String(flags.source)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      } else {
        throw new Error('--sources <file.json> or --source a,b required')
      }
      printJson(
        await apiConcatAudio({
          sources,
          filename: flags.out ? String(flags.out).split(/[/\\]/).pop() : undefined,
        }),
      )
      break
    }
    case 'preview':
      cmdPreview(flags)
      break
    default:
      console.error(`Unknown or missing command: ${cmd ?? '(none)'}
Commands: catalog | list-packs | list-templates | layout-rules | schema | render-slide | render-show | audio-concat | preview`)
      process.exit(1)
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({ ok: false, error: String((err as Error)?.message || err) }),
  )
  process.exit(1)
})
