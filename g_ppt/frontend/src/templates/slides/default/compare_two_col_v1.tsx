import { z } from 'zod'
import type { TemplateDefinition } from '../../../registry/types'
import { SlideSection, SlideShell } from '../../shared/SlideShell'

const schema = z.object({
  section: z.string().optional(),
  title: z.string(),
  left: z.object({
    label: z.string(),
    bullets: z.array(z.string()).min(1).max(4),
  }),
  right: z.object({
    label: z.string(),
    bullets: z.array(z.string()).min(1).max(4),
  }),
})

type Props = z.infer<typeof schema>

function CompareSlide({ data }: { data: Props }) {
  return (
    <SlideShell>
      <div className="slide-body">
        {data.section ? <SlideSection>{data.section}</SlideSection> : null}
        <h2 className="slide-h2">{data.title}</h2>
        <div className="slide-compare">
          <div className="slide-compare__col slide-compare__col--left">
            <h3>{data.left.label}</h3>
            <ul>
              {data.left.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
          <div className="slide-compare__vs" aria-hidden>
            VS
          </div>
          <div className="slide-compare__col slide-compare__col--right">
            <h3>{data.right.label}</h3>
            <ul>
              {data.right.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </SlideShell>
  )
}

export const template = {
  id: 'compare_two_col_v1',
  type: 'compare',
  name: '双栏对比',
  description:
    '对照函数：title + left/right（各含 label + bullets[1–4]），两侧必须齐全且按段重写；条数可各不同。demo 勿照抄',
  tags: ['对比', 'vs', '差异'],
  when: '两边对照（A vs B、优缺点）',
  roles: ['compare'],
  order: 30,
  schema,
  component: CompareSlide,
  demo: {
    section: '方案对比',
    title: '同步请求 vs 异步消息',
    left: {
      label: '同步',
      bullets: [
        '调用方等待结果返回',
        '链路简单，易调试',
        '高峰时容易互相拖垮',
      ],
    },
    right: {
      label: '异步',
      bullets: [
        '发送后继续处理',
        '削峰填谷，扩展性更好',
        '需要补偿与可观测性',
      ],
    },
  },
} satisfies TemplateDefinition<Props>
