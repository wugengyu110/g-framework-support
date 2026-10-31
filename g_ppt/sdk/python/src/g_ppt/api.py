"""公开 API：优先走 Node HTTP（G_PPT_API_URL），否则本地 CLI。"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import webbrowser
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

from .paths import (
    GPptError,
    api_base,
    catalog_path,
    load_catalog,
    repo_root,
    run_cli,
    which_node_tools,
    _http_download,
    _http_json,
    _http_upload_file,
)


def list_packs(*, refresh: bool = True) -> list[dict[str, Any]]:
    if api_base():
        return list(
            _http_json(
                "GET",
                "/api/packs",
                query={"refresh": "false" if not refresh else None},
            )
        )
    return list(load_catalog(refresh=refresh).get("packs", []))


def list_templates(
    *,
    pack: str | None = None,
    type: str | None = None,
    refresh: bool = True,
) -> list[dict[str, Any]]:
    """
    列出模板；每项含 schema / demo / inputs / when / roles。
    新增模板只要写好 export const template，刷新后自动出现；选版规则随 catalog 走。
    """
    if api_base():
        return list(
            _http_json(
                "GET",
                "/api/templates",
                query={
                    "pack": pack,
                    "type": type,
                    "refresh": "false" if not refresh else None,
                },
            )
        )
    items = load_catalog(refresh=refresh).get("templates", [])
    out: list[dict[str, Any]] = []
    for t in items:
        if pack and t.get("pack") != pack:
            continue
        if type and t.get("type") != type:
            continue
        out.append(dict(t))
    return out


def get_template_schema(template_id: str, *, refresh: bool = True) -> dict[str, Any]:
    """
    单模板完整契约：meta + schema + demo + inputs。
    （不仅是 JSON Schema；demo / inputs 便于 Agent 填 props。）
    """
    if api_base():
        return dict(
            _http_json(
                "GET",
                f"/api/templates/{template_id}/schema",
                query={"refresh": "false" if not refresh else None},
            )
        )
    for t in load_catalog(refresh=refresh).get("templates", []):
        if t.get("id") == template_id:
            if not isinstance(t.get("schema"), dict):
                raise GPptError(f"template has no schema: {template_id}")
            return dict(t)
    raise GPptError(f"unknown template_id: {template_id}")


def get_layout_rules(*, refresh: bool = True) -> dict[str, Any]:
    """
    选版规则：types / role_to_types / prompt.*。
    同源 GET /api/layout-rules。Agent 与 media 只读此接口，勿手写 type 清单。
    """
    if api_base():
        return dict(
            _http_json(
                "GET",
                "/api/layout-rules",
                query={"refresh": "false" if not refresh else None},
            )
        )
    raw = load_catalog(refresh=refresh).get("layout_rules")
    if isinstance(raw, dict) and raw.get("prompt"):
        return dict(raw)
    return {}


def render_slide(
    template_id: str,
    props: dict[str, Any] | None = None,
    *,
    out: str | None = None,
    format: str = "png",
    duration_sec: float = 5.0,
) -> str:
    """
    渲染一页，返回产物路径。
    HTTP 模式：传 out 则自动从 /output/ 下载到本地；否则返回服务端路径。
    """
    if api_base():
        body: dict[str, Any] = {
            "template_id": template_id,
            "format": format,
            "duration_sec": duration_sec,
        }
        if props is not None:
            body["props"] = props
        if out:
            body["filename"] = Path(out).name
        result = _http_json("POST", "/api/render/slide", body=body)
        if not result.get("ok"):
            raise GPptError(f"render_slide failed: {result}")
        server_path = str(result["path"])
        if out:
            return str(_http_download(Path(server_path).name, Path(out)))
        return server_path

    args = ["render-slide", "--id", template_id, "--format", format]
    if props is not None:
        args.extend(["--props", json.dumps(props, ensure_ascii=False)])
    if out:
        args.extend(["--out", str(Path(out).expanduser().resolve())])
    if format == "mp4":
        args.extend(["--duration", str(duration_sec)])
    result = run_cli(args)
    if not isinstance(result, dict) or not result.get("ok"):
        raise GPptError(f"render_slide failed: {result}")
    return str(result["path"])


def upload_asset(
    file_path: str | Path,
    *,
    filename: str | None = None,
) -> dict[str, Any]:
    """
    上传图片/视频/音频/字幕到服务端媒体库。
    返回含 id / src（asset:<id>），可直接写入 render_show scenes。
    filename 可选，覆盖上传时的原始文件名（避免临时路径同名覆盖）。
    仅 HTTP 模式（需 G_PPT_API_URL）。
    """
    if not api_base():
        raise GPptError("upload_asset requires G_PPT_API_URL")
    result = _http_upload_file("/api/assets", Path(file_path), filename=filename)
    if not result.get("ok"):
        raise GPptError(f"upload_asset failed: {result}")
    return dict(result)


def concat_audio(
    sources: list[str],
    *,
    filename: str | None = None,
) -> dict[str, Any]:
    """
    工具：按顺序拼接短语音 → 长音频（写入 assets，返回 src）。
    成片主路径请用 render_show 的按段 audio_src，不必先拼长轨。
    仅 HTTP 模式。
    """
    if not api_base():
        raise GPptError("concat_audio requires G_PPT_API_URL")
    body: dict[str, Any] = {"sources": sources}
    if filename:
        body["filename"] = filename
    result = _http_json("POST", "/api/audio/concat", body=body)
    if not result.get("ok"):
        raise GPptError(f"concat_audio failed: {result}")
    return dict(result)


def tempo_audio(
    source: str,
    *,
    speed: float,
    filename: str | None = None,
) -> dict[str, Any]:
    """
    工具：对已生成音频做 ffmpeg atempo 整体变速（写入 assets，返回 src）。
    口播语速应走此路径，不要把 speed 传给 TTS。仅 HTTP 模式。
    """
    if not api_base():
        raise GPptError("tempo_audio requires G_PPT_API_URL")
    body: dict[str, Any] = {"source": source, "speed": float(speed)}
    if filename:
        body["filename"] = filename
    result = _http_json("POST", "/api/audio/tempo", body=body)
    if not result.get("ok"):
        raise GPptError(f"tempo_audio failed: {result}")
    return dict(result)


def render_show(
    scenes: list[dict[str, Any]],
    *,
    out: str | None = None,
    subtitle_src: str | None = None,
    burn_in: bool = False,
    keep_video_audio: bool = False,
    bgm_src: str | None = None,
    bgm_volume: float | None = None,
    presenter: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    同步时间轴合成（可叠旁白与字幕）。长任务请用 submit_render_show + wait_job。

    scenes 可混排：

    - template: {"template_id", "props", "duration_sec?", "audio_src?", "cues?"}
    - image: {"kind": "image", "src", "duration_sec?", "fit?", "audio_src?", "cues?"}
    - video: {"kind": "video", "src", "trim_*?", "audio_src?", "cues?"}

    有 audio_src 时该段画面时长跟旁白。subtitle_src 为成片绝对时间 SRT；
    否则合并各 scene.cues。burn_in=True 硬烧字幕。
    keep_video_audio=True 时旁白与原片音轨混音（默认替换原声）。
    bgm_src / bgm_volume 为成片级循环背景音乐。
    presenter 可选：{"src", "size?", "margin?", "keep_audio?"} 右下角圆形人像。
    """
    if api_base():
        body: dict[str, Any] = {
            "scenes": scenes,
            "burn_in": burn_in,
            "keep_video_audio": keep_video_audio,
        }
        if out:
            body["filename"] = Path(out).name
        if subtitle_src:
            body["subtitle_src"] = subtitle_src
        if bgm_src:
            body["bgm_src"] = bgm_src
        if bgm_volume is not None:
            body["bgm_volume"] = bgm_volume
        if presenter:
            body["presenter"] = presenter
        result = _http_json("POST", "/api/render/show", body=body)
        if not result.get("ok"):
            raise GPptError(f"render_show failed: {result}")
        if out:
            local = _http_download(Path(str(result["path"])).name, Path(out))
            result = {**result, "path": str(local)}
            timeline = result.get("timeline_path")
            if timeline:
                tl_dest = Path(out).with_suffix(".timeline.json")
                try:
                    result["timeline_path"] = str(
                        _http_download(Path(str(timeline)).name, tl_dest)
                    )
                except GPptError:
                    pass
            subtitle = result.get("subtitle_path")
            if subtitle:
                sub_dest = Path(out).with_suffix(".srt")
                try:
                    result["subtitle_path"] = str(
                        _http_download(Path(str(subtitle)).name, sub_dest)
                    )
                except GPptError:
                    pass
        return result

    with tempfile.NamedTemporaryFile(
        "w", suffix=".json", delete=False, encoding="utf-8"
    ) as f:
        payload: dict[str, Any] = {
            "scenes": scenes,
            "burn_in": burn_in,
            "keep_video_audio": keep_video_audio,
        }
        if subtitle_src:
            payload["subtitle_src"] = subtitle_src
        if bgm_src:
            payload["bgm_src"] = bgm_src
        if bgm_volume is not None:
            payload["bgm_volume"] = bgm_volume
        if presenter:
            payload["presenter"] = presenter
        json.dump(payload, f, ensure_ascii=False)
        scenes_path = f.name
    args = ["render-show", "--scenes", scenes_path]
    if out:
        args.extend(["--out", str(Path(out).expanduser().resolve())])
    try:
        result = run_cli(args)
    finally:
        Path(scenes_path).unlink(missing_ok=True)
    if not isinstance(result, dict) or not result.get("ok"):
        raise GPptError(f"render_show failed: {result}")
    return result


