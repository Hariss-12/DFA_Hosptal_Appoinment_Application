/**
 * Centralized Axios HTTP Client (`src/api/axiosClient.js`)
 *
 * Configures:
 * - Base URL from VITE_API_BASE_URL or `/api`
 * - Automatic Bearer JWT header attachment
 * - Standardized error extraction for HTTP 409 DFA transition conflicts, 401/403 RBAC errors, and validation messages
 */

import axios from 'axios';

const API_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL) ||
  '/api';

const axiosClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

axiosClient.interceptors.request.use(
  (config) => {
    try {
      const token = localStorage.getItem('hospital_dfa_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // Ignore storage access errors in restricted frames
    }
    return config;
  },
  (error) => Promise.reject(error)
);

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const apiErr = error.response?.data?.error || {};
    const formattedError = {
      status: status || 500,
      message: apiErr.message || error.message || 'Network or server error occurred.',
      code: apiErr.code || 'API_ERROR',
      currentState: apiErr.currentState || null,
      event: apiErr.event || null,
      isTerminal: Boolean(apiErr.isTerminal),
      allowedEvents: apiErr.allowedEvents || [],
    };
    return Promise.reject(formattedError);
  }
);

export default axiosClient;
