"""
在 IndexTTS2 原生 API 上挂 g_media 兼容端点：
  GET  /health
  GET  /v1/voices/custom
  POST /v1/audio/speech   （OpenAI 风格：input + voice）

上游（同容器）：http://127.0.0.1:8002 的 /tts、/tts_cached、/speakers、/health

用法（容器内，与官方 api/webui 并行）:
  uv run python3 /app/g_framework_tts_shim.py
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, request

UPSTREAM = os.environ.get("INDEX_TTS2_UPSTREAM", "http://127.0.0.1:8002").rstrip("/")
SHIM_HOST = os.environ.get("INDEX_TTS2_SHIM_HOST", "0.0.0.0")
SHIM_PORT = int(os.environ.get("INDEX_TTS2_SHIM_PORT", "8003"))
VOICES_DIR = Path(os.environ.get("INDEX_TTS2_VOICES_DIR", "/app/voices"))
EXAMPLES_DIR = Path(os.environ.get("INDEX_TTS2_EXAMPLES_DIR", "/app/examples"))

app = Flask(__name__)


def _http_json(method: str, url: str, *, payload: dict[str, Any] | None = None, timeout: float = 600.0) -> Any:
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
        ctype = (resp.headers.get("Content-Type") or "").lower()
        if "application/json" in ctype or body[:1] in (b"{", b"["):
            return json.loads(body.decode("utf-8", errors="ignore"))
        return body


def _http_bytes(method: str, url: str, *, payload: dict[str, Any], timeout: float = 600.0) -> bytes:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:2000]
        raise RuntimeError(f"upstream HTTP {exc.code}: {detail}") from exc


def _load_catalog_voices() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    catalog_path = VOICES_DIR / "catalog.json"
    if not catalog_path.is_file():
        return out
    try:
        raw = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return out
    rows = raw.get("voices") if isinstance(raw, dict) else raw
    if not isinstance(rows, list):
        return out
    for row in rows:
        if not isinstance(row, dict):
            continue
        vid = str(row.get("id") or row.get("voice_id") or "").strip()
        if not vid:
            continue
        ref = str(row.get("ref_audio") or f"{vid}.wav").strip()
        out[vid] = {
            "id": vid,
            "name": str(row.get("name") or row.get("label") or vid).strip() or vid,
            "ref_audio": ref,
            "kind": "catalog",
        }
    return out


def _discover_sidecar_voices(existing: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    if not VOICES_DIR.is_dir():
        return existing
    out = dict(existing)
    for wav in sorted(VOICES_DIR.glob("*.wav")):
        vid = wav.stem
        if vid in out:
            continue
        out[vid] = {"id": vid, "name": vid, "ref_audio": wav.name, "kind": "sidecar"}
    return out


def _builtin_example_voices() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    if not EXAMPLES_DIR.is_dir():
        return out
    for wav in sorted(EXAMPLES_DIR.glob("voice_*.wav")):
        vid = wav.stem
        out[vid] = {
            "id": vid,
            "name": vid,
            "ref_audio_path": str(wav),
            "kind": "builtin",
        }
    return out


def _cached_speakers() -> list[dict[str, Any]]:
    try:
        raw = _http_json("GET", f"{UPSTREAM}/speakers", timeout=10.0)
    except Exception:
        return []
    rows = raw.get("speakers") if isinstance(raw, dict) else None
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    for it in rows:
        if not isinstance(it, dict):
            continue
        sid = str(it.get("speaker_id") or "").strip()
        if not sid:
            continue
        name = str(it.get("speaker_name") or sid).strip() or sid
        out.append({"id": sid, "name": name, "kind": "cached", "speaker_id": sid})
    return out


def list_voice_records() -> list[dict[str, Any]]:
    catalog = _discover_sidecar_voices(_load_catalog_voices())
    rows: list[dict[str, Any]] = []
    for vid, meta in sorted(catalog.items()):
        ref_path = VOICES_DIR / str(meta["ref_audio"])
        if not ref_path.is_file():
            continue
        rows.append({**meta, "ref_audio_path": str(ref_path)})
    for vid, meta in sorted(_builtin_example_voices().items()):
        rows.append(meta)
    rows.extend(_cached_speakers())
    return rows


def resolve_voice(voice_id: str) -> dict[str, Any] | None:
    key = (voice_id or "").strip()
    if not key:
        return None
    for row in list_voice_records():
        if row["id"] == key:
            return row
    return None


@app.get("/health")
def health():
    """上游未就绪时仍返回 HTTP 200 + status=starting，避免客户端把冷启动误判为连不上。"""
    upstream: dict[str, Any] = {}
    try:
        raw = _http_json("GET", f"{UPSTREAM}/health", timeout=5.0)
        if isinstance(raw, dict):
            upstream = raw
    except Exception as exc:
        return jsonify(
            {
                "status": "starting",
                "provider": "index_tts2",
                "upstream": UPSTREAM,
                "error": str(exc),
                "message": "IndexTTS2 上游 API 仍在加载模型，通常需 2–3 分钟",
            }
        )
    status = str(upstream.get("status") or "healthy")
    return jsonify(
        {
            "status": status if status.lower() in {"healthy", "ok", "up"} else status,
            "provider": "index_tts2",
            "upstream": UPSTREAM,
            "voices_dir": str(VOICES_DIR),
            "voice_count": len(list_voice_records()),
            "upstream_health": upstream,
        }
    )


@app.get("/v1/voices/custom")
def list_voices():
    voices = [
        {
            "id": v["id"],
            "name": v["name"],
            "text": "",
            "kind": v.get("kind") or "",
        }
        for v in list_voice_records()
    ]
    return jsonify({"voices": voices})


@app.post("/v1/audio/speech")
def speech():
    body = request.get_json(silent=True) or {}
    text = str(body.get("input") or "").strip()
    voice_id = str(body.get("voice") or "").strip()
    if not text:
        return jsonify({"message": "input is required"}), 400
    if not voice_id:
        return jsonify({"message": "voice is required"}), 400

    voice = resolve_voice(voice_id)
    if voice is None:
        return jsonify(
            {
                "message": f"unknown voice: {voice_id!r}",
                "voices_dir": str(VOICES_DIR),
            }
        ), 400

    # 口播管线语速由 g_ppt atempo 处理；此处忽略 speed
    try:
        if voice.get("kind") == "cached" or voice.get("speaker_id"):
            audio = _http_bytes(
                "POST",
                f"{UPSTREAM}/tts_cached",
                payload={
                    "text": text,
                    "speaker_id": str(voice.get("speaker_id") or voice["id"]),
                    "num_beams": 1,
                    "do_sample": False,
                },
            )
        else:
            prompt = str(voice.get("ref_audio_path") or "").strip()
            if not prompt:
                return jsonify({"message": f"voice {voice_id!r} missing ref audio path"}), 400
            audio = _http_bytes(
                "POST",
                f"{UPSTREAM}/tts",
                payload={
                    "text": text,
                    "spk_audio_prompt": prompt,
                    "num_beams": 1,
                    "do_sample": False,
                },
            )
    except Exception as exc:
        return jsonify({"message": str(exc)}), 502

    return Response(audio, mimetype="audio/wav")


if __name__ == "__main__":
    app.run(host=SHIM_HOST, port=SHIM_PORT, threaded=True)
