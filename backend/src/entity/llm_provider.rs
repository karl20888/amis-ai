use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "llm_providers")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub name: String,
    pub base_url: String,
    #[serde(skip_serializing)]
    pub api_key: String,
    pub is_active: bool,
    pub created_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::model_config::Entity")]
    ModelConfig,
}

impl Related<super::model_config::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ModelConfig.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
