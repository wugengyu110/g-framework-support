"""路径、CLI 与 HTTP 客户端。"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


class GPptError(RuntimeError):
    """g-ppt 调用失败。"""


def api_base() -> str | None:
    base = os.environ.get("G_PPT_API_URL", "").rstrip("/")
    return base or None


def repo_root() -> Path:
    """g_ppt 仓库根（含 package.json / tools）。

    优先 G_PPT_ROOT；否则在常见布局中探测：
    - 独立仓库：sdk/python/src/g_ppt → 上 4 级
    - monorepo：backend/src/g_ppt → 需设 G_PPT_ROOT，否则无法回退 CLI
    """
    env = os.environ.get("G_PPT_ROOT")
    if env:
        return Path(env).expanduser().resolve()
    here = Path(__file__).resolve().parent
    for cand in (here.parents[4], here.parents[3]):
        if (cand / "package.json").is_file() and (cand / "tools").is_dir():
            return cand
    return here.parents[4]


def catalog_path() -> Path:
    return repo_root() / "catalog" / "catalog.json"


def _http_json(
    method: str,
    path: str,
    *,
    query: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
) -> Any:
    base = api_base()
    if not base:
        raise GPptError("G_PPT_API_URL not set")
    url = f"{base}{path}"
    if query:
        q = {k: v for k, v in query.items() if v is not None}
        if q:
            url = f"{url}?{urlencode(q)}"
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=600) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise GPptError(f"HTTP {e.code}: {detail}") from e
    except URLError as e:
        raise GPptError(f"API unreachable ({base}): {e}") from e


def _http_download(name: str, dest: Path) -> Path:
    """从服务端 /output/{name} 下载到本地 dest。"""
    base = api_base()
    if not base:
        raise GPptError("G_PPT_API_URL not set")
    # 空格/中文等必须编码，否则 urllib 报 URL can't contain control characters
    segment = quote(Path(name).name, safe="")
    url = f"{base}/output/{segment}"
    dest = dest.expanduser().resolve()
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = Request(url, method="GET")
    try:
        with urlopen(req, timeout=600) as resp:
            dest.write_bytes(resp.read())
    except HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise GPptError(f"download HTTP {e.code}: {detail}") from e
    except URLError as e:
        raise GPptError(f"API unreachable ({base}): {e}") from e
    return dest


def _http_upload_file(
    path: str,
    file_path: Path,
    *,
    filename: str | None = None,
) -> Any:
    """multipart/form-data 上传，字段名 file。filename 覆盖 Content-Disposition 中的名。"""
    base = api_base()
    if not base:
        raise GPptError("G_PPT_API_URL not set")
    file_path = file_path.expanduser().resolve()
    if not file_path.is_file():
        raise GPptError(f"file not found: {file_path}")

    boundary = f"----g-ppt-{os.urandom(8).hex()}"
    upload_name = (filename or file_path.name).strip() or file_path.name
    raw = file_path.read_bytes()
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{upload_name}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8") + raw + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = Request(
        f"{base}{path}",
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=600) as resp:
            text = resp.read().decode("utf-8")
            return json.loads(text) if text else {}
    except HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise GPptError(f"HTTP {e.code}: {detail}") from e
    except URLError as e:
        raise GPptError(f"API unreachable ({base}): {e}") from e


def ensure_catalog(*, force: bool = False) -> Path:
    path = catalog_path()
    if path.exists() and not force:
        return path
    run_cli(["catalog"])
    if not path.exists():
        raise GPptError(f"catalog not generated: {path}")
    return path


def load_catalog(*, refresh: bool = False) -> dict[str, Any]:
    if api_base():
        # HTTP 模式下 list 走 API；catalog 文件可不存在
        raise GPptError("use API list_* helpers when G_PPT_API_URL is set")
    path = ensure_catalog(force=refresh)
    return json.loads(path.read_text(encoding="utf-8"))


def _extract_json(text: str) -> Any:
    text = text.strip()
    if not text:
        raise GPptError("CLI returned empty output")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for match in reversed(list(re.finditer(r"(\{[\s\S]*\}|\[[\s\S]*\])", text))):
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
    raise GPptError(f"CLI returned non-JSON:\n{text[-2000:]}")


def run_cli(args: list[str], *, capture: bool = True) -> Any:
    root = repo_root()
    npm = shutil.which("npm")
    if not npm:
        raise GPptError("npm not found on PATH; install Node.js or set G_PPT_API_URL")

    cmd = [npm, "run", "--silent", "g-ppt", "--", *args]
    env = {
        **os.environ,
        "FORCE_COLOR": "0",
        "npm_config_loglevel": "error",
        "npm_config_update_notifier": "false",
    }
    proc = subprocess.run(
        cmd,
        cwd=str(root),
        capture_output=capture,
        text=True,
        env=env,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise GPptError(err or f"cli failed: {' '.join(cmd)}")
    if not capture:
        return ""
    return _extract_json(proc.stdout or "")


def which_node_tools() -> dict[str, bool]:
    return {
        "npm": shutil.which("npm") is not None,
        "node": shutil.which("node") is not None,
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "repo": repo_root().joinpath("package.json").exists(),
        "api_url": api_base(),
    }
