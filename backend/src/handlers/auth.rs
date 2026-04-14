use axum::{
    extract::State,
    http::StatusCode,
    Json,
    response::IntoResponse,
};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use serde::{Deserialize, Serialize};
use serde_json::json;
use chrono::Local;

use crate::entity::user;
use crate::utils::{hash, jwt};

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    pub email: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: user::Model,
}

fn validate_username(username: &str) -> Result<(), String> {
    if username.is_empty() {
        return Err("用户名不能为空".to_string());
    }
    if username.len() < 2 || username.len() > 20 {
        return Err("用户名长度必须在 2-20 个字符之间".to_string());
    }
    Ok(())
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.len() < 6 {
        return Err("密码长度至少为 6 个字符".to_string());
    }
    if password.len() > 100 {
        return Err("密码长度不能超过 100 个字符".to_string());
    }
    Ok(())
}

fn validate_email(email: &str) -> Result<(), String> {
    if email.is_empty() {
        return Err("邮箱不能为空".to_string());
    }
    if !email.contains('@') || !email.contains('.') {
        return Err("邮箱格式不正确".to_string());
    }
    Ok(())
}

pub async fn register(
    State(state): State<crate::AppState>,
    Json(payload): Json<RegisterRequest>,
) -> impl IntoResponse {
    if let Err(e) = validate_username(&payload.username) {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response();
    }
    if let Err(e) = validate_password(&payload.password) {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response();
    }
    if let Err(e) = validate_email(&payload.email) {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": e}))).into_response();
    }

    let exists = match user::Entity::find()
        .filter(user::Column::Username.eq(&payload.username))
        .one(&state.db)
        .await
    {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("数据库查询错误: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "服务器内部错误"}))).into_response();
        }
    };

    if exists.is_some() {
        return (StatusCode::CONFLICT, Json(json!({"error": "用户名已存在"}))).into_response();
    }

    let password_hash = hash::hash_password(&payload.password);

    let new_user = user::ActiveModel {
        username: Set(payload.username.clone()),
        password: Set(password_hash),
        email: Set(payload.email),
        is_active: Set(true),
        created_at: Set(Local::now().naive_local()),
        ..Default::default()
    };

    match new_user.insert(&state.db).await {
        Ok(user) => {
            match jwt::sign(user.username.clone()) {
                Ok(token) => {
                    tracing::info!("新用户注册: {}", user.username);
                    (StatusCode::CREATED, Json(AuthResponse { token, user })).into_response()
                },
                Err(e) => {
                    tracing::error!("JWT 签名错误: {}", e);
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "令牌生成失败"}))).into_response()
                }
            }
        },
        Err(e) => {
            tracing::error!("用户创建错误: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "用户创建失败"}))).into_response()
        }
    }
}

pub async fn login(
    State(state): State<crate::AppState>,
    Json(payload): Json<LoginRequest>,
) -> impl IntoResponse {
    if payload.username.is_empty() || payload.password.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "用户名和密码不能为空"}))).into_response();
    }

    let user = match user::Entity::find()
        .filter(user::Column::Username.eq(&payload.username))
        .one(&state.db)
        .await
    {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("数据库查询错误: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "服务器内部错误"}))).into_response();
        }
    };

    if let Some(user) = user {
        if hash::verify_password(&payload.password, &user.password) {
            match jwt::sign(user.username.clone()) {
                Ok(token) => {
                    tracing::info!("用户登录: {}", user.username);
                    return (StatusCode::OK, Json(AuthResponse { token, user })).into_response();
                },
                Err(e) => {
                    tracing::error!("JWT 签名错误: {}", e);
                    return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "令牌生成失败"}))).into_response();
                }
            }
        }
    }

    (StatusCode::UNAUTHORIZED, Json(json!({"error": "用户名或密码错误"}))).into_response()
}

pub async fn get_profile(
    State(state): State<crate::AppState>,
    auth_user: jwt::AuthUser,
) -> impl IntoResponse {
    let user = match user::Entity::find()
        .filter(user::Column::Username.eq(&auth_user.username))
        .one(&state.db)
        .await
    {
        Ok(result) => result,
        Err(e) => {
            tracing::error!("数据库查询错误: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "服务器内部错误"}))).into_response();
        }
    };

    if let Some(user) = user {
        return (StatusCode::OK, Json(user)).into_response();
    }
    (StatusCode::NOT_FOUND, Json(json!({"error": "用户不存在"}))).into_response()
}
