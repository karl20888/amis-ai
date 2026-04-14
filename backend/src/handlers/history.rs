use axum::{
    extract::{Path, State, Query},
    http::StatusCode,
    Json,
    response::IntoResponse,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel,
    PaginatorTrait, QueryFilter, QueryOrder, Set,
};
use serde::Deserialize;
use serde_json::json;

use crate::entity::{generation_history, amis_template};
use crate::utils::jwt;

// ---- 生成历史 CRUD ----

#[derive(Deserialize)]
pub struct CreateHistoryRequest {
    pub user_prompt: String,
    pub generated_json: String,
    pub model_used: Option<String>,
}

#[derive(Deserialize)]
pub struct AdoptRequest {
    pub final_json: String,
    pub title: Option<String>,
    pub category: Option<String>,
}

#[derive(Deserialize)]
pub struct HistoryQuery {
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

// GET /api/history
pub async fn list_history(
    State(state): State<crate::AppState>,
    auth_user: jwt::AuthUser,
    Query(params): Query<HistoryQuery>,
) -> impl IntoResponse {
    // 先查用户 ID
    let user = crate::entity::user::Entity::find()
        .filter(crate::entity::user::Column::Username.eq(&auth_user.username))
        .one(&state.db)
        .await;

    let user = match user {
        Ok(Some(u)) => u,
        _ => return (StatusCode::UNAUTHORIZED, Json(json!({"error": "用户不存在"}))).into_response(),
    };

    let page = params.page.unwrap_or(1).max(1);
    let page_size = params.page_size.unwrap_or(20).min(100);

    let paginator = generation_history::Entity::find()
        .filter(generation_history::Column::UserId.eq(user.id))
        .order_by_desc(generation_history::Column::CreatedAt)
        .paginate(&state.db, page_size);

    let total = paginator.num_items().await.unwrap_or(0);
    let items = paginator.fetch_page(page - 1).await.unwrap_or_default();

    Json(json!({
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    })).into_response()
}

// GET /api/history/:id
pub async fn get_history(
    State(state): State<crate::AppState>,
    _auth_user: jwt::AuthUser,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    match generation_history::Entity::find_by_id(id).one(&state.db).await {
        Ok(Some(record)) => Json(record).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"error": "记录不存在"}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

// POST /api/history — Python 服务回调写入
pub async fn create_history(
    State(state): State<crate::AppState>,
    auth_user: jwt::AuthUser,
    Json(payload): Json<CreateHistoryRequest>,
) -> impl IntoResponse {
    let user = crate::entity::user::Entity::find()
        .filter(crate::entity::user::Column::Username.eq(&auth_user.username))
        .one(&state.db)
        .await;

    let user = match user {
        Ok(Some(u)) => u,
        _ => return (StatusCode::UNAUTHORIZED, Json(json!({"error": "用户不存在"}))).into_response(),
    };

    let record = generation_history::ActiveModel {
        user_id: Set(user.id),
        user_prompt: Set(payload.user_prompt),
        generated_json: Set(payload.generated_json),
        model_used: Set(payload.model_used),
        status: Set("generated".to_owned()),
        created_at: Set(chrono::Local::now().naive_local()),
        ..Default::default()
    };

    match record.insert(&state.db).await {
        Ok(saved) => (StatusCode::CREATED, Json(saved)).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

// PUT /api/history/:id/adopt — 采纳生成结果
pub async fn adopt_history(
    State(state): State<crate::AppState>,
    _auth_user: jwt::AuthUser,
    Path(id): Path<i32>,
    Json(payload): Json<AdoptRequest>,
) -> impl IntoResponse {
    let record = generation_history::Entity::find_by_id(id).one(&state.db).await;

    match record {
        Ok(Some(record)) => {
            // 1. 更新 history 状态
            let mut active: generation_history::ActiveModel = record.clone().into_active_model();
            active.status = Set("adopted".to_owned());
            active.final_json = Set(Some(payload.final_json.clone()));
            active.adopted_at = Set(Some(chrono::Local::now().naive_local()));

            let updated = match active.update(&state.db).await {
                Ok(u) => u,
                Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
            };

            // 2. 创建 amis_template 记录
            let title = payload.title.unwrap_or_else(|| {
                let prompt = &record.user_prompt;
                if prompt.len() > 50 { format!("{}...", &prompt[..50]) } else { prompt.clone() }
            });
            let category = payload.category;

            let template = amis_template::ActiveModel {
                title: Set(title.clone()),
                description: Set(Some(record.user_prompt.clone())),
                amis_json: Set(payload.final_json.clone()),
                category: Set(category.clone()),
                source: Set("user_adopted".to_owned()),
                source_history_id: Set(Some(id)),
                quality_score: Set(Some(0.5)),
                usage_count: Set(Some(0)),
                created_at: Set(chrono::Local::now().naive_local()),
                ..Default::default()
            };

            let template = match template.insert(&state.db).await {
                Ok(t) => t,
                Err(e) => {
                    tracing::error!("创建模板失败: {}", e);
                    return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response();
                }
            };

            // 3. 异步通知 Python 服务向量化
            let agent_url = std::env::var("AGENT_URL")
                .unwrap_or_else(|_| "http://localhost:8000".to_string());
            let internal_key = std::env::var("INTERNAL_API_KEY")
                .unwrap_or_default();
            let http_client = state.http_client.clone();
            let template_id = template.id;
            let description = record.user_prompt.clone();
            let amis_json = payload.final_json.clone();

            tokio::spawn(async move {
                let _ = http_client
                    .post(format!("{}/internal/index", agent_url))
                    .header("X-Internal-Key", &internal_key)
                    .json(&json!({
                        "template_id": template_id,
                        "title": title,
                        "description": description,
                        "amis_json": amis_json,
                    }))
                    .timeout(std::time::Duration::from_secs(30))
                    .send()
                    .await;
            });

            Json(json!({
                "message": "已采纳",
                "history": updated,
                "template_id": template.id,
            })).into_response()
        }
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"error": "记录不存在"}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

// DELETE /api/history/:id
pub async fn delete_history(
    State(state): State<crate::AppState>,
    _auth_user: jwt::AuthUser,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    match generation_history::Entity::delete_by_id(id).exec(&state.db).await {
        Ok(res) => {
            if res.rows_affected > 0 {
                Json(json!({"message": "已删除"})).into_response()
            } else {
                (StatusCode::NOT_FOUND, Json(json!({"error": "记录不存在"}))).into_response()
            }
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}
