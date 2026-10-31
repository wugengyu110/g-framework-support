import { z } from 'zod'
import type { TemplateDefinition } from '../../../registry/types'
import { SlideSection, SlideShell } from '../../shared/SlideShell'

const schema = z.object({
  section: z.string().optional(),
  title: z.string(),
  steps: z
    .array(
      z.object({
        title: z.string(),
        desc: z.string(),
      }),
    )
    .min(2)
    .max(5),
})

type Props = z.infer<typeof schema>

function ProcessSlide({ data }: { data: Props }) {
  return (
    <SlideShell>
      <div className="slide-body">
        {data.section ? <SlideSection>{data.section}</SlideSection> : null}
        <h2 className="slide-h2">{data.title}</h2>
        <ol className="slide-process">
          {data.steps.map((step, i) => (
            <li
              key={step.title}
              style={{ animationDelay: `${100 + i * 90}ms` }}
            >
              <span className="slide-process__num">{i + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </SlideShell>
  )
}

export const template = {
  id: 'process_steps_v1',
  type: 'process',
  name: '步骤流程',
  description:
    '流程函数：title + steps[{title,desc}][2–5]，步数与文案按段自拟可增减。demo 步骤勿照抄',
  tags: ['流程', '步骤', '方法'],
  when: '线性步骤（1. 2. 3.）',
  roles: ['steps'],
  order: 40,
  schema,
  component: ProcessSlide,
  demo: {
    section: '生产流水线',
    title: '一节课如何自动生成',
    steps: [
      { title: '结构化讲稿', desc: '切成 scene：类型 + 意图 + 旁白' },
      { title: '路由版式', desc: '按 type 从 Registry 选模板' },
      { title: '填槽校验', desc: '按 Zod Schema 生成 props' },
      { title: '渲染出片', desc: 'Playwright 截图 / ffmpeg 合成' },
    ],
  },
} satisfies TemplateDefinition<Props>
