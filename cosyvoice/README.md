


# media_agent — CosyVoice 与 MCP 部署笔记

本文档整理本项目在 **局域网使用 MCP**、**与 HTTP API 同端口集成**、以及 **FastMCP lifespan** 等问题的结论与操作要点，便于日后查阅。

---

## 1. 背景结论（先读这几条）

| 问题 | 结论 |
|------|------|
| 局域网如何用 MCP？ | 使用 **HTTP（Streamable HTTP / SSE）**，服务监听 **`0.0.0.0`**，客户端用 `http://<宿主机局域网 IP>:<端口>/mcp/`（路径以实际为准）。 |
| MCP 和对外 API 是否同一端口？ | **是（推荐）**：与 **FastAPI（`app.py`）** 同一进程、同一端口（如 `8188`），避免重复加载模型、少开端口。 |
| 镜像默认启动的是 MCP 吗？ | **否**。镜像 CMD 为 **`python app.py`**（Web UI + REST/OpenAI 兼容 API）。仅挂载 `mcp_server.py` 而不挂载/修改 `app.py` 时，**不会**自动启用 MCP。 |

---

## 2. 仓库内相关文件

| 文件 | 作用 |
|------|------|
| `app/app.py` | 主服务：FastAPI + Uvicorn；挂载 MCP 子应用、合并 lifespan、`bind_gpu_manager`。 |
| `app/mcp_server.py` | FastMCP 工具定义；通过 `bind_gpu_manager()` 与 `app.py` **共用同一 GPU/模型**。 |
| `docker-compose.yml` | 映射 `8188`，挂载 `app/app.py` 与 `app/mcp_server.py` 到容器 `/app/`。 |

---

## 3. 集成方式（当前实现）

1. **共用模型**  
   - `mcp_server.py` 内使用 `_gpu()`，在 `app.py` 里 **`bind_gpu_manager(gpu_manager)`**，与 REST API 使用同一个 `GPUManager`，避免双份显存。

2. **同端口挂载**  
   - 创建 **`mcp.http_app(path="/")`**，**`app.mount("/mcp", _mcp_http_app)`**。  
   - 对外示例：`http://<主机>:8188/mcp/`（具体以客户端要求是否带尾部 `/` 为准）。

3. **必须合并 Lifespan（重要）**  
   - FastMCP 的 Streamable HTTP 依赖在 **ASGI lifespan** 里初始化 `StreamableHTTPSessionManager`。  
   - 仅 `mount` 而不把子应用 lifespan 并入根应用时，会出现：  
     `FastMCP's StreamableHTTPSessionManager task group was not initialized`  
   - **做法**：根 `FastAPI` 的 `lifespan` 内使用：  
     `async with _mcp_http_app.lifespan(app):`  
     再执行原有的 `gpu_manager.preload()` 等逻辑。

4. **独立运行 `mcp_server.py`（可选）**  
   - 不设 `PORT` 时可走 **stdio**（本机 Cursor 子进程）。  
   - 设 `PORT` 或 `MCP_HTTP=1` 时走 **HTTP**，便于单独调试；与 `app.py` 集成时以 **`app.py` 为准**。

---

## 4. Docker 与网络

- **端口映射**：`"8188:8188"` 时，宿主机默认在 `0.0.0.0` 监听，局域网可访问 **`http://<宿主机 IP>:8188`**。  
- **勿**写成仅 `127.0.0.1:8188:8188`，否则其他机器无法访问。  
- **防火墙**：若启用 `ufw` 等，需放行对应 TCP 端口。  
- **安全**：局域网暴露即同网段可达；公网勿直接暴露；生产建议加 **认证**（FastMCP 支持 Bearer 等）。

---

## 5. 修改服务后如何生效

```bash
docker compose restart
# 或
docker compose up -d --build
```

确保 `docker-compose.yml` 中已挂载 **`./app/app.py`** 与 **`./app/mcp_server.py`**。

---

## 6. 客户端配置提示

- 远程 MCP URL 示例：`http://<服务器局域网 IP>:8188/mcp/`  
- OpenAPI 文档（若开启）：`http://<IP>:8188/docs`  

---

## 7. 版本与镜像说明

- 运行环境以镜像 **`neosun/cosyvoice:latest`** 为准（Python 依赖、`fastmcp` 行为等）。  
- `app/app.py` 最初从该镜像的 `/app/app.py` 导出后再做 MCP 相关修改；升级镜像时若上游 `app.py` 大变，需自行合并冲突。

---

*文档根据开发与排障过程整理，若行为与新版 FastMCP/镜像不一致，以官方文档与镜像内代码为准。*
