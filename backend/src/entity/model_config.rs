use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "model_configs")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub task_type: String,
    pub provider_id: i32,
    pub model_name: String,
    pub temperature: f32,
    pub max_tokens: Option<i32>,
    pub is_active: bool,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::llm_provider::Entity",
        from = "Column::ProviderId",
        to = "super::llm_provider::Column::Id"
    )]
    Provider,
}

impl Related<super::llm_provider::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Provider.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
