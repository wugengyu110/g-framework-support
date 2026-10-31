# IndexTTS2（g-framework-support）

第三方 IndexTTS2 Docker 服务，供 **g_media** 成片 TTS 调用。本目录不改上游模型源码，只做 compose、音色目录与 g_media 兼容 shim。

镜像：`neosun/indextts2:v2.2-performance-optimized`  
框架侧约定见 g-framework：`docs/projects/media/IndexTts2.md`。

## 目录

| 路径 | 说明 |
|------|------|
| `docker-compose.yml` | 服务定义（GPU、端口、挂载、启动命令） |
| `g_framework_tts_shim.py` | 把上游原生 API 适配为 CosyVoice 同形 HTTP，供 `g_media.tts.IndexTts2Client` 使用 |
| `voices/` | 自定义参考音色（见 `voices/README.md`） |
| `outputs/` | 合成/上传产物持久化 |

## 为什么有 shim

上游自带接口是 `POST /tts`、`POST /tts_cached`、`GET /speakers` 等，**没有** g_media 已统一的：

- `GET /health`
- `GET /v1/voices/custom`
- `POST /v1/audio/speech`（`input` + `voice`）

shim 跑在同容器 `:8003`，转发到上游 `:8002`，并聚合内置 `voice_01`…`voice_12`、`voices/` 与缓存 speaker。与 GPT-SoVITS 的 shim 同一思路。

## 启动

需已有网络 `g-support-net`；根目录 `docker-compose.yml` 已 include 本服务。

```bash
docker network create g-support-net   # 已有可跳过
cd /path/to/g-framework-support
docker compose up -d indextts2
```

冷启动约 **2–3 分钟**（加载模型）。上游未就绪时 shim `/health` 返回 `status=starting`（HTTP 200），勿当作永久故障。

默认挂 **GPU 1**（`device_ids: ["1"]`），避免与 GPT-SoVITS/CosyVoice 抢 GPU 0。可按机器改 compose。

## 端口

| 用途 | 容器内 | 宿主机 | 说明 |
|------|--------|--------|------|
| g_media / shim | `8003` | `8190` | `INDEX_TTS2_BASE_URL=http://indextts2:8003` |
| 上游原生 API | `8002` | `8191` | Swagger：`/docs/` |
| Gradio WebUI | `7870` | `7870` | 浏览器试听 |

## 联调

```bash
curl http://127.0.0.1:8190/health
curl http://127.0.0.1:8190/v1/voices/custom
curl -o /tmp/out.wav -X POST http://127.0.0.1:8190/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"input":"你好。","voice":"voice_01"}'
```

media 栈：`TTS_PROVIDER=index_tts2`，跑短 `show_to_video` 确认出 wav。

## 启停

```bash
docker compose up -d indextts2
docker compose stop indextts2
docker compose logs -f indextts2
```
