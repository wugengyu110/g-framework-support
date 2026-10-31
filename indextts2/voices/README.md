# IndexTTS2 音色目录（g_media 用）

自定义音色放到本目录；内置 `voice_01`…`voice_12` 来自镜像 `/app/examples/`，无需复制。

| 文件 | 说明 |
|------|------|
| `{id}.wav` | 参考音频（建议干净口播 3–10 秒） |
| `catalog.json` | 可选登记 `id` / `name` / `ref_audio` |

也可只放 `{id}.wav`，shim 会按文件名自动发现。

容器内路径：`/app/voices/`。经 `g_framework_tts_shim.py` 暴露为 `GET /v1/voices/custom`。
