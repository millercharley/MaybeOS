import { api } from './api';

/**
 * Attaching a file, in three steps that have to happen in this order.
 *
 * The bytes never pass through MaybeOS's API: a Netlify Function caps a
 * request at about 6 MB and base64 inflates a file by a third, which a phone
 * photo clears on its own. So the browser asks for somewhere to put the file,
 * uploads straight to storage, and only then tells the API what landed.
 *
 * The parent has to exist first. A file attaches to a post, a comment or an
 * event, and none of those have an id until they are created — so a composer
 * holds the files, the parent is created on submit, and these run afterwards.
 */

export const ATTACHMENT_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv,' +
  'application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export interface AttachmentOwner {
  postId?: string;
  commentId?: string;
  eventId?: string;
}

/** Human size, for a chip beside a filename. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Upload one file and attach it.
 *
 * Rejects before asking for a URL when the file is obviously unacceptable, so
 * a member is told why rather than watching an upload fail at the far end.
 */
export async function uploadAttachment(
  orgId: string,
  file: File,
  owner: AttachmentOwner,
  token: string,
) {
  if (file.size > ATTACHMENT_MAX_BYTES) {
    throw new Error(`${file.name} is larger than 25 MB.`);
  }

  const { uploadUrl, path } = await api.attachments.uploadUrl(orgId, file.type, token);

  // Straight to storage. No Authorization header: the signed URL is the
  // credential, and it is single-use for this one path.
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!upload.ok) {
    throw new Error(`Could not upload ${file.name}.`);
  }

  return api.attachments.record(
    orgId,
    { path, fileName: file.name, mimeType: file.type, ...owner },
    token,
  );
}

/** Attach several, reporting the first failure rather than half-succeeding silently. */
export async function uploadAttachments(
  orgId: string,
  files: File[],
  owner: AttachmentOwner,
  token: string,
) {
  for (const file of files) {
    await uploadAttachment(orgId, file, owner, token);
  }
}
