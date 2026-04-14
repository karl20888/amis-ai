use axum::{
    extract::{Path, State, Query},
    http::StatusCode,
    Json,
    response::IntoResponse,
};
use sea_orm::{
    ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
};
use serde::Deserialize;
use serde_json::json;

use crate::entity::amis_template;

#[derive(Deserialize)]
pub struct TemplateQuery {
    pub page: Option<u64>,
    pub page_size: Option<u64>,
    pub category: Option<String>,
    pub search: Option<String>,
}

// GET /api/templates
pub async fn list_templates(
    State(state): State<crate::AppState>,
    Query(params): Query<TemplateQuery>,
) -> impl IntoResponse {
    let page = params.page.unwrap_or(1).max(1);
    let page_size = params.page_size.unwrap_or(20).min(100);

    let mut query = amis_template::Entity::find()
        .order_by_desc(amis_template::Column::CreatedAt);

    if let Some(cat) = &params.category {
        if !cat.is_empty() {
            query = query.filter(amis_template::Column::Category.eq(cat.as_str()));
        }
    }

    if let Some(search) = &params.search {
        if !search.is_empty() {
            query = query.filter(amis_template::Column::Title.contains(search.as_str()));
        }
    }

    let paginator = query.paginate(&state.db, page_size);
    let total = paginator.num_items().await.unwrap_or(0);
    let items = paginator.fetch_page(page - 1).await.unwrap_or_default();

    Json(json!({
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    })).into_response()
}

// GET /api/templates/:id
pub async fn get_template(
    State(state): State<crate::AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    match amis_template::Entity::find_by_id(id).one(&state.db).await {
        Ok(Some(record)) => Json(record).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, Json(json!({"error": "模板不存在"}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}
