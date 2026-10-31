import { z } from 'zod'
import type { TemplateDefinition } from '../../../registry/types'
import { SlideShell } from '../../shared/SlideShell'

const schema = z.object({
  badge: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  meta: z.string().optional(),
  /** public 下动效入口；默认行心身非对称物理态（单层页面，避免嵌套 iframe） */
  mark_src: z.string().optional(),
})

type Props = z.infer<typeof schema>

const DEFAULT_MARK_SRC =
  '/xing-xin-shen-demo.html?state=asymmetric&lineOpacity=1&embed=1'

function TitleMarkSplitSlide({ data }: { data: Props }) {
  const markSrc = data.mark_src?.trim() || DEFAULT_MARK_SRC

  return (
    <SlideShell variant="hero">
      <div className="slide-title-split">
        <div className="slide-title-split__copy">
          {data.badge ? (
            <span className="slide-badge">{data.badge}</span>
          ) : null}
          <h1 className="slide-title__h1">{data.title}</h1>
          {data.subtitle ? (
            <p className="slide-title__sub">{data.subtitle}</p>
          ) : null}
          {data.meta ? (
            <p className="slide-title__meta slide-title-split__meta">
              {data.meta}
            </p>
          ) : null}
        </div>
        <div className="slide-title-split__mark">
          <iframe
            className="slide-title-split__frame"
            src={markSrc}
            title="品牌动效"
            loading="eager"
          />
        </div>
      </div>
    </SlideShell>
  )
}

export const template = {
  id: 'title_mark_split_v1',
  type: 'title',
  name: '封面',
  description:
    '封面函数：badge 用【休心】【休身】或具体主题如【编程】【量化】（认知→休心，健康→休身；技术类勿写【休行】）。title 用文中主标题，各页沿用小节标题。demo 文案勿照抄；右侧品牌动效成片会录屏保留',
  tags: ['封面', '开场', '品牌', '三休', '休心', '休身'],
  when: '文首大标题 / 收束封面',
  roles: ['hook', 'open', 'close'],
  order: 5,
  live: true,
  schema,
  component: TitleMarkSplitSlide,
  demo: {
    badge: '【编程】',
    title: '如何写测试',
    subtitle: '先把可验证的行为说清楚',
    meta: '【编程】',
  },
} satisfies TemplateDefinition<Props>
