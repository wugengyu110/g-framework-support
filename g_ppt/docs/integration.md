# 集成说明

## 架构

```
业务 / Agent / LangChain
    sdk/python (HTTP)
         ▼
Node Hono :18800
    ├─ /              frontend/dist 预览
    ├─ /docs          Swagger UI（读 catalog/openapi.json）
    ├─ /openapi.json  OpenAPI 3.1（`npm run catalog` 用 zod-openapi 预生成）
    ├─ /api/templates 列表（schema + demo + inputs + when/roles）
    ├─ /api/layout-rules 选版规则（type 聚合 + prompt 文本）
    ├─ /api/assets    上传图片 / mp4 / 音频 / srt → asset:<id>
    ├─ /api/audio/concat  短语音拼接（工具，非成片主路径）
    ├─ /api/audio/tempo   整段音频 atempo 变速（口播语速用此，勿用 TTS speed）
    ├─ /api/jobs/*    异步成片（提交 + 轮询）
    ├─ /media/:id     已上传媒体
    ├─ /api/render/*  渲 PNG / 同步时间轴合成 MP4 / 思维导图播放
    └─ tools/engine   Playwright + ffmpeg
         tools/mindmap-video.ts  Obsidian canvas 镜头成片
```

无 FastAPI：渲染与 API 同为 Node。人调试用 `/docs`，Agent 读 `/api/layout-rules`、`/api/templates` 或 `/openapi.json`。

## Agent 用法（推荐）

1. `GET /api/layout-rules` → 看 `prompt.type_rules` / `role_map` / `types[].when` 选 type  
2. `GET /api/templates` → 看 `description` / `inputs` / `demo` 选具体版式  
3. 按 `schema`（或照抄 `demo` 改字段）填 `props`  
4. TTS 出分段旁白 → `POST /api/assets` 上传音频；按音频时间轴出字幕 cue  
5. 需要图/视频时同样 `POST /api/assets` → 拿 `src`（`asset:<id>`）  
6. **长成片**：`POST /api/jobs/render-show` → 轮询 `GET /api/jobs/:id` 至 `done`；短任务可仍用同步 `POST /api/render/show`  

模板字段约定**只**维护在各 slide 的 `schema` / `demo` / `when` / `roles`。选版规则由 `GET /api/layout-rules`（或 `g_ppt.get_layout_rules()`）聚合。业务把返回值原样交给 AI，勿在 media / skill 另维护 type 清单。

### 异步任务

| 接口 | 说明 |
|------|------|
| `POST /api/jobs/render-show` | 请求体同同步 show，立刻返回 `{ job_id, status: "queued" }` |
| `POST /api/render/mindmap` | Obsidian `canvas` + `shots` 时间轴，同步出 mp4；`stills` 只出静帧 |
| `POST /api/jobs/render-mindmap` | 请求体同同步 mindmap，立刻返回 `job_id` |
| `GET /api/jobs/:id` | `queued` / `running` / `done` / `error`；`done` 时含 `result.path` 等 |

状态落在 `jobs/<id>.json`；worker 与 API 同进程，并发受 `G_PPT_CONCURRENCY` 约束。进程重启时 `running` 标为 error，`queued` 会重新入队。

Python：

```python
job = g_ppt.submit_render_show(scenes, burn_in=False)
done = g_ppt.wait_job(job["job_id"], poll_sec=2, timeout_sec=3600, out="show.mp4")
```

### Show 时间轴 scene 类型

| kind | 字段 | 说明 |
|------|------|------|
| `template`（可省略 kind） | `template_id`, `props`, `duration_sec?`, `audio_src?`, `cues?` | 默认截图静帧；模板标 `live: true` 时按时长录屏保留动效；有旁白则时长跟音频 |
| `image` | `src` 或 `srcs`（≥2）、`duration_sec?`、`fit?`、`audio_src?`、`cues?` | 静图片段；`srcs` 时拼网格同页展示 |
| `video` | `src`, `trim_*?`, `audio_src?`, `cues?` | 真实视频；有 `audio_src` 时时长跟旁白：视频更长则截断，更短则循环再截断 |

Show 级可选：

