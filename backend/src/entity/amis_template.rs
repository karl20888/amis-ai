use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "amis_templates")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub title: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub description: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub amis_json: String,
    pub category: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub tags: Option<String>,
    pub source: String,
    pub source_history_id: Option<i32>,
    pub quality_score: Option<f32>,
    pub usage_count: Option<i32>,
    pub created_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::generation_history::Entity",
        from = "Column::SourceHistoryId",
        to = "super::generation_history::Column::Id"
    )]
    GenerationHistory,
}

impl Related<super::generation_history::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::GenerationHistory.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