def submit_render_show(
    scenes: list[dict[str, Any]],
    *,
    filename: str | None = None,
    subtitle_src: str | None = None,
    burn_in: bool = False,
    keep_video_audio: bool = False,
    bgm_src: str | None = None,
    bgm_volume: float | None = None,
    presenter: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    异步提交 show 成片，立刻返回 { job_id, status }。
    仅 HTTP 模式。随后 get_job / wait_job 轮询。
    """
    if not api_base():
        raise GPptError("submit_render_show requires G_PPT_API_URL")
    body: dict[str, Any] = {
        "scenes": scenes,
        "burn_in": burn_in,
        "keep_video_audio": keep_video_audio,
    }
    if filename:
        body["filename"] = filename
    if subtitle_src:
        body["subtitle_src"] = subtitle_src
    if bgm_src:
        body["bgm_src"] = bgm_src
    if bgm_volume is not None:
        body["bgm_volume"] = bgm_volume
    if presenter:
        body["presenter"] = presenter
    result = _http_json("POST", "/api/jobs/render-show", body=body)
    if not result.get("ok"):
        raise GPptError(f"submit_render_show failed: {result}")
    return dict(result)


def get_job(job_id: str) -> dict[str, Any]:
    """查询异步任务。仅 HTTP 模式。"""
    if not api_base():
        raise GPptError("get_job requires G_PPT_API_URL")
    result = _http_json("GET", f"/api/jobs/{job_id}")
    if not result.get("ok"):
        raise GPptError(f"get_job failed: {result}")
    return dict(result)


def wait_job(
    job_id: str,
    *,
    poll_sec: float = 2.0,
    timeout_sec: float = 3600.0,
    out: str | None = None,
    on_update: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """
    轮询直到 done/error。done 时若传 out 则下载成片（及 timeline/srt）。
    on_update：每次轮询拿到 job 快照时回调（含终态）。
    仅 HTTP 模式。
    """
    import time

    if not api_base():
        raise GPptError("wait_job requires G_PPT_API_URL")
    deadline = time.monotonic() + timeout_sec
    while True:
        job = get_job(job_id)
        if on_update is not None:
            on_update(dict(job))
        status = job.get("status")
        if status == "done":
            result = dict(job.get("result") or {})
            merged = {**job, **result, "ok": True}
            if out and result.get("path"):
                local = _http_download(Path(str(result["path"])).name, Path(out))
                merged["path"] = str(local)
                timeline = result.get("timeline_path")
                if timeline:
                    tl_dest = Path(out).with_suffix(".timeline.json")
                    try:
                        merged["timeline_path"] = str(
                            _http_download(Path(str(timeline)).name, tl_dest)
                        )
                    except GPptError:
                        pass
                subtitle = result.get("subtitle_path")
                if subtitle:
                    sub_dest = Path(out).with_suffix(".srt")
                    try:
                        merged["subtitle_path"] = str(
                            _http_download(Path(str(subtitle)).name, sub_dest)
                        )
                    except GPptError:
                        pass
            return merged
        if status == "error":
            raise GPptError(f"job failed: {job.get('error') or job}")
        if time.monotonic() >= deadline:
            raise GPptError(f"job timeout after {timeout_sec}s: {job_id} status={status}")
        time.sleep(poll_sec)


def open_preview(
    *,
    pack: str | None = None,
    template: str | None = None,
    blocking: bool = False,
) -> str:
    """打开预览：有 API 则打开服务首页；否则起本地 Vite。"""
    q: dict[str, str] = {}
    if pack:
        q["pack"] = pack
    if template:
        q["template"] = template
    qs = f"?{urlencode(q)}" if q else ""

    base = api_base()
    if base:
        url = f"{base}/{qs}"
        webbrowser.open(url)
        return url

    url = f"http://127.0.0.1:5173/{qs}"
    args = ["preview"]
    if pack:
        args.extend(["--pack", pack])
    if template:
        args.extend(["--template", template])
    root = repo_root()
    npm = shutil.which("npm")
    if not npm:
        raise GPptError("npm not found on PATH")
    if blocking:
        run_cli(args, capture=False)
    else:
        subprocess.Popen(
            [npm, "run", "g-ppt", "--", *args],
            cwd=str(root),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        webbrowser.open(url)
    return url


def doctor() -> dict[str, Any]:
    if api_base():
        try:
            return dict(_http_json("GET", "/api/doctor"))
        except GPptError as e:
            return {"api_url": api_base(), "error": str(e)}
    tools = which_node_tools()
    return {
        **tools,
        "catalog_exists": catalog_path().exists(),
        "repo_root": str(repo_root()),
    }
