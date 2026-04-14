use axum::{
    routing::{get, post, put},
    Router,
};
use sea_orm::{Database, DatabaseConnection, ConnectionTrait, EntityTrait, PaginatorTrait, Set, Schema, ActiveModelTrait};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod entity;
mod utils;
mod handlers;
use entity::{user, llm_provider, model_config, generation_history, amis_template};

#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub http_client: reqwest::Client,
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new("debug"))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // 连接 PostgreSQL
    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://amis_ai:amis_ai_dev@localhost:5432/amis_ai".to_string());
    let db = Database::connect(&db_url).await.expect("无法连接到数据库");

    // 启用 pgvector 扩展
    let _ = db.execute_unprepared("CREATE EXTENSION IF NOT EXISTS vector").await;

    // 自动建表
    let builder = db.get_database_backend();
    let schema = Schema::new(builder);

    let _ = db.execute(builder.build(&schema.create_table_from_entity(user::Entity))).await;
    let _ = db.execute(builder.build(&schema.create_table_from_entity(llm_provider::Entity))).await;
    let _ = db.execute(builder.build(&schema.create_table_from_entity(model_config::Entity))).await;
    let _ = db.execute(builder.build(&schema.create_table_from_entity(generation_history::Entity))).await;
    let _ = db.execute(builder.build(&schema.create_table_from_entity(amis_template::Entity))).await;

    // pgvector embedding 列和索引（SeaORM 不支持 vector 类型，需要手动 DDL）
    let _ = db.execute_unprepared(
        "DO $$ BEGIN
            ALTER TABLE amis_templates ADD COLUMN IF NOT EXISTS embedding vector(1536);
        EXCEPTION WHEN others THEN NULL;
        END $$;"
    ).await;
    let _ = db.execute_unprepared(
        "CREATE INDEX IF NOT EXISTS idx_amis_templates_embedding
         ON amis_templates USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    ).await;

    // 种子数据
    seed_users(&db).await;
    seed_llm_configs(&db).await;

    // 共享状态
    let state = AppState {
        db,
        http_client: reqwest::Client::new(),
    };

    // CORS（开发阶段全放开）
    let cors = CorsLayer::permissive();

    // 路由
    let app = Router::new()
        // 认证
        .route("/api/auth/register", post(handlers::auth::register))
        .route("/api/auth/login", post(handlers::auth::login))
        .route("/api/user/profile", get(handlers::auth::get_profile))
        // LLM 供应商管理
        .route("/api/llm/providers", get(handlers::llm_admin::list_providers).post(handlers::llm_admin::create_provider))
        .route("/api/llm/providers/:id", put(handlers::llm_admin::update_provider).delete(handlers::llm_admin::delete_provider))
        .route("/api/llm/providers/:id/test", post(handlers::llm_admin::test_provider))
        .route("/api/llm/providers/:id/models", get(handlers::llm_admin::list_provider_models))
        // LLM 模型配置管理
        .route("/api/llm/configs", get(handlers::llm_admin::list_model_configs).post(handlers::llm_admin::create_model_config))
        .route("/api/llm/configs/:id", put(handlers::llm_admin::update_model_config).delete(handlers::llm_admin::delete_model_config))
        // 生成历史管理
        .route("/api/history", get(handlers::history::list_history).post(handlers::history::create_history))
        .route("/api/history/:id", get(handlers::history::get_history).delete(handlers::history::delete_history))
        .route("/api/history/:id/adopt", put(handlers::history::adopt_history))
        // 模板库
        .route("/api/templates", get(handlers::template::list_templates))
        .route("/api/templates/:id", get(handlers::template::get_template))
        // 内部 API（供 Python 服务调用）
        .route("/api/internal/llm/resolve/:task_type", get(handlers::llm_admin::resolve_llm_config))
        // 健康检查
        .route("/api/health", get(health_check))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => {
            tracing::info!("🚀 amis-ai 后台服务已启动，监听地址: {}", addr);
            listener
        }
        Err(e) => {
            tracing::error!("无法绑定到端口 {}: {}", addr, e);
            panic!("服务器启动失败");
        }
    };

    axum::serve(listener, app).await.unwrap();
}

async fn health_check() -> &'static str {
    "ok"
}

async fn seed_users(db: &DatabaseConnection) {
    let count = user::Entity::find().count(db).await.unwrap();
    if count == 0 {
        let admin = user::ActiveModel {
            username: Set("admin".to_owned()),
            password: Set(utils::hash::hash_password("admin123")),
            email: Set("admin@amis-ai.com".to_owned()),
            is_active: Set(true),
            created_at: Set(chrono::Local::now().naive_local()),
            ..Default::default()
        };

        user::Entity::insert(admin).exec(db).await.unwrap();
        tracing::info!("已初始化管理员账号 (admin/admin123)");
    }
}

async fn seed_llm_configs(db: &DatabaseConnection) {
    let count = llm_provider::Entity::find().count(db).await.unwrap();
    if count == 0 {
        let base_url = std::env::var("LLM_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:8045/v1".to_string());
        let api_key = std::env::var("LLM_API_KEY")
            .unwrap_or_else(|_| "sk-placeholder".to_string());

        let provider = llm_provider::ActiveModel {
            name: Set("默认服务商".to_owned()),
            base_url: Set(base_url),
            api_key: Set(api_key),
            is_active: Set(true),
            created_at: Set(chrono::Local::now().naive_local()),
            ..Default::default()
        };
        let provider = provider.insert(db).await.unwrap();

        let configs = vec![
            ("generation", "deepseek-chat",          0.7_f32, Some(8192_i32)),
            ("embedding",  "text-embedding-3-small", 0.0,     None),
            ("chat",       "deepseek-chat",          0.7,     Some(4096)),
        ];

        for (task, model, temp, max_tok) in configs {
            model_config::ActiveModel {
                task_type: Set(task.to_owned()),
                provider_id: Set(provider.id),
                model_name: Set(model.to_owned()),
                temperature: Set(temp),
                max_tokens: Set(max_tok),
                is_active: Set(true),
                ..Default::default()
            }.insert(db).await.unwrap();
        }

        tracing::info!("已初始化 LLM 供应商和模型配置");
    }
}
