import { useEffect, useMemo, useState } from 'react'
import {
  getTemplate,
  listPacks,
  listTemplates,
  TEMPLATES,
} from './registry/templates'
import './App.css'

function readSearch() {
  return new URLSearchParams(window.location.search)
}

function decodeProps(raw: string | null): unknown | null {
  if (!raw) return null
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

function RenderMode() {
  const params = readSearch()
  const id = params.get('id') || ''
  const propsParam = params.get('props')
  const template = getTemplate(id)

  const props = useMemo(() => {
    const decoded = decodeProps(propsParam)
    if (decoded) return decoded
    return template?.demo
  }, [propsParam, template])

  if (!template) {
    return (
      <div className="render-error" data-slide-ready="error">
        unknown template: {id}
      </div>
    )
  }

  const parsed = template.schema.safeParse(props)
  if (!parsed.success) {
    return (
      <div className="render-error" data-slide-ready="error">
        invalid props: {parsed.error.message}
      </div>
    )
  }

  const Component = template.component
  return (
    <div className="render-root" data-slide-ready="true">
      <Component data={parsed.data} />
    </div>
  )
}

function PreviewMode() {
  const packs = useMemo(() => listPacks(), [])
  const initial = readSearch()
  const [packId, setPackId] = useState<string>(
    initial.get('pack') || packs[0]?.id || '',
  )

  const filtered = useMemo(
    () => listTemplates(packId ? { pack: packId } : undefined),
    [packId],
  )

  const [activeId, setActiveId] = useState<string>(
    initial.get('template') || filtered[0]?.id || '',
  )

  useEffect(() => {
    if (!filtered.some((t) => t.id === activeId)) {
      setActiveId(filtered[0]?.id ?? '')
    }
  }, [filtered, activeId])

  useEffect(() => {
    const q = new URLSearchParams()
    if (packId) q.set('pack', packId)
    if (activeId) q.set('template', activeId)
    const next = `${window.location.pathname}?${q.toString()}`
    window.history.replaceState(null, '', next)
  }, [packId, activeId])

  const active = useMemo(
    () => filtered.find((t) => t.id === activeId) ?? filtered[0],
    [filtered, activeId],
  )

  if (!TEMPLATES.length) {
    return (
      <div className="app">
        <p>
          未发现模板。请在 <code>frontend/src/templates/slides/&lt;节目包&gt;/</code>{' '}
          下添加文件并 export const template。
        </p>
      </div>
    )
  }

  if (!active) {
    return (
      <div className="app">
        <p>该节目包下暂无模板。</p>
      </div>
    )
  }

  const Component = active.component
  const activePack = packs.find((p) => p.id === active.pack)

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <p className="app-kicker">G-PPT · Layout Preview</p>
          <h1>版式模板预览</h1>
          <p className="app-desc">
            按节目包分组：<code>frontend/src/templates/slides/&lt;pack&gt;/</code>
            ；包内新增文件并 <code>export const template</code> 即可自动注册。
          </p>
        </div>
        <div className="app-meta">
          <span>{packs.length} packs</span>
          <span>{TEMPLATES.length} templates</span>
          <span>4:3</span>
        </div>
      </header>

      <div className="pack-tabs" role="tablist" aria-label="节目包">
        {packs.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === packId}
            className={p.id === packId ? 'is-active' : undefined}
            onClick={() => setPackId(p.id)}
          >
            <strong>{p.name}</strong>
            <span>{p.id}</span>
          </button>
        ))}
      </div>

      {activePack?.description ? (
        <p className="pack-desc">{activePack.description}</p>
      ) : null}

      <div className="app-layout">
        <aside className="template-list" aria-label="模板列表">
          {filtered.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === active.id ? 'is-active' : undefined}
              onClick={() => setActiveId(t.id)}
            >
              <span className="template-list__type">{t.type}</span>
              <strong>{t.name}</strong>
              <span className="template-list__id">{t.id}</span>
              <span className="template-list__desc">{t.description}</span>
            </button>
          ))}
        </aside>

        <main className="preview-pane">
          <div className="preview-toolbar">
            <div>
              <strong>{active.name}</strong>
              <span>
                {active.pack} / {active.id}
              </span>
            </div>
            <div className="preview-tags">
              {active.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </div>

          <div className="stage-wrap">
            <div className="stage" key={active.id}>
              <Component data={active.demo} />
            </div>
          </div>

          <details className="schema-panel">
            <summary>查看该模板 Demo Props</summary>
            <pre>{JSON.stringify(active.demo, null, 2)}</pre>
          </details>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  const mode = readSearch().get('mode')
  if (mode === 'render') {
    document.documentElement.classList.add('render-mode')
    return <RenderMode />
  }
  document.documentElement.classList.remove('render-mode')
  return <PreviewMode />
}
