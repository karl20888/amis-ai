"""从 Rust 服务获取 LLM 配置，并调用 OpenAI 兼容 API"""

import time
from typing import AsyncIterator

import httpx

from ..config import RUST_BACKEND_URL, INTERNAL_API_KEY

# 配置缓存：task_type -> (config_dict, timestamp)
_config_cache: dict[str, tuple[dict, float]] = {}
CACHE_TTL = 300  # 5 分钟


def clear_config_cache() -> int:
    """清除所有 LLM 配置缓存，返回清除的条目数"""
    count = len(_config_cache)
    _config_cache.clear()
    return count


async def get_llm_config(task_type: str) -> dict:
    """从 Rust 服务获取 LLM 配置，带本地缓存"""
    now = time.time()
    if task_type in _config_cache:
        config, ts = _config_cache[task_type]
        if now - ts < CACHE_TTL:
            return config

    async with httpx.AsyncClient(trust_env=False) as client:
        resp = await client.get(
            f"{RUST_BACKEND_URL}/api/internal/llm/resolve/{task_type}",
            headers={"X-Internal-Key": INTERNAL_API_KEY},
            timeout=5.0,
        )
        resp.raise_for_status()
        config = resp.json()
        _config_cache[task_type] = (config, now)
        return config


async def chat_completion(
    task_type: str,
    messages: list[dict],
    stream: bool = False,
) -> dict | httpx.Response:
    """调用 LLM chat completion"""
    config = await get_llm_config(task_type)

    body: dict = {
        "model": config["model"],
        "messages": messages,
        "temperature": config["temperature"],
        "stream": stream,
    }
    if config.get("max_tokens"):
        body["max_tokens"] = config["max_tokens"]

    async with httpx.AsyncClient(trust_env=False) as client:
        resp = await client.post(
            f"{config['base_url']}/chat/completions",
            headers={
                "Authorization": f"Bearer {config['api_key']}",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=120.0,
        )
        if not stream:
            resp.raise_for_status()
            return resp.json()
        return resp


async def chat_completion_stream(
    task_type: str,
    messages: list[dict],
) -> AsyncIterator[str]:
    """流式调用 LLM，逐个 token yield"""
    config = await get_llm_config(task_type)

    body: dict = {
        "model": config["model"],
        "messages": messages,
        "temperature": config["temperature"],
        "stream": True,
    }
    if config.get("max_tokens"):
        body["max_tokens"] = config["max_tokens"]

    async with httpx.AsyncClient(trust_env=False) as client:
        async with client.stream(
            "POST",
            f"{config['base_url']}/chat/completions",
            headers={
                "Authorization": f"Bearer {config['api_key']}",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=120.0,
        ) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                raise RuntimeError(
                    f"LLM API 返回 {resp.status_code}: {body.decode(errors='replace')[:500]}"
                )
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data.strip() == "[DONE]":
                    break
                yield data
