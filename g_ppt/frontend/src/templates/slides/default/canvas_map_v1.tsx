import { z } from 'zod'
import type { TemplateDefinition } from '../../../registry/types'
import { SlideSection, SlideShell } from '../../shared/SlideShell'

const schema = z.object({
  section: z.string().optional(),
  title: z.string(),
  nodes: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        note: z.string().optional(),
      }),
    )
    .min(2)
    .max(8),
  edges: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
      }),
    )
    .max(12)
    .optional()
    .default([]),
  note: z.string().optional(),
})

type Props = z.infer<typeof schema>
type Node = Props['nodes'][number]

const CARD_W = 148
const CARD_H = 78
const VIEW_W = 920
const VIEW_H = 420

type Point = { x: number; y: number }

/** 圆形自动排布，类似 Obsidian Canvas 的空间感；LLM 无需给坐标 */
function layoutNodes(nodes: Node[]): Map<string, Point> {
  const map = new Map<string, Point>()
  const n = nodes.length
  const cx = VIEW_W / 2
  const cy = VIEW_H / 2 + 8
  if (n === 1) {
    map.set(nodes[0].id, { x: cx, y: cy })
    return map
  }
  const rx = Math.min(VIEW_W * 0.34, 280)
  const ry = Math.min(VIEW_H * 0.32, 140)
  nodes.forEach((node, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    map.set(node.id, { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) })
  })
  return map
}

function edgePath(from: Point, to: Point): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  // 从卡片边缘出发，避免线穿进卡片中心
  const shrink = Math.min(CARD_W, CARD_H) * 0.42
  const x1 = from.x + (dx / len) * shrink
  const y1 = from.y + (dy / len) * shrink
  const x2 = to.x - (dx / len) * shrink
  const y2 = to.y - (dy / len) * shrink
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const ox = (-(y2 - y1) / len) * 18
  const oy = ((x2 - x1) / len) * 18
  return `M ${x1} ${y1} Q ${mx + ox} ${my + oy} ${x2} ${y2}`
}

function CanvasSlide({ data }: { data: Props }) {
  const positions = layoutNodes(data.nodes)
  const edges = data.edges ?? []

  return (
    <SlideShell>
      <div className="slide-body slide-body--canvas">
        {data.section ? <SlideSection>{data.section}</SlideSection> : null}
        <h2 className="slide-h2">{data.title}</h2>
        <div className="slide-canvas">
          <div className="slide-canvas__grid" aria-hidden />
          <svg
            className="slide-canvas__edges"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <marker
                id="canvas-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="6"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L6,3 L0,6 Z" className="slide-canvas__arrow" />
              </marker>
            </defs>
            {edges.map((edge, i) => {
              const a = positions.get(edge.from)
              const b = positions.get(edge.to)
              if (!a || !b) return null
              const d = edgePath(a, b)
              const mid = {
                x: (a.x + b.x) / 2,
                y: (a.y + b.y) / 2 - 10,
              }
              return (
                <g key={`${edge.from}-${edge.to}-${i}`}>
                  <path
                    d={d}
                    className="slide-canvas__edge"
                    markerEnd="url(#canvas-arrow)"
                  />
                  {edge.label ? (
                    <text
                      x={mid.x}
                      y={mid.y}
                      textAnchor="middle"
                      className="slide-canvas__edge-label"
                    >
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </svg>
          {data.nodes.map((node, i) => {
            const p = positions.get(node.id)
            if (!p) return null
            return (
              <article
                key={node.id}
                className="slide-canvas__card"
                style={{
                  left: `calc(${(p.x / VIEW_W) * 100}% - ${CARD_W / 2}px)`,
                  top: `calc(${(p.y / VIEW_H) * 100}% - ${CARD_H / 2}px)`,
                  width: CARD_W,
                  animationDelay: `${80 + i * 70}ms`,
                }}
              >
                <h3>{node.label}</h3>
                {node.note ? <p>{node.note}</p> : null}
              </article>
            )
          })}
        </div>
        {data.note ? <p className="slide-canvas__note">{data.note}</p> : null}
      </div>
    </SlideShell>
  )
}

export const template = {
  id: 'canvas_map_v1',
  type: 'canvas',
  name: '画布关系图',
  description:
    '画布函数：title + nodes[{id,label,note?}][2–8] + edges[{from,to,label?}][≤12]；节点/连线按段增减自拟，demo 勿照抄。线性步骤用 process',
  tags: ['画布', '关系', '节点', '连线', 'Canvas'],
  when: '概念/模块关系网（非线性步骤）；线性步骤仍用 process',
  roles: ['canvas'],
  order: 56,
  schema,
  component: CanvasSlide,
  demo: {
    section: '知识结构',
    title: '口播成片怎么拼起来',
    nodes: [
      { id: 'doc', label: '文档', note: '信息源' },
      { id: 'script', label: '口播段', note: 'role + narration' },
      { id: 'surface', label: '展示面', note: '模板 props' },
      { id: 'tts', label: 'TTS', note: '音色' },
      { id: 'video', label: '成片', note: 'ffmpeg' },
    ],
    edges: [
      { from: 'doc', to: 'script', label: '提炼' },
      { from: 'script', to: 'surface', label: '选版' },
      { from: 'script', to: 'tts' },
      { from: 'surface', to: 'video' },
      { from: 'tts', to: 'video', label: '合成' },
    ],
    note: '先定文案节拍，再铺关系与画面。',
  },
} satisfies TemplateDefinition<Props>
