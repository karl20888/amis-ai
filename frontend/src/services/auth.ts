import api from './api';
import type { AuthResponse } from '../types';

export async function login(username: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/login', { username, password });
  return data;
}

export async function register(username: string, password: string, email: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/register', { username, password, email });
  return data;
}

export async function getProfile() {
  const { data } = await api.get('/user/profile');
  return data;
}
