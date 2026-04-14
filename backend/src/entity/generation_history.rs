use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "generation_history")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub user_id: i32,
    #[sea_orm(column_type = "Text")]
    pub user_prompt: String,
    #[sea_orm(column_type = "Text")]
    pub generated_json: String,
    pub model_used: Option<String>,
    pub status: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub feedback: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub final_json: Option<String>,
    pub created_at: DateTime,
    pub adopted_at: Option<DateTime>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::user::Entity",
        from = "Column::UserId",
        to = "super::user::Column::Id"
    )]
    User,
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
