# GPT-SoVITS 音色目录（g_media 用）

每个音色需要：

| 文件 | 说明 |
|------|------|
| `{id}.wav` | 参考音频（建议干净口播 5–15 秒，单声道亦可） |
| `catalog.json` | 登记 `id` / `name` / `ref_audio` / `prompt_text` / 语言 |

`prompt_text` 必须与参考音频内容一致。也可只放 `{id}.wav` + `{id}.txt`（txt 为参考文本），shim 会自动发现。

容器内路径：`/workspace/GPT-SoVITS/voices/`。
