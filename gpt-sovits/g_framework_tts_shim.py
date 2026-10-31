"""
在 GPT-SoVITS api_v2 上挂 g_media 兼容端点：
  GET  /health
  GET  /v1/voices/custom
  POST /v1/audio/speech   （OpenAI 风格：input + voice）

用法（容器内）:
  python g_framework_tts_shim.py -a 0.0.0.0 -p 9880
"""

from __future__ import annotations

import json
import traceback
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import Body
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

# api_v2 在 import 时解析 sys.argv 并加载模型
import api_v2

VOICES_DIR = Path(__file__).resolve().parent / "voices"


class SpeechBody(BaseModel):
    input: str = Field(..., min_length=1)
    voice: str = Field(..., min_length=1)
    speed: float = 1.0
    text_lang: str | None = None
    prompt_lang: str | None = None


def _load_catalog_voices() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    catalog_path = VOICES_DIR / "catalog.json"
    if catalog_path.is_file():
        try:
            raw = json.loads(catalog_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw = {}
        rows = raw.get("voices") if isinstance(raw, dict) else raw
        if isinstance(rows, list):
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
                    "prompt_text": str(row.get("prompt_text") or row.get("text") or "").strip(),
                    "prompt_lang": str(row.get("prompt_lang") or "zh").strip().lower() or "zh",
                    "text_lang": str(row.get("text_lang") or "zh").strip().lower() or "zh",
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
        prompt = ""
        txt = wav.with_suffix(".txt")
        if txt.is_file():
            prompt = txt.read_text(encoding="utf-8", errors="ignore").strip()
        out[vid] = {
            "id": vid,
            "name": vid,
            "ref_audio": wav.name,
            "prompt_text": prompt,
            "prompt_lang": "zh",
            "text_lang": "zh",
        }
    return out


def list_voice_records() -> list[dict[str, Any]]:
    voices = _discover_sidecar_voices(_load_catalog_voices())
    rows: list[dict[str, Any]] = []
    for vid, meta in sorted(voices.items()):
        ref_path = VOICES_DIR / str(meta["ref_audio"])
        if not ref_path.is_file():
            continue
        rows.append({**meta, "ref_audio_path": str(ref_path)})
    return rows


def resolve_voice(voice_id: str) -> dict[str, Any] | None:
    key = (voice_id or "").strip()
    if not key:
        return None
    for row in list_voice_records():
        if row["id"] == key:
            return row
    return None


@api_v2.APP.get("/health")
async def g_framework_health():
    return {
        "status": "healthy",
        "provider": "gpt_sovits",
        "voices_dir": str(VOICES_DIR),
        "voice_count": len(list_voice_records()),
    }


@api_v2.APP.get("/v1/voices/custom")
async def g_framework_list_voices():
    voices = [
        {
            "id": v["id"],
            "name": v["name"],
            "text": v.get("prompt_text") or "",
        }
        for v in list_voice_records()
    ]
    return {"voices": voices}


@api_v2.APP.post("/v1/audio/speech")
async def g_framework_speech(body: SpeechBody = Body(...)):
    voice = resolve_voice(body.voice)
    if voice is None:
        return JSONResponse(
            status_code=400,
            content={"message": f"unknown voice: {body.voice!r}", "voices_dir": str(VOICES_DIR)},
        )
    prompt_text = str(voice.get("prompt_text") or "").strip()
    if not prompt_text:
        return JSONResponse(
            status_code=400,
            content={
                "message": f"voice {body.voice!r} missing prompt_text "
                f"(set catalog.json or {body.voice}.txt)"
            },
        )
    try:
        rate = float(body.speed)
    except (TypeError, ValueError):
        rate = 1.0
    rate = max(0.5, min(2.0, rate))

    text_lang = (body.text_lang or voice.get("text_lang") or "zh").strip().lower()
    prompt_lang = (body.prompt_lang or voice.get("prompt_lang") or "zh").strip().lower()
    req = {
        "text": body.input.strip(),
        "text_lang": text_lang,
        "ref_audio_path": voice["ref_audio_path"],
        "prompt_text": prompt_text,
        "prompt_lang": prompt_lang,
        "text_split_method": "cut5",
        "batch_size": 1,
        "media_type": "wav",
        "streaming_mode": False,
        # 口播管线默认走 g_ppt atempo；此处仅在显式非 1.0 时透传
        "speed_factor": rate,
        "parallel_infer": True,
    }
    result = await api_v2.tts_handle(req)
    # 失败时 tts_handle 返回 JSONResponse；成功为 Response(bytes)
    if isinstance(result, JSONResponse):
        return result
    if isinstance(result, Response):
        return result
    return result


if __name__ == "__main__":
    try:
        host = api_v2.host
        if host in (None, "None"):
            host = None
        uvicorn.run(app=api_v2.APP, host=host, port=api_v2.port, workers=1)
    except Exception:
        traceback.print_exc()
        raise
