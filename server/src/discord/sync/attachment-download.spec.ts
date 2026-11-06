import { ManualSyncInputError } from '../../ingest/share-code/manual-sync.service';
import { ATTACHMENT_MAX_BYTES, downloadAttachment } from './attachment-download';

const URL_OK = 'https://cdn.discordapp.com/ephemeral-attachments/1/2/ForeverTracker.lua?ex=1';
const ok = (body: ConstructorParameters<typeof Response>[0]) => jest.fn().mockResolvedValue(new Response(body, { status: 200 }));

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ManualSyncInputError) return error.reason;
    throw error;
  }
  return 'resolved';
}

describe('downloadAttachment', () => {
  it('downloads a Discord attachment', async () => {
    const fetchImpl = ok('ForeverTrackerDB = nil');

    const bytes = await downloadAttachment({ url: URL_OK, size: 22 }, fetchImpl);

    expect(bytes.toString('utf8')).toBe('ForeverTrackerDB = nil');
    expect(fetchImpl).toHaveBeenCalledWith(URL_OK, expect.objectContaining({ redirect: 'error' }));
  });

  it('refuses an attachment announced over 512 KiB without downloading it', async () => {
    const fetchImpl = jest.fn();

    expect(await reason(downloadAttachment({ url: URL_OK, size: ATTACHMENT_MAX_BYTES + 1 }, fetchImpl))).toBe('too_large');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('stops reading a body that grows past 512 KiB', async () => {
    const fetchImpl = ok(new Uint8Array(ATTACHMENT_MAX_BYTES + 10));

    expect(await reason(downloadAttachment({ url: URL_OK, size: 10 }, fetchImpl))).toBe('too_large');
  });

  it.each([
    'http://cdn.discordapp.com/attachments/1/2/f.lua',
    'https://evil.example.com/f.lua',
    'https://cdn.discordapp.com.evil.example/f.lua',
    'not a url',
  ])('only fetches from the Discord CDN over https (%s)', async (url) => {
    const fetchImpl = jest.fn();

    expect(await reason(downloadAttachment({ url, size: 10 }, fetchImpl))).toBe('download_failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('answers download_failed on an HTTP error or a network failure', async () => {
    const notFound = jest.fn().mockResolvedValue(new Response('nope', { status: 404 }));
    const offline = jest.fn().mockRejectedValue(new TypeError('fetch failed'));

    expect(await reason(downloadAttachment({ url: URL_OK, size: 10 }, notFound))).toBe('download_failed');
    expect(await reason(downloadAttachment({ url: URL_OK, size: 10 }, offline))).toBe('download_failed');
  });
});
