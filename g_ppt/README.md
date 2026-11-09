# G-PPT

Node API（Hono）+ 前端预览 + 渲染引擎，Docker 一键跑。Python 只做薄客户端。目标：Agent 选模板 → 填 props → 出视频。

## 目录

```
g_ppt/
  frontend/       # Vite UI、模板、Node 依赖（含 Hono）
  server/         # Hono API（由 frontend scripts 通过 vite-node 启动）
  tools/          # 渲染引擎 + CLI + catalog/openapi 导出
  sdk/python/     # import g_ppt → HTTP
  catalog/        # 生成物：catalog.json / openapi.json
  docs/ examples/
```

依赖与 npm scripts 在 `frontend/`；根 `package.json` 只做转发。`server/`、`tools/` 不单独装包。

## 启动

```bash
./bootstrap.sh              # 首次：install + playwright chromium + build
# 或
npm install && npm run build

npm run api                 # http://127.0.0.1:18800/
# 或
docker compose up --build
```

| 地址 | 用途 |
|------|------|
| http://localhost:18800/ | 预览 UI |
| http://localhost:18800/docs | Swagger UI（可试接口） |
| http://localhost:18800/openapi.json | OpenAPI 规范 |
| http://localhost:18800/api/health | 健康检查 |
| http://localhost:18800/api/templates | 模板列表（含 schema / demo / inputs / when / roles） |
| http://localhost:18800/api/templates/:id/schema | 单模板完整契约 |
| http://localhost:18800/api/layout-rules | 选版规则（type.when / roles / 形状 / role→type；prompt.* 可注入 LLM） |
| POST /api/assets | 上传图片/mp4/音频/srt（multipart `file`） |
| GET /media/:id | 已上传媒体 |
| POST /api/audio/concat | 短语音拼接（工具） |
| POST /api/render/slide | 渲 PNG/MP4 |
| POST /api/render/show | 同步时间轴成片（可旁白/字幕/BGM/`keep_video_audio`） |
| POST /api/render/mindmap | 思维导图画布按时间轴出 mp4 / 静帧 |
| POST /api/jobs/render-show | 异步提交成片（立刻返回 job_id） |
| POST /api/jobs/render-mindmap | 异步提交导图成片 |
| GET /api/jobs/:id | 查询异步任务状态 |

```bash
curl -s http://127.0.0.1:18800/api/templates | head
curl -s http://127.0.0.1:18800/api/layout-rules
curl -s http://127.0.0.1:18800/api/templates/compare_two_col_v1/schema
curl -s -X POST http://127.0.0.1:18800/api/render/slide \
  -H 'content-type: application/json' \
  -d '{"template_id":"compare_two_col_v1","format":"png"}'
```

## Agent 契约

每个模板自动带齐：

| 字段 | 含义 |
|------|------|
| `schema` | JSON Schema（由 Zod 导出） |
| `demo` | 合法示例 props（few-shot） |
| `inputs` | 字段摘要：必填/类型/`minItems`/`maxItems` |

新增模板：在 `frontend/src/templates/slides/<pack>/` 下加 `xxx.tsx`，导出：

```ts
export const template = {
  id: '...',
  type: '...',          // 新 type 直接写新名即可
  name: '...',
  description: '...',   // 何时选这一款模板
  when: '...',          // 选版：何时用这个 type（media 提示词自动注入）
  roles: ['...'],       // 哪些口播 role 优先用这个 type；默认 role=type 名
  tags: [],
  schema,   // z.object({...}) 必填
  component,
  demo,     // 合法示例，必填
}
```

无需手写 catalog：API 启动与 `/api/templates`（默认 refresh）会从 registry 重建 `catalog/catalog.json`。**新增 `.tsx` 后需重启 API 进程**（`import.meta.glob` 在启动时加载）。选版规则只维护在模板 `when` / `roles`，由 `GET /api/layout-rules` 聚合；media / skill **只拉接口，勿手写 type 清单**。

## Python 客户端

```bash
export G_PPT_API_URL=http://127.0.0.1:18800
pip install -e ./sdk/python
```

```python
import g_ppt
g_ppt.list_templates()                      # 含 schema/demo/inputs
g_ppt.get_template_schema("bullets_focus_v1")
g_ppt.render_slide("bullets_focus_v1", {"title": "Hi", "bullets": ["a", "b"]}, format="mp4", out="out.mp4")

photo = g_ppt.upload_asset("photo.png")     # → asset:<id>
clip = g_ppt.upload_asset("demo.mp4")
narr = g_ppt.upload_asset("page1.mp3")      # 分段旁白
g_ppt.render_show([
    {
        "template_id": "title_mark_split_v1",
        "audio_src": narr["src"],           # 画面时长跟旁白
        "cues": [{"start": 0, "end": 2.5, "text": "开场"}],
        "props": {
            "badge": "Demo",
            "title": "Hi",
            "subtitle": "with narration",
            "meta": "sdk",
        },
    },
    {"kind": "image", "src": photo["src"], "duration_sec": 3},
    # 同页多图：{"kind": "image", "srcs": [photo["src"], photo2["src"]], "duration_sec": 4}
    {"kind": "video", "src": clip["src"], "trim_end_sec": 8},
], out="show.mp4", presenter={"src": "presenter/talking.mp4"})  # 可选：右下角圆形解说头像（封面页不叠）

# 思维导图播放：本地时间轴 JSON（canvas 路径相对该文件）
g_ppt.render_mindmap("书名/播放/第03章.json", vault=".", out="chapter.mp4")
# g_ppt.render_mindmap("书名/播放/第03章.json", stills=[0, 2.8])

# 长任务：异步提交 + 轮询（不断线）
job = g_ppt.submit_render_show([...], presenter={"src": "presenter/talking.mp4"})
done = g_ppt.wait_job(job["job_id"], out="show.mp4", timeout_sec=3600)

# 工具：短语音拼长轨（非成片主路径）
# g_ppt.concat_audio([a["src"], b["src"]])
```

Node 侧直接调 HTTP，或用 `npm run g-ppt` CLI。详见 [docs/integration.md](docs/integration.md)。
