import axios from 'axios';
import { ENV } from '../config/env';

export const apiClient = axios.create({
  baseURL: ENV.API_BASE,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use(config => {
  console.log(`[ScamDefy API] ${config.method?.toUpperCase()} ${config.url}`);
  return config;
});

apiClient.interceptors.response.use(
  response => response,
  error => {
    const message =
      error.response?.data?.detail ||
      error.message ||
      'An unexpected error occurred';
    console.error('[ScamDefy API Error]', message, error);
    return Promise.reject({ message, retryable: !error.response, code: error.response?.status });
  }
);
