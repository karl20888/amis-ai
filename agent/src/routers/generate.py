"""amis JSON 生成接口 — 支持 SSE 流式输出"""

import json
import re

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from ..models.schemas import GenerateRequest
from ..services.llm_client import chat_completion, chat_completion_stream, get_llm_config
from ..services.prompt import build_messages
from ..services.rag import retrieve_context

router = APIRouter()


def extract_json(content: str) -> str | None:
    """从 LLM 输出中提取 JSON（可能被 markdown 代码块包裹）"""
    # 尝试匹配 ```json ... ``` 代码块
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", content, re.DOTALL)
    if match:
        return match.group(1).strip()
    # 尝试直接解析
    content = content.strip()
    if content.startswith("{"):
        return content
    return None


@router.post("/generate")
async def generate_amis(request: GenerateRequest):
    """生成 amis JSON 配置"""
    # RAG 检索相关上下文
    rag_contexts = []
    try:
        rag_contexts = await retrieve_context(request.prompt, top_k=3, category=request.category)
    except Exception as e:
        print(f"[RAG] 检索失败（降级为无上下文生成）: {e}")

    # 构建消息列表（含历史对话 + RAG 上下文）
    history = [{"role": m.role, "content": m.content} for m in request.history]
    messages = build_messages(
        request.prompt,
        history=history or None,
        rag_contexts=rag_contexts or None,
    )

    if request.stream:
        return EventSourceResponse(
            stream_generate(messages, rag_contexts),
            media_type="text/event-stream",
        )

    # 非流式
    try:
        config = await get_llm_config("generation")
        result = await chat_completion("generation", messages, stream=False)
        content = result["choices"][0]["message"]["content"]
        amis_json = extract_json(content) or content

        return JSONResponse({
            "amis_json": amis_json,
            "raw_content": content,
            "model_used": config.get("model"),
        })
    except Exception as e:
        return JSONResponse(
            {"error": str(e)},
            status_code=500,
        )


async def stream_generate(messages: list[dict], rag_contexts: list[dict] | None = None):
    """SSE 流式生成器"""
    full_content = ""
    try:
        config = await get_llm_config("generation")

        # 先发送元信息（模型 + RAG 命中数）
        meta = {"model": config.get("model"), "rag_hits": len(rag_contexts) if rag_contexts else 0}
        yield {"event": "meta", "data": json.dumps(meta)}

        chunk_count = 0
        stream_error = ""
        async for chunk_data in chat_completion_stream("generation", messages):
            try:
                chunk = json.loads(chunk_data)

                # 检测流中的错误响应
                if "error" in chunk:
                    err_msg = chunk["error"].get("message", str(chunk["error"]))
                    print(f"[生成] LLM 返回错误: {err_msg}")
                    stream_error = err_msg
                    continue

                choices = chunk.get("choices", [])
                if not choices:
                    if chunk_count == 0:
                        print(f"[生成] 首个 chunk 无 choices: {chunk_data[:200]}")
                    continue
                delta = choices[0].get("delta", {})
                content = delta.get("content", "")
                if content:
                    full_content += content
                    yield {"data": json.dumps({"content": content, "full": full_content})}
                chunk_count += 1
            except (json.JSONDecodeError, KeyError, IndexError) as e:
                print(f"[生成] chunk 解析异常: {e}, 原始数据: {chunk_data[:200]}")
                continue

        print(f"[生成] 流结束，共 {chunk_count} 个有效 chunk，内容长度: {len(full_content)}")

        # 如果有流错误且无内容，返回错误事件
        if stream_error and not full_content:
            print(f"[生成] ⚠️ 生成失败: {stream_error}")
            yield {"event": "error", "data": json.dumps({"error": f"模型返回错误: {stream_error}"})}
            return

        if not full_content:
            print("[生成] ⚠️ 内容为空！LLM 未返回任何有效内容")
            yield {"event": "error", "data": json.dumps({"error": "模型未返回任何内容，请检查模型配置或稍后重试"})}
            return

        # 生成完毕，提取 JSON 并发送最终结果
        print(f"[生成] 内容前 200 字符: {full_content[:200]}")
        amis_json = extract_json(full_content) or full_content
        yield {
            "event": "done",
            "data": json.dumps({
                "amis_json": amis_json,
                "raw_content": full_content,
                "model_used": config.get("model"),
            }),
        }
    except Exception as e:
        yield {"event": "error", "data": json.dumps({"error": str(e)})}
