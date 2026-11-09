# alist（WebDAV → 阿里云盘 Open）

媒体平台需要**可写 WebDAV** 才能把成片导出到网盘。阿里云官方 OpenAPI 产品级 WebDAV（`openapi.alipan.com/dav`）为**只读**；本服务用 [Alist](https://alistgo.com/) 在自建侧提供可写 WebDAV，后端挂载 **阿里云盘 Open** 存储。

| 目标 | 说明 |
|------|------|
| 媒体写入契约 | WebDAV 根下相对路径 `媒体平台/<filename>`，会先 `MKCOL 媒体平台` |
| 公网入口 | `https://<公网域名>/dav/`（非仅 localhost），供 jianguan-wan / `media.3gather.com` 等访问 |
| 凭据 | 管理面板自设管理员；另建**专用 WebDAV 用户**，勿把密码写入本仓或聊天 |

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

- 管理面板：`http://<宿主机>:${ALIST_HTTP_PORT:-5244}`（默认 5244）
- **首次登录**：若未在 `.env` 设置 `ALIST_ADMIN_PASSWORD`，执行 `docker compose logs alist` 查看随机管理员密码；登录后请在面板**立即修改**管理员密码。
- 持久化数据目录：`alist/data/`（gitignore，含存储挂载与 WebDAV 配置）

```bash
docker compose logs -f alist
docker compose stop alist
```

## 公网 WebDAV（反向代理 + TLS）

媒体侧 `base_url` 必须指向**可从公网访问**的 WebDAV 根，例如：

```text
https://alist.3gather.com/dav/
```

（占位域名，**需运维自行**解析 DNS、申请证书；勿在未授权环境暴露面板。）

WebDAV 客户端需要 **Basic Auth**，且 HTTP 方法至少包含：`PROPFIND`、`MKCOL`、`PUT`、`DELETE`（以及常见的 `GET`、`HEAD`、`MOVE` 等）。反代勿屏蔽这些方法。

### Nginx 示意

```nginx
server {
    listen 443 ssl http2;
    server_name alist.3gather.com;   # 换成你的域名

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    # 管理面板（建议仅内网/VPN，或强认证）
    location / {
        proxy_pass http://127.0.0.1:5244;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

若希望**仅暴露 WebDAV**、不暴露整站面板，可为 `/dav/` 单独 `location` 指到同一上游（Alist 自带 `/dav/` 路径）。

### Caddy 示意

```caddy
alist.3gather.com {
    reverse_proxy 127.0.0.1:5244
}
```

宿主机端口与 compose 中 `ALIST_HTTP_PORT` 一致时使用 `127.0.0.1:5244`。

同网 Docker 栈内其它容器可通过服务名访问：`http://alist:5244`（不经公网，一般不作为媒体 `base_url`）。

## 挂载阿里云盘 Open（须人工在面板操作）

1. 浏览器打开管理面板 → **存储** → **添加**。
2. 驱动选择 **阿里云盘 Open**（名称以当前 Alist 版本为准，原为「阿里云盘 Open」）。
3. 按面板指引 **扫码 / OAuth 授权**（必须由账号持有人完成，无法写入 compose）。
4. **挂载路径**建议：`/`（网盘根）或专门目录（例如 `/媒体导出`）；须保证该路径为 **WebDAV 用户可见且可写** 的祖先目录。
5. 若媒体合约在 WebDAV 根下创建 `媒体平台/`，则 Open 存储应挂在 WebDAV 根所能写到的位置（常见为 Open 挂 `/`，WebDAV 根即 `https://<domain>/dav/`）。

刷新令牌、驱动故障排查见 Alist 官方文档与面板日志。

## WebDAV 用户与写权限（Alist ≥ v3.42）

官方 Open WebDAV 只读时，本方案依赖 Alist 本地 WebDAV + Open 存储实现写入。

1. **管理** → **用户** → 新建用户（建议专用账号，如 `media-webdav`），设置强密码（**勿提交 Git**）。
2. 该用户权限勾选（名称以面板为准）：
   - **WebDAV 读取**（WebDAV Read）
   - **WebDAV 管理**（WebDAV Manage）
   - **创建目录或上传**（Make dir or upload）
3. **设置** → **WebDAV**：
   - 策略推荐 **本机代理**（local proxy），避免经公网再回环时路径异常。
   - 记录 WebDAV 地址，一般为 `https://<公网域名>/dav/`。

将 **用户名 + 密码** 安全交给媒体平台配置（环境变量/密钥管理），不要出现在本仓库。

### 媒体 `base_url` 形状

媒体写入逻辑相对于 WebDAV **根目录**：

```text
媒体平台/<filename>
```

因此 `base_url` 应形如 `https://<domain>/dav/`（末尾 `/` 与媒体侧配置保持一致），且该根下允许 `MKCOL 媒体平台`。

## 安全获取凭据

| 角色 | 获取方式 |
|------|----------|
| 管理员 | 首次启动 `.env` 的 `ALIST_ADMIN_PASSWORD` 或日志随机密码 → 面板修改 |
| WebDAV | 面板新建专用用户 → 通过密钥系统注入媒体服务 |

禁止在 PR、Issues、聊天中粘贴真实密码或 refresh token。

## 冒烟检查

配置完成并公网可达后，在本机执行（替换域名与用户）：

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -u 'media-webdav:YOUR_PASSWORD' \
  -X PROPFIND \
  -H 'Depth: 0' \
  'https://alist.3gather.com/dav/'
```

期望 HTTP **207** 或 **200**（视服务端实现）；401 表示地址可达但凭据错误。

可选：测试建目录权限（注意不要在生产随意 PUT 大文件）：

```bash
curl -sS -u 'media-webdav:YOUR_PASSWORD' \
  -X MKCOL \
  'https://alist.3gather.com/dav/媒体平台'
```

## 端口

| 变量 | 默认 | 说明 |
|------|------|------|
| `ALIST_HTTP_PORT` | 5244 | 宿主机映射 → 容器 5244 |
| `ALIST_ADMIN_USERNAME` | admin | 仅首次初始化 |
| `ALIST_ADMIN_PASSWORD` | （空） | 仅首次初始化；之后以面板为准 |

## 数据与安全

- `alist/data/` 含数据库、令牌与挂载信息，**勿提交 Git**。
- 管理面板默认不要裸露在公网；优先 VPN/内网访问，或反代 + 限速 + 强认证。
- WebDAV 使用 HTTPS + 独立低权限用户。

## 与 g-support-net

容器名 `alist`，加入外部网络 `g-support-net`，与 `egress-proxy`、`indextts2` 等栈一致，便于同网服务探测 `http://alist:5244`。
