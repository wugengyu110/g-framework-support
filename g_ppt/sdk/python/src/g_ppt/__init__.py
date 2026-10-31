"""
G-PPT Python SDK（薄客户端，优先调 Node API）。

正式用法::

    export G_PPT_API_URL=http://127.0.0.1:18800
    pip install -e ./sdk/python
    import g_ppt
    g_ppt.list_templates()  # 含 schema / demo / inputs，可直接给 AI 作填槽说明
    g_ppt.get_layout_rules()  # 选版规则；media / Agent 只读此接口
"""

from .api import (
    concat_audio,
    doctor,
    get_job,
    get_template_schema,
    get_layout_rules,
    list_packs,
    list_templates,
    open_preview,
    render_show,
    render_slide,
    submit_render_show,
    tempo_audio,
    upload_asset,
    wait_job,
)
from .paths import GPptError

__all__ = [
    "GPptError",
    "list_packs",
    "list_templates",
    "get_layout_rules",
    "get_template_schema",
    "upload_asset",
    "concat_audio",
    "tempo_audio",
    "render_slide",
    "render_show",
    "submit_render_show",
    "get_job",
    "wait_job",
    "open_preview",
    "doctor",
]

__version__ = "0.1.0"
