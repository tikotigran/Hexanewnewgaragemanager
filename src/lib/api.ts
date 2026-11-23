// In-memory auth token store (never stored in localStorage/sessionStorage per security rules)
let memoryToken: string | null = null;

export function setInMemoryAuthToken(token: string | null): void {
  memoryToken = token;
}

export function getInMemoryAuthToken(): string | null {
  return memoryToken;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'HexaVO');
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let message = `Erreur ${res.status}`;
    let details: unknown;
    if (contentType.includes('application/json')) {
      const json = await res.json();
      message = json.error || message;
      details = json.details;
    }
    throw new ApiError(message, res.status, details);
  }

  if (contentType.includes('application/json')) {
    return res.json() as Promise<T>;
  }
  return res.text() as unknown as Promise<T>;
}

export async function downloadProtectedFile(url: string, fallbackName: string): Promise<void> {
  const headers = new Headers();
  headers.set('X-Requested-With', 'HexaVO');
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }
  const res = await fetch(url, { headers, credentials: 'include' });
  if (!res.ok) {
    throw new ApiError('Téléchargement impossible', res.status);
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  const cd = res.headers.get('content-disposition');
  const match = cd?.match(/filename="([^"]+)"/);
  a.download = match ? match[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}