| 字段 | 说明 |
|------|------|
| `subtitle_src` | 成片绝对时间 SRT（优先于各 scene `cues`） |
| `burn_in` | `true` 硬烧；默认写 sidecar `.srt` 并软挂 `mov_text` |
| `keep_video_audio` | 有 `audio_src` 时是否保留原片音轨并与旁白混音；默认 `false`（旁白替换） |
| `bgm_src` / `bgm_volume` | 成片级循环 BGM；`bgm_volume` 为 0–1，默认 `0.25` |
| `presenter` | 右下角圆形人像画中画：`{ src, size?, margin?, keep_audio? }`；短于主片循环、长于主片裁剪；默认静音；**`type: title` 封面页不显示** |

`src` / `audio_src` / `subtitle_src` / `presenter.src`：`asset:<id>`（推荐）、`assets/` 内相对路径（如 `presenter/talking.mp4`）、或容器内绝对路径。

### Mindmap 成片（`POST /api/jobs/render-mindmap`）

| 字段 | 说明 |
|------|------|
| `canvas` + `shots[]` | Obsidian 画布与时间轴；每镜 `t` / `focus` / `move?` / `padding?` |
| `shots[].duration_sec` | 本镜停留秒数（至下一镜）。media TTS 重定时后写入；**有则按镜重算 `shots.t`**，成片画面时长约为各镜之和 |
| `audio_src` | 整段旁白 `asset:<id>`；混入 AAC，**成片时长以音频为准**（画面不足则循环补齐） |
| `per_shot_narration[]` | 与 media PR #18 对齐：`shot_index?`、`audio_src?`、`duration_sec?`、`text?`。无顶层 `audio_src` 时按镜 `audio_src` concat 再混入；`duration_sec` 可只出现在此数组 |
| `subtitle_src` / `cues` / `bgm_*` | 同 show 级字幕与 BGM |

勿只传重定时 `duration_sec` 仍用旧版 `t` 间距而未传 `audio_src`：旧行为下画面只有约 `last(t)+hold_end` 秒且无音轨。修版服务会按 `duration_sec` 拉长时间轴；旁白需 `audio_src` 或 `per_shot_narration[].audio_src`。

### 音频工具（可选）

`POST /api/audio/concat`：`{ "sources": ["asset:a", "asset:b"] }` → 长音频 `asset:…`。

`POST /api/audio/tempo`：`{ "source": "asset:…", "speed": 1.2 }` → ffmpeg atempo 后的 `asset:…`（0.5–2.0）。  
仅预听/存档用；成片请按段把旁白交给 `render/show`，不要先拼长轨再贴画面。

`inputs` 由 Zod → JSON Schema 自动推导，例如 bullets 会带 `minItems`/`maxItems`，无需手写第二份文档。

## 新增模板

放在 `frontend/src/templates/slides/<packId>/*.tsx`，必须 `export const template`（含 `schema` + `demo`）。新 type 在该文件写 `type` / `when` / `roles` 即可；`GET /api/layout-rules` 会自动聚合。catalog 在 API 启动 / `npm run catalog` / `GET /api/templates`（默认 refresh）时重建。新增 `.tsx` 后需重启 API。

## 环境变量

| 变量 | 说明 |
|------|------|
| `PORT` / `G_PPT_PORT` | 默认 18800 |
| `G_PPT_RENDER_BASE_URL` | 无头截图基址（默认指向本服务） |
| `G_PPT_CONCURRENCY` | 同时渲染任务上限（默认 1；超限排队） |
| `G_PPT_API_URL` | Python SDK 指向的服务地址 |

## 目录约定

| 路径 | 角色 |
|------|------|
| `frontend/` | UI、模板、**唯一** Node 依赖与 scripts |
| `server/` | Hono 入口（`npm run api` → vite-node） |
| `tools/` | Playwright/ffmpeg 引擎、CLI、catalog/openapi 导出、异步 jobs |
| `jobs/` | 异步任务状态（运行时生成，可 gitignore） |
| `catalog/` | 生成物（启动 / `npm run catalog` 重建；可入库作镜像缓存） |
| `sdk/python/` | Agent / 业务侧 HTTP 客户端 |
