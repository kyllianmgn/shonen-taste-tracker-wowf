import { ManualSyncInputError } from '../../ingest/share-code/manual-sync.service';

/** `/sync fichier:` limit (docs/02 « Commande /sync »), the same as the Lua parser's. */
export const ATTACHMENT_MAX_BYTES = 512 * 1024;

const DOWNLOAD_TIMEOUT_MS = 10_000;
/** Hosts Discord serves attachments from; nothing else is fetched. */
const DISCORD_CDN_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];

/**
 * Downloads a /sync attachment, refusing it over 512 KiB: first from the size Discord announces,
 * then while reading, in case the body is larger than announced.
 * Throws ManualSyncInputError (`too_large` or `download_failed`).
 */
export async function downloadAttachment(
  attachment: { url: string; size: number },
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  if (attachment.size > ATTACHMENT_MAX_BYTES) throw new ManualSyncInputError('too_large');
  if (!isDiscordCdn(attachment.url)) throw new ManualSyncInputError('download_failed');

  let response: Response;
  try {
    response = await fetchImpl(attachment.url, { redirect: 'error', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch {
    throw new ManualSyncInputError('download_failed');
  }
  if (!response.ok || response.body === null) throw new ManualSyncInputError('download_failed');

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > ATTACHMENT_MAX_BYTES) {
        await reader.cancel();
        throw new ManualSyncInputError('too_large');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ManualSyncInputError) throw error;
    throw new ManualSyncInputError('download_failed');
  }
  return Buffer.concat(chunks);
}

function isDiscordCdn(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && DISCORD_CDN_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}
