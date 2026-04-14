"""内部 API — 供 Rust 服务调用，不对外暴露"""

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..config import INTERNAL_API_KEY
from ..services.llm_client import clear_config_cache
from ..services.rag import index_template

router = APIRouter()


class IndexRequest(BaseModel):
    template_id: int
    title: str
    description: str
    amis_json: str


@router.post("/internal/index")
async def index_adopted_template(
    request: IndexRequest,
    x_internal_key: str = Header(default=""),
):
    """将采纳的模板向量化并写入 embedding"""
    if x_internal_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=403, detail="forbidden")

    success = await index_template(
        template_id=request.template_id,
        title=request.title,
        description=request.description,
        amis_json=request.amis_json,
    )

    if success:
        return {"status": "ok", "message": f"模板 {request.template_id} 已向量化入库"}
    else:
        return {"status": "error", "message": "向量化失败"}


@router.post("/internal/cache/clear")
async def clear_llm_cache(
    x_internal_key: str = Header(default=""),
):
    """清除 LLM 配置缓存（后台模型配置变更时调用）"""
    if x_internal_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=403, detail="forbidden")

    count = clear_config_cache()
    return {"status": "ok", "cleared": count}
