"""Embedding 向量化服务 — 通过 LLM 配置获取 embedding 模型"""

import json
from typing import List

import httpx

from .llm_client import get_llm_config


async def get_embedding(text: str) -> List[float]:
    """将文本向量化，返回 embedding 向量"""
    config = await get_llm_config("embedding")

    async with httpx.AsyncClient(trust_env=False) as client:
        resp = await client.post(
            f"{config['base_url']}/embeddings",
            headers={
                "Authorization": f"Bearer {config['api_key']}",
                "Content-Type": "application/json",
            },
            json={
                "model": config["model"],
                "input": text,
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["data"][0]["embedding"]


async def get_embeddings_batch(texts: List[str], batch_size: int = 20) -> List[List[float]]:
    """批量向量化"""
    config = await get_llm_config("embedding")
    all_embeddings: List[List[float]] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        async with httpx.AsyncClient(trust_env=False) as client:
            resp = await client.post(
                f"{config['base_url']}/embeddings",
                headers={
                    "Authorization": f"Bearer {config['api_key']}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": config["model"],
                    "input": batch,
                },
                timeout=60.0,
            )
            resp.raise_for_status()
            data = resp.json()
            # 按 index 排序确保顺序正确
            sorted_data = sorted(data["data"], key=lambda x: x["index"])
            all_embeddings.extend([d["embedding"] for d in sorted_data])

    return all_embeddings
