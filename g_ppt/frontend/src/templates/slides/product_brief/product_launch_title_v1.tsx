import { z } from 'zod'
import type { TemplateDefinition } from '../../../registry/types'
import { SlideShell } from '../../shared/SlideShell'

const schema = z.object({
  eyebrow: z.string().optional(),
  title: z.string(),
  highlight: z.string().optional(),
  footer: z.string().optional(),
})

type Props = z.infer<typeof schema>

function LaunchTitleSlide({ data }: { data: Props }) {
  return (
    <SlideShell variant="hero">
      <div className="slide-title">
        {data.eyebrow ? (
          <span className="slide-badge">{data.eyebrow}</span>
        ) : null}
        <h1 className="slide-title__h1">{data.title}</h1>
        {data.highlight ? (
          <p className="slide-title__sub">{data.highlight}</p>
        ) : null}
        {data.footer ? (
          <p className="slide-title__meta">{data.footer}</p>
        ) : null}
      </div>
    </SlideShell>
  )
}

export const template = {
  id: 'product_launch_title_v1',
  type: 'title',
  name: '发布会开场',
  description:
    '发布会封面函数：title 必填，eyebrow/highlight/footer 按片自拟。demo 文案勿照抄',
  tags: ['发布会', '产品', '开场'],
  when: '文首大标题 / 收束封面',
  roles: ['hook', 'open', 'close'],
  order: 10,
  schema,
  component: LaunchTitleSlide,
  demo: {
    eyebrow: 'Product Launch',
    title: '下一版，为讲解而生',
    highlight: '同一套内容，按节目切换模板组与主题',
    footer: 'G-PPT · product_brief',
  },
} satisfies TemplateDefinition<Props>
