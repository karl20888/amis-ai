"""RAG Pipeline — pgvector 向量检索 + 混合查询"""

import json
from typing import List

from .db import get_pool
from .embedding import get_embedding


async def retrieve_context(
    user_prompt: str,
    top_k: int = 5,
    category: str | None = None,
) -> List[dict]:
    """检索与用户需求最相关的 amis 模板/文档

    Args:
        user_prompt: 用户的自然语言需求
        top_k: 返回最相关的 K 条结果
        category: 可选的分类过滤

    Returns:
        包含 title, content, category, similarity 的字典列表
    """
    pool = await get_pool()

    # 1. 向量化用户输入
    embedding = await get_embedding(user_prompt)
    embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

    # 2. pgvector 向量检索（余弦相似度 + 可选分类过滤）
    if category:
        query = """
            SELECT id, title, description, amis_json, category, quality_score,
                   1 - (embedding <=> $1::vector) AS similarity
            FROM amis_templates
            WHERE embedding IS NOT NULL
              AND category = $2
            ORDER BY embedding <=> $1::vector
            LIMIT $3
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, embedding_str, category, top_k)
    else:
        query = """
            SELECT id, title, description, amis_json, category, quality_score,
                   1 - (embedding <=> $1::vector) AS similarity
            FROM amis_templates
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector
            LIMIT $2
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, embedding_str, top_k)

    # 3. 组装结果，按 similarity * quality_score 加权排序
    contexts = []
    for row in rows:
        quality = row["quality_score"] or 0.0
        similarity = row["similarity"] or 0.0
        contexts.append({
            "id": row["id"],
            "title": row["title"],
            "content": row["amis_json"],
            "description": row["description"],
            "category": row["category"],
            "similarity": similarity,
            "score": similarity * (1 + quality * 0.1),
        })

    contexts.sort(key=lambda x: x["score"], reverse=True)
    return contexts[:top_k]


async def index_template(
    template_id: int,
    title: str,
    description: str,
    amis_json: str,
) -> bool:
    """将采纳的模板向量化并写入 embedding 字段

    Args:
        template_id: amis_templates 表的 ID
        title: 模板标题
        description: 模板描述（用户原始需求）
        amis_json: amis JSON 配置

    Returns:
        是否成功
    """
    pool = await get_pool()

    # 构建向量化文本：标题 + 描述（用户需求更重要）
    text_to_embed = f"{title}\n{description}" if description else title

    try:
        embedding = await get_embedding(text_to_embed)
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE amis_templates
                SET embedding = $1::vector
                WHERE id = $2
                """,
                embedding_str,
                template_id,
            )
        return True
    except Exception as e:
        print(f"[RAG] 向量化入库失败 template_id={template_id}: {e}")
        return False
