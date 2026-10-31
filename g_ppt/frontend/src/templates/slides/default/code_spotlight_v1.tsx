import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { z } from 'zod'
import type { TemplateDefinition } from '../../../registry/types'
import { SlideSection, SlideShell } from '../../shared/SlideShell'

hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('java', java)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
}

const schema = z.object({
  section: z.string().optional(),
  title: z.string(),
  language: z.string().default('typescript'),
  code: z.string(),
  note: z.string().optional(),
})

type Props = z.infer<typeof schema>

function resolveLanguage(raw: string): string {
  const key = raw.trim().toLowerCase()
  return LANG_ALIASES[key] || key
}

function highlightCode(code: string, language: string): { html: string; lang: string } {
  const lang = resolveLanguage(language)
  if (hljs.getLanguage(lang)) {
    return { html: hljs.highlight(code, { language: lang }).value, lang }
  }
  return { html: hljs.highlightAuto(code).value, lang: language || 'text' }
}

function CodeSlide({ data }: { data: Props }) {
  const { html, lang } = highlightCode(data.code, data.language)
  return (
    <SlideShell variant="code">
      <div className="slide-body slide-body--code">
        {data.section ? <SlideSection>{data.section}</SlideSection> : null}
        <h2 className="slide-h2">{data.title}</h2>
        <div className="slide-code">
          <div className="slide-code__bar">
            <span className="slide-code__dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className="slide-code__lang">{lang}</span>
          </div>
          <pre>
            <code
              className={`hljs language-${lang}`}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </pre>
        </div>
        {data.note ? <p className="slide-code__note">{data.note}</p> : null}
      </div>
    </SlideShell>
  )
}

export const template = {
  id: 'code_spotlight_v1',
  type: 'code',
  name: '代码聚焦',
  description:
    '代码函数：title + language + code（≤20 行可朗读）+ note?；内容须来自口播/文档，demo 示例代码勿照抄；勿贴整文件',
  tags: ['代码', '示例', '技术', '高亮'],
  when: '可演示代码围栏；无代码则改 bullets',
  roles: ['code'],
  order: 50,
  schema,
  component: CodeSlide,
  demo: {
    section: 'Agent Tool',
    title: 'render_slide 的调用形态',
    language: 'typescript',
    code: `await render_slide({
  template_id: "compare_two_col_v1",
  props: {
    title: "同步 vs 异步",
    left:  { label: "同步", bullets: ["阻塞"] },
    right: { label: "异步", bullets: ["不阻塞"] },
  },
})`,
    note: 'Agent 只写 JSON props；组件代码由版式库维护。',
  },
} satisfies TemplateDefinition<Props>
