# g-ppt Python SDK

薄客户端：默认走 Node Hono API（`G_PPT_API_URL`）；未设置时回退本地 CLI。

```bash
# 先启动服务：docker compose up / npm run api
export G_PPT_API_URL=http://127.0.0.1:18800

cd sdk/python
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
```

```python
import g_ppt

g_ppt.list_packs()
g_ppt.list_templates(pack="default")
g_ppt.get_layout_rules()  # 选版规则；同源 GET /api/layout-rules
# 传 out 时自动从服务端 /output/ 下载到本地
g_ppt.render_slide("compare_two_col_v1", out="out.png")

# 成片 + 右下角圆形解说头像（短循环 / 长裁剪；默认静音）
g_ppt.submit_render_show(
    scenes,
    burn_in=True,
    presenter={"src": "presenter/talking.mp4", "size": 280, "margin": 48},
)
g_ppt.open_preview(pack="default")
```

`render_show` / `submit_render_show` 均支持可选 `presenter`（`src` / `size` / `margin` / `keep_audio`）。

临时不安装：

```bash
G_PPT_API_URL=http://127.0.0.1:18800 PYTHONPATH=sdk/python/src python3 -c "import g_ppt; print(g_ppt.list_packs())"
```
