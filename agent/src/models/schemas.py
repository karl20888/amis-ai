from pydantic import BaseModel


class GenerateRequest(BaseModel):
    prompt: str
    stream: bool = True
    category: str | None = None  # 可选的分类提示，用于 RAG 过滤


class GenerateResponse(BaseModel):
    amis_json: dict | str
    raw_content: str
    model_used: str | None = None
