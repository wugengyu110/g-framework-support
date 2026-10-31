import katex from 'katex'
import 'katex/dist/katex.min.css'
import { z } from 'zod'
import type { TemplateDefinition } from '../../../registry/types'
import { SlideSection, SlideShell } from '../../shared/SlideShell'

const schema = z.object({
  section: z.string().optional(),
  title: z.string(),
  /** 主公式 LaTeX 正文；勿包 $$ / \\[ \\]；多行推导用 aligned */
  formula: z.string().min(1),
  note: z.string().optional(),
})

type Props = z.infer<typeof schema>

/** 去掉 LLM 常包的定界符，交给 KaTeX displayMode */
function normalizeLatex(raw: string): string {
  let s = raw.trim()
  if (
    (s.startsWith('$$') && s.endsWith('$$')) ||
    (s.startsWith('\\[') && s.endsWith('\\]'))
  ) {
    s = s.slice(2, -2).trim()
  } else if (
    (s.startsWith('$') && s.endsWith('$') && !s.slice(1, -1).includes('$')) ||
    (s.startsWith('\\(') && s.endsWith('\\)'))
  ) {
    s = s.startsWith('$') ? s.slice(1, -1).trim() : s.slice(2, -2).trim()
  }
  if (s.endsWith('\\') && !s.endsWith('\\\\')) {
    s = s.slice(0, -1).trimEnd()
  }
  return s
}

function renderFormula(latex: string): string {
  return katex.renderToString(normalizeLatex(latex), {
    throwOnError: false,
    displayMode: true,
    strict: 'ignore',
    output: 'html',
  })
}

function MathFormulaSlide({ data }: { data: Props }) {
  const html = renderFormula(data.formula)
  return (
    <SlideShell>
      <div className="slide-body slide-body--math">
        {data.section ? <SlideSection>{data.section}</SlideSection> : null}
        <h2 className="slide-h2">{data.title}</h2>
        <div className="slide-math">
          <div
            className="slide-math__formula"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
        {data.note ? <p className="slide-math__note">{data.note}</p> : null}
      </div>
    </SlideShell>
  )
}

export const template = {
  id: 'math_formula_v1',
  type: 'math',
  name: '数学公式',
  description:
    '公式函数：title + formula（LaTeX 正文，勿包 $$）+ note（白话含义，配合文字，勿让公式独占整页）；多行推导用 \\begin{aligned}；内容须来自口播/文档，demo 勿照抄',
  tags: ['公式', '数学', 'LaTeX', '定理', '方程'],
  when:
    '公式/方程/定理（$...$ / $$...$$ / \\[ \\] / 【公式n】）。公式必须上画面、与讲解同屏；即使 role 不是 math 也优先本 type。无 LaTeX 则改 bullets。不要让公式独占整页。',
  roles: ['math'],
  order: 55,
  schema,
  component: MathFormulaSlide,
  demo: {
    section: '基础关系',
    title: '质能等价',
    formula: 'E = mc^{2}',
    note: '静止质量与能量的正比关系；c 为真空光速。',
  },
} satisfies TemplateDefinition<Props>
