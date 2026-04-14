"""知识库初始化加载器 — 将 amis 文档/示例切分、向量化、写入 PostgreSQL"""

import json
import os

from ..services.db import get_pool
from ..services.embedding import get_embeddings_batch


# amis 内置示例数据（初始知识库）
INITIAL_TEMPLATES = [
    {
        "title": "用户管理 CRUD",
        "description": "包含姓名、邮箱、角色、状态的用户管理增删改查页面",
        "category": "crud",
        "amis_json": json.dumps({
            "type": "page",
            "title": "用户管理",
            "body": {
                "type": "crud",
                "api": "/api/users",
                "syncLocation": False,
                "columns": [
                    {"name": "id", "label": "ID", "sortable": True},
                    {"name": "name", "label": "姓名", "searchable": True},
                    {"name": "email", "label": "邮箱"},
                    {"name": "role", "label": "角色", "type": "mapping", "map": {"admin": "管理员", "user": "普通用户"}},
                    {"name": "status", "label": "状态", "type": "status"},
                    {"type": "operation", "label": "操作", "buttons": [
                        {"type": "button", "label": "编辑", "actionType": "dialog", "level": "link", "dialog": {
                            "title": "编辑用户", "body": {"type": "form", "api": "put:/api/users/$id", "body": [
                                {"type": "input-text", "name": "name", "label": "姓名", "required": True},
                                {"type": "input-email", "name": "email", "label": "邮箱", "required": True},
                                {"type": "select", "name": "role", "label": "角色", "options": [{"label": "管理员", "value": "admin"}, {"label": "普通用户", "value": "user"}]}
                            ]}
                        }},
                        {"type": "button", "label": "删除", "actionType": "ajax", "level": "danger", "confirmText": "确定要删除该用户吗？", "api": "delete:/api/users/$id"}
                    ]}
                ],
                "headerToolbar": [
                    {"type": "button", "label": "新增用户", "actionType": "dialog", "level": "primary", "dialog": {
                        "title": "新增用户", "body": {"type": "form", "api": "post:/api/users", "body": [
                            {"type": "input-text", "name": "name", "label": "姓名", "required": True},
                            {"type": "input-email", "name": "email", "label": "邮箱", "required": True},
                            {"type": "input-password", "name": "password", "label": "密码", "required": True},
                            {"type": "select", "name": "role", "label": "角色", "value": "user", "options": [{"label": "管理员", "value": "admin"}, {"label": "普通用户", "value": "user"}]}
                        ]}
                    }},
                    "bulkActions"
                ],
                "filter": {
                    "title": "搜索",
                    "body": [
                        {"type": "input-text", "name": "name", "label": "姓名", "placeholder": "请输入姓名"},
                        {"type": "select", "name": "role", "label": "角色", "options": [{"label": "全部", "value": ""}, {"label": "管理员", "value": "admin"}, {"label": "普通用户", "value": "user"}]}
                    ]
                }
            }
        }, ensure_ascii=False),
    },
    {
        "title": "登录表单",
        "description": "包含用户名、密码、验证码和记住我的登录表单页面",
        "category": "form",
        "amis_json": json.dumps({
            "type": "page",
            "body": {
                "type": "wrapper",
                "className": "p-lg",
                "body": {
                    "type": "form",
                    "api": "/api/auth/login",
                    "title": "用户登录",
                    "mode": "horizontal",
                    "autoFocus": True,
                    "body": [
                        {"type": "input-text", "name": "username", "label": "用户名", "required": True, "placeholder": "请输入用户名"},
                        {"type": "input-password", "name": "password", "label": "密码", "required": True, "placeholder": "请输入密码"},
                        {"type": "input-text", "name": "captcha", "label": "验证码", "required": True, "placeholder": "请输入验证码"},
                        {"type": "checkbox", "name": "remember", "label": "记住我", "option": "7天内自动登录"}
                    ],
                    "submitText": "登录"
                }
            }
        }, ensure_ascii=False),
    },
    {
        "title": "数据仪表盘",
        "description": "包含统计卡片和图表的数据仪表盘页面",
        "category": "dashboard",
        "amis_json": json.dumps({
            "type": "page",
            "title": "数据仪表盘",
            "body": [
                {
                    "type": "grid",
                    "columns": [
                        {"body": {"type": "panel", "title": "总用户数", "body": {"type": "tpl", "tpl": "<div style='font-size:36px;font-weight:bold;color:#1890ff'>12,345</div><div style='color:#999'>较昨日 +2.5%</div>"}}},
                        {"body": {"type": "panel", "title": "今日访问", "body": {"type": "tpl", "tpl": "<div style='font-size:36px;font-weight:bold;color:#52c41a'>8,901</div><div style='color:#999'>较昨日 +5.2%</div>"}}},
                        {"body": {"type": "panel", "title": "订单总额", "body": {"type": "tpl", "tpl": "<div style='font-size:36px;font-weight:bold;color:#fa8c16'>¥98,765</div><div style='color:#999'>较昨日 +1.8%</div>"}}},
                        {"body": {"type": "panel", "title": "转化率", "body": {"type": "tpl", "tpl": "<div style='font-size:36px;font-weight:bold;color:#722ed1'>3.2%</div><div style='color:#999'>较昨日 -0.3%</div>"}}}
                    ]
                },
                {
                    "type": "panel",
                    "title": "访问趋势",
                    "body": {
                        "type": "chart",
                        "config": {
                            "xAxis": {"type": "category", "data": ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]},
                            "yAxis": {"type": "value"},
                            "series": [{"data": [820, 932, 901, 934, 1290, 1330, 1320], "type": "line", "smooth": True}],
                            "tooltip": {"trigger": "axis"}
                        }
                    }
                }
            ]
        }, ensure_ascii=False),
    },
    {
        "title": "商品管理 CRUD",
        "description": "包含商品名称、价格、库存、分类、状态的商品管理增删改查页面",
        "category": "crud",
        "amis_json": json.dumps({
            "type": "page",
            "title": "商品管理",
            "body": {
                "type": "crud",
                "api": "/api/products",
                "syncLocation": False,
                "columns": [
                    {"name": "id", "label": "ID", "width": 60},
                    {"name": "name", "label": "商品名称", "searchable": True},
                    {"name": "price", "label": "价格", "type": "tpl", "tpl": "¥${price}"},
                    {"name": "stock", "label": "库存"},
                    {"name": "category", "label": "分类"},
                    {"name": "status", "label": "状态", "type": "mapping", "map": {"on": "<span class='label label-success'>上架</span>", "off": "<span class='label label-default'>下架</span>"}},
                    {"type": "operation", "label": "操作", "buttons": [
                        {"type": "button", "label": "编辑", "actionType": "dialog", "level": "link", "dialog": {
                            "title": "编辑商品", "body": {"type": "form", "api": "put:/api/products/$id", "body": [
                                {"type": "input-text", "name": "name", "label": "商品名称", "required": True},
                                {"type": "input-number", "name": "price", "label": "价格", "required": True, "precision": 2},
                                {"type": "input-number", "name": "stock", "label": "库存"},
                                {"type": "select", "name": "category", "label": "分类", "options": ["电子产品", "服装", "食品", "家居"]},
                                {"type": "switch", "name": "status", "label": "上架", "onText": "上架", "offText": "下架", "trueValue": "on", "falseValue": "off"}
                            ]}
                        }}
                    ]}
                ],
                "headerToolbar": ["bulkActions", {"type": "button", "label": "新增商品", "actionType": "dialog", "level": "primary", "dialog": {
                    "title": "新增商品", "body": {"type": "form", "api": "post:/api/products", "body": [
                        {"type": "input-text", "name": "name", "label": "商品名称", "required": True},
                        {"type": "input-number", "name": "price", "label": "价格", "required": True, "precision": 2},
                        {"type": "input-number", "name": "stock", "label": "库存", "value": 0},
                        {"type": "select", "name": "category", "label": "分类", "options": ["电子产品", "服装", "食品", "家居"]},
                        {"type": "switch", "name": "status", "label": "上架", "value": "on", "trueValue": "on", "falseValue": "off"}
                    ]}
                }}],
                "filter": {
                    "title": "搜索",
                    "body": [
                        {"type": "input-text", "name": "name", "label": "商品名称"},
                        {"type": "select", "name": "category", "label": "分类", "options": [{"label": "全部", "value": ""}, "电子产品", "服装", "食品", "家居"]}
                    ]
                }
            }
        }, ensure_ascii=False),
    },
    {
        "title": "多步骤向导表单",
        "description": "分步骤填写的向导表单，包含基本信息、详细信息、确认提交三个步骤",
        "category": "wizard",
        "amis_json": json.dumps({
            "type": "page",
            "title": "信息登记",
            "body": {
                "type": "wizard",
                "api": "/api/submissions",
                "steps": [
                    {
                        "title": "基本信息",
                        "body": [
                            {"type": "input-text", "name": "name", "label": "姓名", "required": True},
                            {"type": "input-text", "name": "phone", "label": "手机号", "required": True, "validations": {"isPhoneNumber": True}},
                            {"type": "input-email", "name": "email", "label": "邮箱"}
                        ]
                    },
                    {
                        "title": "详细信息",
                        "body": [
                            {"type": "select", "name": "department", "label": "部门", "options": ["技术部", "产品部", "市场部", "运营部"], "required": True},
                            {"type": "input-date", "name": "join_date", "label": "入职日期"},
                            {"type": "textarea", "name": "remark", "label": "备注", "placeholder": "请输入备注信息"}
                        ]
                    },
                    {
                        "title": "确认提交",
                        "body": [
                            {"type": "static", "name": "name", "label": "姓名"},
                            {"type": "static", "name": "phone", "label": "手机号"},
                            {"type": "static", "name": "email", "label": "邮箱"},
                            {"type": "static", "name": "department", "label": "部门"},
                            {"type": "static", "name": "join_date", "label": "入职日期"},
                            {"type": "static", "name": "remark", "label": "备注"}
                        ]
                    }
                ]
            }
        }, ensure_ascii=False),
    },
]


