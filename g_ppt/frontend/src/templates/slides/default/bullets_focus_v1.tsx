import { z } from 'zod'
import type { TemplateDefinition } from '../../../registry/types'
import { SlideSection, SlideShell } from '../../shared/SlideShell'

const schema = z.object({
  section: z.string().optional(),
  title: z.string(),
  bullets: z.array(z.string()).min(1).max(6),
})

type Props = z.infer<typeof schema>

function BulletsSlide({ data }: { data: Props }) {
  return (
    <SlideShell>
      <div className="slide-body">
        {data.section ? <SlideSection>{data.section}</SlideSection> : null}
        <h2 className="slide-h2">{data.title}</h2>
        <ul className="slide-bullets">
          {data.bullets.map((item, i) => (
            <li key={item} style={{ animationDelay: `${120 + i * 80}ms` }}>
              <span className="slide-bullets__index">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </SlideShell>
  )
}

export const template = {
  id: 'bullets_focus_v1',
  type: 'bullets',
  name: '要点列表',
  description:
    '要点函数：title + bullets[1–6]，条数与文案按段自拟可增减；适合概念讲解。demo 列表勿照抄',
  tags: ['要点', '列表', '概念'],
  when: '概念/要点/示例',
  roles: ['concept', 'example', 'summary'],
  order: 20,
  schema,
  component: BulletsSlide,
  demo: {
    section: '核心概念',
    title: '为什么不堆「很多 PPT 皮肤」',
    bullets: [
      '模板增长单位是「版式 + Schema」，不是 pptx 文件',
      'Agent 只能稳定调用带强类型槽位的组件',
      '同一套 props 可同时渲视频与课件',
      '按内容类型路由，比按「好看」选模板更可靠',
    ],
  },
} satisfies TemplateDefinition<Props>
