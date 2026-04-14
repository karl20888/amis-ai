import api from './api';
import type { LlmProvider, ModelConfig } from '../types';

// ---- 供应商管理 ----

interface ProviderResponse extends Omit<LlmProvider, 'api_key'> {
  api_key_hint: string;
}

export async function getProviders(): Promise<ProviderResponse[]> {
  const { data } = await api.get('/llm/providers');
  return data;
}

export async function createProvider(payload: {
  name: string;
  base_url: string;
  api_key: string;
  is_active?: boolean;
}): Promise<ProviderResponse> {
  const { data } = await api.post('/llm/providers', payload);
  return data;
}

export async function updateProvider(id: number, payload: {
  name?: string;
  base_url?: string;
  api_key?: string;
  is_active?: boolean;
}): Promise<ProviderResponse> {
  const { data } = await api.put(`/llm/providers/${id}`, payload);
  return data;
}

export async function deleteProvider(id: number): Promise<void> {
  await api.delete(`/llm/providers/${id}`);
}

export async function testProvider(id: number): Promise<{ status: string; message: string }> {
  const { data } = await api.post(`/llm/providers/${id}/test`, null, { timeout: 15000 });
  return data;
}

export async function getProviderModels(id: number): Promise<string[]> {
  const { data } = await api.get(`/llm/providers/${id}/models`, { timeout: 15000 });
  return data.models || [];
}

// ---- 模型配置管理 ----

interface ModelConfigResponse extends ModelConfig {
  provider_name: string;
}

export async function getModelConfigs(): Promise<ModelConfigResponse[]> {
  const { data } = await api.get('/llm/configs');
  return data;
}

export async function createModelConfig(payload: {
  task_type: string;
  provider_id: number;
  model_name: string;
  temperature?: number;
  max_tokens?: number | null;
  is_active?: boolean;
}): Promise<ModelConfig> {
  const { data } = await api.post('/llm/configs', payload);
  return data;
}

export async function updateModelConfig(id: number, payload: {
  task_type?: string;
  provider_id?: number;
  model_name?: string;
  temperature?: number;
  max_tokens?: number | null;
  is_active?: boolean;
}): Promise<ModelConfig> {
  const { data } = await api.put(`/llm/configs/${id}`, payload);
  return data;
}

export async function deleteModelConfig(id: number): Promise<void> {
  await api.delete(`/llm/configs/${id}`);
}
