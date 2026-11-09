# alist（WebDAV → 阿里云盘 Open）

媒体平台需要**可写 WebDAV** 才能把成片导出到网盘。阿里云官方 OpenAPI 产品级 WebDAV（`openapi.alipan.com/dav`）为**只读**；本服务用 [Alist](https://alistgo.com/) 在自建侧提供可写 WebDAV，后端挂载 **阿里云盘 Open** 存储。

## 部署定位（默认）

本仓意图是 **与 g-framework 同机、仅本机/内网**：Alist 容器挂在 `g-support-net`，**不向公网暴露**。媒体（与同机 Docker 栈内的 g-framework）通过 Docker DNS 访问 WebDAV。

| 目标 | 说明 |
|------|------|
| 媒体 `base_url` | `http://alist:5244/dav/`（g-framework 等同网容器访问） |
| 写入契约 | WebDAV 根下相对路径 `媒体平台/<filename>`，会先 `MKCOL 媒体平台` |
| 管理面板 | 仅宿主机本机、`127.0.0.1`、VPN 或 **SSH 隧道**；**禁止**对互联网开放 |
| 凭据 | 面板自设管理员；另建**专用 WebDAV 用户**，勿把密码写入本仓或聊天 |

**不要**为 Alist 配置公网 DNS、TLS 反代或把 5244 映射到公网接口。若将来有人**主动**选择公网暴露，需自行承担风险；那不是本编排的默认目标，下文仅保留一句提醒。

## 前置

```bash
docker network create g-support-net   # 已有可跳过
```

可选：复制环境变量示例

```bash
cp alist/.env.example alist/.env
# 编辑 alist/.env：ALIST_HTTP_PORT、首次启动可选 ALIST_ADMIN_PASSWORD
```

## 启动

在 **support 仓根目录**：

```bash
docker compose up -d alist
```

- **管理面板**（仅本机运维）：`http://127.0.0.1:${ALIST_HTTP_PORT:-5244}` 或 `http://<宿主机内网 IP>:5244`；远程请用 SSH 端口转发，勿把面板暴露到公网。
- **首次登录**：若未在 `.env` 设置 `ALIST_ADMIN_PASSWORD`，执行 `docker compose logs alist` 查看随机管理员密码；登录后请在面板**立即修改**管理员密码。
- 持久化数据目录：`alist/data/`（gitignore，含存储挂载与 WebDAV 配置）

```bash
docker compose logs -f alist
docker compose stop alist
```

## 媒体联调地址

g-framework / 媒体服务与 Alist **同一 Docker 主机**且均接入 `g-support-net` 时：

```text
base_url = http://alist:5244/dav/
```

写入相对于该 WebDAV **根目录**的文件路径为 `媒体平台/<filename>`；`base_url` 末尾建议带 `/`，与媒体侧配置保持一致。

宿主机上调试（非容器内）可用：

```text
http://127.0.0.1:5244/dav/
```

WebDAV 使用 **Basic Auth**；HTTP 方法需包含 `PROPFIND`、`MKCOL`、`PUT`、`DELETE` 等（Alist 默认支持）。

### 可选说明（非本部署）

若有人**刻意**要把 Alist 暴露到公网，须自管 DNS/TLS 与访问控制，并评估面板与令牌泄露风险。**本 support 仓不提供、也不要求** Nginx/Caddy 反代配置。

## 挂载阿里云盘 Open（须人工在面板操作）

1. 浏览器打开管理面板（本机或隧道）→ **存储** → **添加**。
2. 驱动选择 **阿里云盘 Open**（名称以当前 Alist 版本为准）。
3. 按面板指引 **扫码 / OAuth 授权**（必须由账号持有人完成，无法写入 compose）。
4. **挂载路径**建议：`/`（网盘根）或专门目录（例如 `/媒体导出`）；须保证该路径为 **WebDAV 用户可见且可写** 的祖先目录。
5. 媒体合约在 WebDAV 根下创建 `媒体平台/` 时，Open 存储通常挂在 `/`，WebDAV 根即 `http://alist:5244/dav/`。

刷新令牌、驱动故障排查见 Alist 官方文档与面板日志。

## WebDAV 用户与写权限（Alist ≥ v3.42）

1. **管理** → **用户** → 新建用户（建议专用账号，如 `media-webdav`），设置强密码（**勿提交 Git**）。
2. 该用户权限勾选（名称以面板为准）：
   - **WebDAV 读取**（WebDAV Read）
   - **WebDAV 管理**（WebDAV Manage）
   - **创建目录或上传**（Make dir or upload）
3. **设置** → **WebDAV**：
   - 策略推荐 **本机代理**（local proxy）。
   - 对内使用地址：`http://alist:5244/dav/`（容器内）或 `http://127.0.0.1:5244/dav/`（宿主机 curl）。

将 **用户名 + 密码** 通过 g-framework 环境变量/密钥注入媒体配置，不要出现在本仓库。

## 安全获取凭据

| 角色 | 获取方式 |
|------|----------|
| 管理员 | 首次启动 `.env` 的 `ALIST_ADMIN_PASSWORD` 或日志随机密码 → 面板修改 |
| WebDAV | 面板新建专用用户 → 注入同机媒体服务配置 |

禁止在 PR、Issues、聊天中粘贴真实密码或 refresh token。

## 冒烟检查

配置完成后，在 **同机** 上探测（替换用户与密码）。

**优先：与媒体相同的容器网络**（在任意已挂 `g-support-net` 的容器内）：

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -u 'media-webdav:YOUR_PASSWORD' \
  -X PROPFIND \
  -H 'Depth: 0' \
  'http://alist:5244/dav/'
```

**或：宿主机**（compose 已映射端口时）：

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -u 'media-webdav:YOUR_PASSWORD' \
  -X PROPFIND \
  -H 'Depth: 0' \
  'http://127.0.0.1:5244/dav/'
```

期望 HTTP **207** 或 **200**；401 表示可达但凭据错误。

可选：测试建目录权限：

```bash
curl -sS -u 'media-webdav:YOUR_PASSWORD' \
  -X MKCOL \
  'http://127.0.0.1:5244/dav/媒体平台'
```

## 端口

| 变量 | 默认 | 说明 |
|------|------|------|
| `ALIST_HTTP_PORT` | 5244 | 宿主机映射 → 容器 5244（建议仅绑定本机防火墙策略，勿对 0.0.0.0 公网放开） |
| `ALIST_ADMIN_USERNAME` | admin | 仅首次初始化 |
| `ALIST_ADMIN_PASSWORD` | （空） | 仅首次初始化；之后以面板为准 |

## 数据与安全

- `alist/data/` 含数据库、令牌与挂载信息，**勿提交 Git**。
- **默认不对互联网提供服务**；管理面板与 WebDAV 仅服务同机 g-framework 栈。
- WebDAV 使用独立低权限用户；本部署为容器间 HTTP，不依赖公网 HTTPS。

## 与 g-support-net

容器名 `alist`，加入外部网络 `g-support-net`，与 `egress-proxy`、`indextts2` 及 g-framework 后端等同网互访：`http://alist:5244`。
