use axum::{
    extract::{Path, State},
    http::{StatusCode, HeaderMap},
    Json,
    response::IntoResponse,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel,
    PaginatorTrait, QueryFilter, Set,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::entity::{llm_provider, model_config};

// ========================
//  供应商 (Provider) CRUD
// ========================

#[derive(Deserialize)]
pub struct CreateProviderRequest {
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub is_active: Option<bool>,
}

#[derive(Deserialize)]
pub struct UpdateProviderRequest {
    pub name: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Serialize)]
pub struct ProviderResponse {
    pub id: i32,
    pub name: String,
    pub base_url: String,
    pub api_key_hint: String,
    pub is_active: bool,
    pub created_at: chrono::NaiveDateTime,
}

impl From<llm_provider::Model> for ProviderResponse {
    fn from(p: llm_provider::Model) -> Self {
        let hint = if p.api_key.len() > 4 {
            format!("****{}", &p.api_key[p.api_key.len() - 4..])
        } else {
            "****".to_string()
        };
        ProviderResponse {
            id: p.id,
            name: p.name,
            base_url: p.base_url,
            api_key_hint: hint,
            is_active: p.is_active,
            created_at: p.created_at,
        }
    }
}

// GET /api/llm/providers
pub async fn list_providers(
    State(state): State<crate::AppState>,
) -> impl IntoResponse {
    match llm_provider::Entity::find().all(&state.db).await {
        Ok(providers) => {
            let resp: Vec<ProviderResponse> = providers.into_iter().map(Into::into).collect();
            Json(resp).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

// POST /api/llm/providers
pub async fn create_provider(
    State(state): State<crate::AppState>,
    Json(payload): Json<CreateProviderRequest>,
) -> impl IntoResponse {
    let new_provider = llm_provider::ActiveModel {
        name: Set(payload.name),
        base_url: Set(payload.base_url),
        api_key: Set(payload.api_key),
        is_active: Set(payload.is_active.unwrap_or(true)),
        created_at: Set(chrono::Local::now().naive_local()),
        ..Default::default()
    };

    match new_provider.insert(&state.db).await {
        Ok(provider) => {
            let resp: ProviderResponse = provider.into();
            (StatusCode::CREATED, Json(resp)).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

// PUT /api/llm/providers/:id
pub async fn update_provider(
    State(state): State<crate::AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateProviderRequest>,
) -> impl IntoResponse {
    let provider = llm_provider::Entity::find_by_id(id).one(&state.db).await;

    match provider {
        Ok(Some(model)) => {
            let mut active: llm_provider::ActiveModel = model.into_active_model();

            if let Some(name) = payload.name {
                active.name = Set(name);
            }
            if let Some(base_url) = payload.base_url {
                active.base_url = Set(base_url);
            }
            if let Some(api_key) = payload.api_key {
                active.api_key = Set(api_key);
            }
            if let Some(is_active) = payload.is_active {
                active.is_active = Set(is_active);
            }

            match active.update(&state.db).await {
                Ok(updated) => {
                    notify_agent_cache_clear(&state.http_client).await;
                    let resp: ProviderResponse = updated.into();
                    Json(resp).into_response()
                }
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"error": "供应商不存在"}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

// DELETE /api/llm/providers/:id
pub async fn delete_provider(
    State(state): State<crate::AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let config_count = model_config::Entity::find()
        .filter(model_config::Column::ProviderId.eq(id))
        .count(&state.db)
        .await
        .unwrap_or(0);

    if config_count > 0 {
        return (StatusCode::CONFLICT, Json(json!({
            "error": format!("该供应商下有 {} 条模型配置，请先删除相关配置", config_count)
        }))).into_response();
    }

    match llm_provider::Entity::delete_by_id(id).exec(&state.db).await {
        Ok(res) => {
            if res.rows_affected > 0 {
                Json(json!({"message": "已删除"})).into_response()
            } else {
                (StatusCode::NOT_FOUND, Json(json!({"error": "供应商不存在"}))).into_response()
            }
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

// POST /api/llm/providers/:id/test
pub async fn test_provider(
    State(state): State<crate::AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let provider = llm_provider::Entity::find_by_id(id).one(&state.db).await;

    match provider {
        Ok(Some(provider)) => {
            let url = format!("{}/models", provider.base_url);
            let result = state.http_client
                .get(&url)
                .header("Authorization", format!("Bearer {}", provider.api_key))
                .timeout(std::time::Duration::from_secs(10))
                .send()
                .await;

            match result {
                Ok(resp) => {
                    if resp.status().is_success() {
                        Json(json!({"status": "ok", "message": "连接成功"})).into_response()
                    } else {
                        let status = resp.status().as_u16();
                        let body = resp.text().await.unwrap_or_default();
                        (StatusCode::BAD_GATEWAY, Json(json!({
                            "status": "error",
                            "message": format!("API 返回 {}: {}", status, body)
                        }))).into_response()
                    }
                }
                Err(e) => {
                    (StatusCode::BAD_GATEWAY, Json(json!({
                        "status": "error",
                        "message": format!("连接失败: {}", e)
                    }))).into_response()
                }
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"error": "供应商不存在"}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

// GET /api/llm/providers/:id/models
pub async fn list_provider_models(
    State(state): State<crate::AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let provider = llm_provider::Entity::find_by_id(id).one(&state.db).await;

    match provider {
        Ok(Some(provider)) => {
            let url = format!("{}/models", provider.base_url);
            let result = state.http_client
                .get(&url)
                .header("Authorization", format!("Bearer {}", provider.api_key))
                .timeout(std::time::Duration::from_secs(10))
                .send()
                .await;

            match result {
                Ok(resp) if resp.status().is_success() => {
                    let body: serde_json::Value = resp.json().await.unwrap_or(json!({}));
                    let models: Vec<String> = body.get("data")
                        .and_then(|d| d.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    Json(json!({ "models": models })).into_response()
                }
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    (StatusCode::BAD_GATEWAY, Json(json!({
                        "error": format!("API 返回 {}", status),
                        "models": []
                    }))).into_response()
                }
                Err(e) => {
                    (StatusCode::BAD_GATEWAY, Json(json!({
                        "error": format!("连接失败: {}", e),
                        "models": []
                    }))).into_response()
                }
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"error": "供应商不存在"}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

// ============================
//  模型配置 (ModelConfig) CRUD
// ============================

const VALID_TASK_TYPES: [&str; 3] = ["generation", "embedding", "chat"];

#[derive(Deserialize)]
pub struct CreateModelConfigRequest {
    pub task_type: String,
    pub provider_id: i32,
    pub model_name: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<i32>,
    pub is_active: Option<bool>,
}

#[derive(Deserialize)]
pub struct UpdateModelConfigRequest {
    pub task_type: Option<String>,
    pub provider_id: Option<i32>,
    pub model_name: Option<String>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<Option<i32>>,
    pub is_active: Option<bool>,
}

#[derive(Serialize)]
pub struct ModelConfigResponse {
    pub id: i32,
    pub task_type: String,
    pub provider_id: i32,
    pub provider_name: String,
    pub model_name: String,
    pub temperature: f32,
    pub max_tokens: Option<i32>,
    pub is_active: bool,
}

// GET /api/llm/configs
pub async fn list_model_configs(
    State(state): State<crate::AppState>,
) -> impl IntoResponse {
    let configs = model_config::Entity::find()
        .find_also_related(llm_provider::Entity)
        .all(&state.db)
        .await;

    match configs {
        Ok(list) => {
            let resp: Vec<ModelConfigResponse> = list.into_iter().map(|(config, provider)| {
                ModelConfigResponse {
                    id: config.id,
                    task_type: config.task_type,
                    provider_id: config.provider_id,
                    provider_name: provider.map(|p| p.name).unwrap_or_else(|| "未知".to_string()),
                    model_name: config.model_name,
                    temperature: config.temperature,
                    max_tokens: config.max_tokens,
                    is_active: config.is_active,
                }
            }).collect();
            Json(resp).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

// POST /api/llm/configs
pub async fn create_model_config(
    State(state): State<crate::AppState>,
    Json(payload): Json<CreateModelConfigRequest>,
) -> impl IntoResponse {
    if !VALID_TASK_TYPES.contains(&payload.task_type.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "error": format!("无效的任务类型，可选: {:?}", VALID_TASK_TYPES)
        }))).into_response();
    }

    let provider_exists = llm_provider::Entity::find_by_id(payload.provider_id)
        .one(&state.db).await.unwrap_or(None);
    if provider_exists.is_none() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "指定的供应商不存在"}))).into_response();
    }

    let is_active = payload.is_active.unwrap_or(true);

    if is_active {
        deactivate_configs_for_task(&state.db, &payload.task_type).await;
    }

    let new_config = model_config::ActiveModel {
        task_type: Set(payload.task_type),
        provider_id: Set(payload.provider_id),
        model_name: Set(payload.model_name),
        temperature: Set(payload.temperature.unwrap_or(0.7)),
        max_tokens: Set(payload.max_tokens),
        is_active: Set(is_active),
        ..Default::default()
    };

    match new_config.insert(&state.db).await {
        Ok(config) => {
            notify_agent_cache_clear(&state.http_client).await;
            (StatusCode::CREATED, Json(config)).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

// PUT /api/llm/configs/:id
pub async fn update_model_config(
    State(state): State<crate::AppState>,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateModelConfigRequest>,
) -> impl IntoResponse {
    let config = model_config::Entity::find_by_id(id).one(&state.db).await;

    match config {
        Ok(Some(model)) => {
            let task_type = payload.task_type.as_deref()
                .unwrap_or(&model.task_type)
                .to_string();

            if let Some(ref tt) = payload.task_type {
                if !VALID_TASK_TYPES.contains(&tt.as_str()) {
                    return (StatusCode::BAD_REQUEST, Json(json!({
                        "error": format!("无效的任务类型，可选: {:?}", VALID_TASK_TYPES)
                    }))).into_response();
                }
            }

            if payload.is_active == Some(true) && !model.is_active {
                deactivate_configs_for_task(&state.db, &task_type).await;
            }

            let mut active: model_config::ActiveModel = model.into_active_model();

            if let Some(tt) = payload.task_type {
                active.task_type = Set(tt);
            }
            if let Some(pid) = payload.provider_id {
                active.provider_id = Set(pid);
            }
            if let Some(mn) = payload.model_name {
                active.model_name = Set(mn);
            }
            if let Some(temp) = payload.temperature {
                active.temperature = Set(temp);
            }
            if let Some(mt) = payload.max_tokens {
                active.max_tokens = Set(mt);
            }
            if let Some(ia) = payload.is_active {
                active.is_active = Set(ia);
            }

            match active.update(&state.db).await {
                Ok(updated) => {
                    notify_agent_cache_clear(&state.http_client).await;
                    Json(updated).into_response()
                }
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
            }
        }
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"error": "配置不存在"}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

// DELETE /api/llm/configs/:id
pub async fn delete_model_config(
    State(state): State<crate::AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    match model_config::Entity::delete_by_id(id).exec(&state.db).await {
        Ok(res) => {
            if res.rows_affected > 0 {
                notify_agent_cache_clear(&state.http_client).await;
                Json(json!({"message": "已删除"})).into_response()
            } else {
                (StatusCode::NOT_FOUND, Json(json!({"error": "配置不存在"}))).into_response()
            }
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

// ============================
//  内部 API（供 Python 服务调用）
// ============================

// GET /api/internal/llm/resolve/:task_type
pub async fn resolve_llm_config(
    State(state): State<crate::AppState>,
    Path(task_type): Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    // 校验内部密钥
    let expected = std::env::var("INTERNAL_API_KEY").unwrap_or_default();
    let provided = headers.get("X-Internal-Key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if provided != expected {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "forbidden"}))).into_response();
    }

    // 查找活跃的模型配置
    let config = model_config::Entity::find()
        .filter(model_config::Column::TaskType.eq(&task_type))
        .filter(model_config::Column::IsActive.eq(true))
        .one(&state.db)
        .await;

    match config {
        Ok(Some(config)) => {
            // 加载关联的供应商
            let provider = llm_provider::Entity::find_by_id(config.provider_id)
                .one(&state.db)
                .await;

            match provider {
                Ok(Some(provider)) if provider.is_active => {
                    Json(json!({
                        "base_url": provider.base_url,
                        "api_key": provider.api_key,
                        "model": config.model_name,
                        "temperature": config.temperature,
                        "max_tokens": config.max_tokens,
                    })).into_response()
                }
                Ok(Some(_)) => {
                    // 供应商未启用，回退到环境变量
                    fallback_config(&task_type).into_response()
                }
                _ => fallback_config(&task_type).into_response(),
            }
        }
        Ok(None) => {
            // 无活跃配置，回退到环境变量
            fallback_config(&task_type).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

/// 回退到环境变量配置
fn fallback_config(task_type: &str) -> Json<serde_json::Value> {
    let base_url = std::env::var("LLM_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:8045/v1".to_string());
    let api_key = std::env::var("LLM_API_KEY")
        .unwrap_or_else(|_| "sk-placeholder".to_string());
    let model = std::env::var("LLM_MODEL")
        .unwrap_or_else(|_| "deepseek-chat".to_string());

    let (temperature, max_tokens) = match task_type {
        "generation" => (0.7, Some(8192)),
        "embedding" => (0.0, None),
        "chat" => (0.7, Some(4096)),
        _ => (0.7, Some(4096)),
    };

    Json(json!({
        "base_url": base_url,
        "api_key": api_key,
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "fallback": true,
    }))
}

// ---- 辅助函数 ----

/// 通知 Agent 服务清除 LLM 配置缓存（fire-and-forget）
async fn notify_agent_cache_clear(client: &reqwest::Client) {
    let agent_url = std::env::var("AGENT_URL")
        .unwrap_or_else(|_| "http://localhost:8000".to_string());
    let internal_key = std::env::var("INTERNAL_API_KEY").unwrap_or_default();

    let _ = client
        .post(format!("{}/internal/cache/clear", agent_url))
        .header("X-Internal-Key", internal_key)
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await;
}

async fn deactivate_configs_for_task(db: &sea_orm::DatabaseConnection, task_type: &str) {
    let active_configs = model_config::Entity::find()
        .filter(model_config::Column::TaskType.eq(task_type))
        .filter(model_config::Column::IsActive.eq(true))
        .all(db)
        .await
        .unwrap_or_default();

    for config in active_configs {
        let mut active: model_config::ActiveModel = config.into_active_model();
        active.is_active = Set(false);
        let _ = active.update(db).await;
    }
}
