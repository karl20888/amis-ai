# amis-ai 开发指南

## 项目简介
AI 辅助生成 amis JSON 配置的智能体产品。用户通过自然语言描述需求，AI 自动生成 amis JSON 配置，支持实时预览、编辑、采纳，形成 RAG 自学习飞轮。

## 技术栈
- **后台管理服务**: Rust (Axum 0.7 + SeaORM + PostgreSQL)，端口 8080
- **智能体服务**: Python (FastAPI)，端口 8000
- **前端**: React 19 + TypeScript + Ant Design 5 + amis SDK，端口 5173
- **数据库**: PostgreSQL + pgvector 扩展
- **反向代理**: Nginx，端口 80

## 项目结构
```
amis-ai/
├── frontend/          # React 前端（Vite + TypeScript）
├── backend/           # Rust 后台管理服务（Axum）
├── agent/             # Python 智能体服务（FastAPI）
└── shared/            # 共享配置（Docker、Nginx、脚本）
```

## 开发规范
- 所有回复和注释使用中文
- 后端 Rust 代码遵循标准 Rust 风格（cargo fmt / clippy）
- 前端使用 TypeScript 严格模式
- Python 代码遵循 PEP 8
- 不要主动提交代码或启动测试服务，需要用户允许

## 常用命令
```bash
# 启动所有服务
docker-compose up -d

# 前端开发
cd frontend && pnpm dev

# 后端开发
cd backend && cargo run

# 智能体服务开发
cd agent && uv run uvicorn src.main:app --reload --port 8000
```

## 参考项目
- LLM 配置管理参考: ~/Working/creation/timecraft-novel
  - 后端 LLM 管理: backend/src/handlers/llm_admin.rs
  - LLM 工具模块: backend/src/utils/llm.rs
  - JWT 认证: backend/src/utils/jwt.rs
