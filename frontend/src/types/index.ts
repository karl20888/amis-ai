export interface User {
  id: number;
  username: string;
  email: string;
  avatar: string | null;
  is_active: boolean;
  created_at: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface LlmProvider {
  id: number;
  name: string;
  base_url: string;
  is_active: boolean;
  created_at: string;
}

export interface ModelConfig {
  id: number;
  task_type: string;
  provider_id: number;
  model_name: string;
  temperature: number;
  max_tokens: number | null;
  is_active: boolean;
}

export interface GenerationHistory {
  id: number;
  user_id: number;
  user_prompt: string;
  generated_json: string;
  model_used: string | null;
  status: 'generated' | 'adopted' | 'rejected';
  feedback: string | null;
  final_json: string | null;
  created_at: string;
  adopted_at: string | null;
}

export interface AmisTemplate {
  id: number;
  title: string;
  description: string | null;
  amis_json: string;
  category: string | null;
  tags: string[] | null;
  source: string;
  quality_score: number;
  usage_count: number;
  created_at: string;
}
