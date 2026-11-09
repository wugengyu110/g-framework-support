# g-framework-supports

g-framework 外围支撑服务编排仓：Docker Compose、薄适配 shim、业务侧小配置。

**只版本化「怎么启动 / 怎么适配」**；模型权重、合成产物、参考音色 wav、上传素材等资料类文件不入仓。

## 目录

| 路径 | 说明 |
|------|------|
| `docker-compose.yml` | 根编排（`include` 各子服务） |
| `egress-proxy/` | 出站代理（v2rayA：粘贴订阅、点选节点；供 g-framework `PROXY_HOST=egress-proxy`） |
| `alist/` | Alist WebDAV（同机 `g-support-net`，`http://alist:5244/dav/`；不暴露公网；见 `alist/README.md`） |
| `g_ppt/` | PPT 渲染服务（原独立仓迁入） |
| `indextts2/` | IndexTTS2 compose + g_media 兼容 shim |
| `gpt-sovits/` | 仅 compose + shim + voices 目录说明（上游源码/权重本地自备） |
| `cosyvoice/` | CosyVoice compose + 薄服务代码 |
| `vllm/` | 仅 ollama / vllm compose |

## 前置

```bash
docker network create g-support-net   # 已有可跳过
```

## 启动

```bash
# 全部（根 compose 已 include 的服务）
docker compose up -d

# 按服务
docker compose up -d egress-proxy   # 可选：网页配置代理，见 egress-proxy/README.md
docker compose up -d alist          # 可选：同机 WebDAV + 阿里云盘 Open（勿公网暴露），见 alist/README.md
docker compose up -d g-ppt
docker compose up -d indextts2
docker compose up -d cosyvoice
```

各子目录 README 有端口与联调说明。

## 本地资料（不入 Git）

按需自行放置，例如：

- `indextts2/voices/*.wav` + 已提交的 `catalog.json`
- `gpt-sovits/` 上游代码与权重（compose/shim 已入仓）
- `vllm/vllm_models/`、`vllm/local_ollama/`
- `g_ppt/assets/` 上传/演示素材

## 远程

```text
git@gitee.com:wugengyu/g-framework-supports.git
```
