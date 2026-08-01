/**
 * Клиент REST API. Единственное место, которое знает про сетевые адреса.
 * Ошибки приходят в виде ApiError с полем `errors` для подсветки полей формы.
 */

export class ApiError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors ?? null;
  }
}

async function request(method, path, body) {
  const options = { method, credentials: 'same-origin', headers: {} };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    throw new ApiError(0, 'Сервер недоступен. Проверьте, запущен ли процесс приложения.');
  }

  const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new ApiError(response.status, payload?.error ?? `Ошибка запроса (${response.status})`, payload?.errors);
  }
  return payload;
}

export const api = {
  getState: () => request('GET', '/api/state'),

  createSignal: (input) => request('POST', '/api/signals', input),
  changeSignalStatus: (id, status) => request('POST', `/api/signals/${encodeURIComponent(id)}/status`, { status }),
  ageSignal: (id) => request('POST', `/api/signals/${encodeURIComponent(id)}/age`),

  createTask: (input) => request('POST', '/api/tasks', input),
  changeTaskStatus: (id, status) => request('POST', `/api/tasks/${encodeURIComponent(id)}/status`, { status }),

  login: (login, password) => request('POST', '/api/auth/login', { login, password }),
  logout: () => request('POST', '/api/auth/logout'),

  createAdmin: (input) => request('POST', '/api/admins', input),
  resendVerification: () => request('POST', '/api/verification/resend'),
  updateSettings: (settings) => request('PUT', '/api/settings', { settings }),

  /** Загрузка файлов идет multipart-ом, поэтому в обход request(). */
  async uploadFiles(fileList) {
    const form = new FormData();
    for (const file of fileList) form.append('files', file, file.name);

    const response = await fetch('/api/files', { method: 'POST', body: form, credentials: 'same-origin' });
    const payload = await response.json().catch(() => null);

    if (!response.ok) throw new ApiError(response.status, payload?.error ?? 'Не удалось загрузить файлы');
    return payload.files;
  },

  exportUrl(kind, params = {}) {
    const query = new URLSearchParams(params).toString();
    return `/api/export/${kind}${query ? `?${query}` : ''}`;
  },
};
