async function throwIfNotOk(res: Response, method: string, url: string): Promise<void> {
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `${method} ${url} failed`);
  }
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  await throwIfNotOk(res, 'GET', url);
  const json = await res.json();
  return json.data as T;
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await throwIfNotOk(res, 'POST', url);
  const json = await res.json();
  return json.data as T;
}

export async function apiPut<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await throwIfNotOk(res, 'PUT', url);
  const json = await res.json();
  return json.data as T;
}

export async function apiDelete(url: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE' });
  await throwIfNotOk(res, 'DELETE', url);
}

export async function apiUploadFile<T>(url: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(url, { method: 'POST', body: formData });
  await throwIfNotOk(res, 'POST', url);
  const json = await res.json();
  return json.data as T;
}
