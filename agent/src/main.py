"""amis-ai 智能体服务入口"""

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import generate, health, internal
from .services.db import close_pool
from .knowledge.loader import init_knowledge_base


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化知识库，关闭时清理连接池"""
    # 启动
    try:
        await init_knowledge_base()
    except Exception as e:
        print(f"[启动] 知识库初始化失败（不影响服务运行）: {e}")

    yield

    # 关闭
    await close_pool()


app = FastAPI(
    title="amis-ai Agent",
    description="AI 辅助生成 amis JSON 配置的智能体服务",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS（开发阶段全放开）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(health.router, tags=["健康检查"])
app.include_router(generate.router, tags=["生成"])
app.include_router(internal.router, tags=["内部"])


@app.get("/")
async def root():
    return {"service": "amis-ai-agent", "version": "0.1.0"}
