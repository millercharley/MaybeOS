import { ApiError } from './api';

/**
 * Download a file from an authenticated endpoint.
 *
 * A plain `<a href>` cannot carry a bearer token, so every export link in the
 * app pointed at an endpoint that answered 401 — the file simply never
 * arrived and the browser showed whatever the API said instead. Fetching it
 * and handing the browser a blob is the only way to send the header.
 *
 * The object URL is revoked afterwards: each one pins its blob in memory for
 * the life of the document, and an admin exporting a dozen things during one
 * session would otherwise hold a dozen files they can no longer reach.
 */
export async function downloadAuthenticated(
  url: string,
  filename: string,
  token: string,
): Promise<void> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (!response.ok) {
    // Read the API's own words rather than inventing "download failed": a 402
    // here means the co-op has not bought this yet, and that deserves the
    // sentence the API wrote for it.
    const body = await response.json().catch(() => null);
    const message =
      (body && (Array.isArray(body.message) ? body.message.join(' ') : body.message)) ||
      'That file could not be downloaded.';
    throw new ApiError(response.status, message);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(objectUrl);
}