async def init_knowledge_base():
    """初始化知识库：将内置示例写入数据库并向量化"""
    pool = await get_pool()

    async with pool.acquire() as conn:
        # 检查是否已有 official 数据
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM amis_templates WHERE source = 'official'"
        )
        if count > 0:
            print(f"[知识库] 已有 {count} 条官方数据，跳过初始化")
            return

    print("[知识库] 开始初始化...")

    # 1. 写入模板数据
    template_ids = []
    texts_to_embed = []

    async with pool.acquire() as conn:
        for tpl in INITIAL_TEMPLATES:
            row = await conn.fetchrow(
                """
                INSERT INTO amis_templates (title, description, amis_json, category, source, quality_score)
                VALUES ($1, $2, $3, $4, 'official', 0.8)
                RETURNING id
                """,
                tpl["title"],
                tpl["description"],
                tpl["amis_json"],
                tpl["category"],
            )
            template_ids.append(row["id"])
            texts_to_embed.append(f"{tpl['title']}\n{tpl['description']}")

    print(f"[知识库] 已写入 {len(template_ids)} 条模板数据")

    # 2. 批量向量化
    try:
        embeddings = await get_embeddings_batch(texts_to_embed)

        async with pool.acquire() as conn:
            for tid, emb in zip(template_ids, embeddings):
                embedding_str = "[" + ",".join(str(x) for x in emb) + "]"
                await conn.execute(
                    "UPDATE amis_templates SET embedding = $1::vector WHERE id = $2",
                    embedding_str,
                    tid,
                )

        print(f"[知识库] 已完成 {len(embeddings)} 条向量化")
    except Exception as e:
        print(f"[知识库] 向量化失败（可稍后重试）: {e}")
        print("[知识库] 模板数据已写入，但 embedding 为空。配置好 embedding 模型后可重新运行向量化。")
