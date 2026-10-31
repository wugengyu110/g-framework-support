import { z } from 'zod'
import type { TemplateDefinition } from '../../../registry/types'
import { SlideSection, SlideShell } from '../../shared/SlideShell'

const schema = z.object({
  section: z.string().optional(),
  title: z.string(),
  chart_type: z.enum(['bar', 'line', 'pie']).default('bar'),
  unit: z.string().optional(),
  items: z
    .array(
      z.object({
        label: z.string(),
        value: z.number(),
      }),
    )
    .min(2)
    .max(8),
  note: z.string().optional(),
})

type Props = z.infer<typeof schema>
type Item = Props['items'][number]

const PALETTE = [
  '#0f766e',
  '#0e7490',
  '#0369a1',
  '#4338ca',
  '#a16207',
  '#b45309',
  '#be123c',
  '#047857',
]

function BarChart({ items }: { items: Item[] }) {
  const max = Math.max(...items.map((i) => i.value), 1)
  const w = 640
  const h = 280
  const padL = 36
  const padB = 48
  const padT = 16
  const padR = 16
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const gap = 12
  const barW = (innerW - gap * (items.length - 1)) / items.length

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="slide-chart__svg" role="img">
      <line
        x1={padL}
        y1={padT}
        x2={padL}
        y2={padT + innerH}
        className="slide-chart__axis"
      />
      <line
        x1={padL}
        y1={padT + innerH}
        x2={padL + innerW}
        y2={padT + innerH}
        className="slide-chart__axis"
      />
      {items.map((item, i) => {
        const bh = (item.value / max) * innerH
        const x = padL + i * (barW + gap)
        const y = padT + innerH - bh
        return (
          <g key={`${item.label}-${i}`}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={bh}
              rx={6}
              fill={PALETTE[i % PALETTE.length]}
              opacity={0.9}
            />
            <text
              x={x + barW / 2}
              y={y - 8}
              textAnchor="middle"
              className="slide-chart__value"
            >
              {item.value}
            </text>
            <text
              x={x + barW / 2}
              y={padT + innerH + 28}
              textAnchor="middle"
              className="slide-chart__label"
            >
              {item.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function LineChart({ items }: { items: Item[] }) {
  const max = Math.max(...items.map((i) => i.value), 1)
  const w = 640
  const h = 280
  const padL = 36
  const padB = 48
  const padT = 24
  const padR = 16
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const pts = items.map((item, i) => {
    const x =
      padL + (items.length === 1 ? innerW / 2 : (i / (items.length - 1)) * innerW)
    const y = padT + innerH - (item.value / max) * innerH
    return { x, y, item }
  })
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="slide-chart__svg" role="img">
      <line
        x1={padL}
        y1={padT + innerH}
        x2={padL + innerW}
        y2={padT + innerH}
        className="slide-chart__axis"
      />
      <path d={d} fill="none" stroke="#0f766e" strokeWidth={3.5} />
      {pts.map((p, i) => (
        <g key={`${p.item.label}-${i}`}>
          <circle cx={p.x} cy={p.y} r={7} fill={PALETTE[i % PALETTE.length]} />
          <text
            x={p.x}
            y={p.y - 14}
            textAnchor="middle"
            className="slide-chart__value"
          >
            {p.item.value}
          </text>
          <text
            x={p.x}
            y={padT + innerH + 28}
            textAnchor="middle"
            className="slide-chart__label"
          >
            {p.item.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

function PieChart({ items }: { items: Item[] }) {
  const total = items.reduce((s, i) => s + Math.max(i.value, 0), 0) || 1
  const cx = 200
  const cy = 150
  const r = 110
  let angle = -Math.PI / 2
  const slices = items.map((item, i) => {
    const sweep = (Math.max(item.value, 0) / total) * Math.PI * 2
    const start = angle
    angle += sweep
    const x1 = cx + r * Math.cos(start)
    const y1 = cy + r * Math.sin(start)
    const x2 = cx + r * Math.cos(angle)
    const y2 = cy + r * Math.sin(angle)
    const large = sweep > Math.PI ? 1 : 0
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
    return { d, item, i, color: PALETTE[i % PALETTE.length] }
  })

  return (
    <svg viewBox="0 0 640 300" className="slide-chart__svg" role="img">
      {slices.map((s) => (
        <path key={`${s.item.label}-${s.i}`} d={s.d} fill={s.color} opacity={0.92} />
      ))}
      <g transform="translate(360, 40)">
        {items.map((item, i) => (
          <g key={`${item.label}-${i}`} transform={`translate(0, ${i * 32})`}>
            <rect width={16} height={16} rx={3} fill={PALETTE[i % PALETTE.length]} />
            <text x={28} y={13} className="slide-chart__legend">
              {item.label} · {item.value}
            </text>
          </g>
        ))}
      </g>
    </svg>
  )
}

function ChartSlide({ data }: { data: Props }) {
  const chart =
    data.chart_type === 'line' ? (
      <LineChart items={data.items} />
    ) : data.chart_type === 'pie' ? (
      <PieChart items={data.items} />
    ) : (
      <BarChart items={data.items} />
    )

  return (
    <SlideShell>
      <div className="slide-body slide-body--chart">
        {data.section ? <SlideSection>{data.section}</SlideSection> : null}
        <h2 className="slide-h2">
          {data.title}
          {data.unit ? <span className="slide-chart__unit">（{data.unit}）</span> : null}
        </h2>
        <div className="slide-chart">{chart}</div>
        {data.note ? <p className="slide-chart__note">{data.note}</p> : null}
      </div>
    </SlideShell>
  )
}

export const template = {
  id: 'chart_simple_v1',
  type: 'chart',
  name: '简易图表',
  description:
    '图表函数：title + chart_type(bar|line|pie) + items[{label,value}][2–8]；条数/类型按数据自选，数值须真实。demo 三项勿照抄',
  tags: ['图表', '数据', '柱状', '折线', '饼图'],
  when: '可比数字/占比/趋势；无真实数字则改 bullets',
  roles: ['chart'],
  order: 55,
  schema,
  component: ChartSlide,
  demo: {
    section: '效果对比',
    title: '三种路径的完播率',
    chart_type: 'bar',
    unit: '%',
    items: [
      { label: '纯口播', value: 32 },
      { label: '要点卡', value: 51 },
      { label: '图+代码', value: 68 },
    ],
    note: '有画面结构时，听众更容易跟完。',
  },
} satisfies TemplateDefinition<Props>
