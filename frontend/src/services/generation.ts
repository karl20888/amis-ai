import api from './api';
import type { GenerationHistory } from '../types';

interface HistoryListResponse {
  items: GenerationHistory[];
  total: number;
  page: number;
  page_size: number;
}

export async function getHistoryList(page = 1, pageSize = 20): Promise<HistoryListResponse> {
  const { data } = await api.get('/history', { params: { page, page_size: pageSize } });
  return data;
}

export async function getHistory(id: number): Promise<GenerationHistory> {
  const { data } = await api.get(`/history/${id}`);
  return data;
}

export async function createHistory(payload: {
  user_prompt: string;
  generated_json: string;
  model_used?: string;
}): Promise<GenerationHistory> {
  const { data } = await api.post('/history', payload);
  return data;
}

export async function adoptHistory(id: number, payload: {
  final_json: string;
  title?: string;
  category?: string;
}): Promise<any> {
  const { data } = await api.put(`/history/${id}/adopt`, payload);
  return data;
}

export async function deleteHistory(id: number): Promise<void> {
  await api.delete(`/history/${id}`);
}

// 模板库
export async function getTemplates(params?: {
  page?: number;
  page_size?: number;
  category?: string;
  search?: string;
}): Promise<any> {
  const { data } = await api.get('/templates', { params });
  return data;
}

export async function getTemplate(id: number): Promise<any> {
  const { data } = await api.get(`/templates/${id}`);
  return data;
}
