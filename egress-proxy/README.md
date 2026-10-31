# egress-proxy（v2rayA）

个人出站代理：**粘贴订阅 → 列表里点节点 → 点启动**，无需配 Xray 路由/出站订阅。

| 对比 | 3X-UI | **v2rayA（当前）** |
|------|--------|-------------------|
| 定位 | 自己当机场、多用户 | 本机/开发机当客户端 |
| 赔钱机场 | 出站订阅 + 路由规则 | 导入订阅 → SERVER 里勾选节点 |
| 和 v2rayN | 差别大 | 操作类似 |

其它可选：**mihomo + Metacubexd**（Clash 系，也是下拉选节点），但 v2rayA 对 VLESS/Reality 订阅更省心。

## 前置

```bash
docker network create g-support-net   # 已有可跳过
```

## 启动

```bash
cd ~/projects/g-framework-support
docker compose up -d egress-proxy
```

浏览器：`http://<宿主机>:2017`

- **第一次**打开会要求 **注册管理员**（没有固定 admin/admin，自设账号密码）。
- 若你之前用过 3X-UI，可删掉 `egress-proxy/data/` 再启（或换空目录），避免混用数据。

## 三步配赔钱机场

1. **导入**  
   左上角 **导入** → **订阅链接** → 粘贴赔钱机场订阅 URL → 确定 → 等节点出现在 **SERVER**（或订阅同名标签页）。

2. **选节点**  
   打开该标签 → **勾选 1 个节点**（建议先别勾太多，≤6 个）。可先 **测延迟** 再选。

3. **启动 + 给 Docker 用**  
   - 点右上角 **启动**（未启动时节点是灰色）。  
   - **设置** → 打开 **「局域网共享」/ LAN Sharing**（否则代理只监听容器内 127.0.0.1，g-framework 容器连不上）。  
   - 保存。

HTTP 代理地址（给 g-framework）：

- 容器内：`http://egress-proxy:7897`
- 宿主机本机调试：`http://127.0.0.1:7897`

## 对接 g-framework

`g-framework` 根目录 `.env`：

```env
PROXY_PROXY=
PROXY_HOST=egress-proxy
PROXY_PORT=7897
PROXY_SCHEME=http
```

`./dc sea up -d` 后，管理页 **网络 / 代理** 探针应通过。

## 端口

| 变量 | 默认 | 说明 |
|------|------|------|
| `EGRESS_PROXY_PANEL_PORT` | 2017 | Web 面板 |
| `EGRESS_PROXY_MIXED_PORT` | 7897 | HTTP 代理（映射 v2rayA 20171） |
| `EGRESS_PROXY_SOCKS_PORT` | 20170 | SOCKS5（可选） |

## 数据与安全

- 配置在 `egress-proxy/data/`（gitignore），含订阅与节点信息，勿提交 Git。
- 面板不要暴露公网，或加反向代理 + 强密码。

## 命令

```bash
docker compose up -d egress-proxy
docker compose logs -f egress-proxy
docker compose stop egress-proxy
```
