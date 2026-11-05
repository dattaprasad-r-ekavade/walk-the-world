import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/r2Server', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    checkEditorKey: actual.checkEditorKey,
    isConfigured: vi.fn(() => true),
    downloadObject: vi.fn(async () => null),
    uploadObject: vi.fn(async () => {}),
    uploadBinary: vi.fn(async () => {}),
    listObjects: vi.fn(async () => []),
  };
});

import { PUT as putEdits } from '@/app/api/edits/[key]/route';
import { GET as listAssets, POST as postAsset } from '@/app/api/assets/route';
import { checkEditorKey, listObjects, uploadBinary, uploadObject } from '@/lib/r2Server';

const cellKey = 'wtw_city6_35.660_139.701';
const context = (key = cellKey) => ({ params: Promise.resolve({ key }) });
const put = (body, headers = { 'x-editor-key': 'secret' }) =>
  new Request(`http://localhost/api/edits/${cellKey}`, { method: 'PUT', headers, body });

beforeEach(() => vi.stubEnv('EDITOR_SECRET', 'secret'));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('editor key', () => {
  it('accepts only the configured secret', () => {
    const req = (key) => new Request('http://localhost/', { headers: key == null ? {} : { 'x-editor-key': key } });
    expect(checkEditorKey(req('secret'))).toBe(true);
    expect(checkEditorKey(req('secre'))).toBe(false);
    expect(checkEditorKey(req('secret!'))).toBe(false);
    expect(checkEditorKey(req(null))).toBe(false);
  });

  it('disables writes when no secret is configured', () => {
    vi.stubEnv('EDITOR_SECRET', '');
    expect(checkEditorKey(new Request('http://localhost/', { headers: { 'x-editor-key': '' } }))).toBe(false);
  });
});

describe('edits API', () => {
  it('stores a JSON object', async () => {
    const res = await putEdits(put(JSON.stringify({ assets: [] })), context());
    expect(res.status).toBe(200);
    expect(uploadObject).toHaveBeenCalledWith(`edits/${cellKey}.json`, '{"assets":[]}', expect.any(Object));
  });

  it.each([['not json', '{oops'], ['an array', '[]'], ['null', 'null']])('rejects %s with 400', async (_label, body) => {
    expect((await putEdits(put(body), context())).status).toBe(400);
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await putEdits(put(JSON.stringify({ blob: 'x'.repeat(1_000_001) })), context());
    expect(res.status).toBe(413);
  });

  it('rejects a wrong key before reading the body', async () => {
    const req = put('{}', { 'x-editor-key': 'nope' });
    const read = vi.spyOn(req.body, 'getReader');
    expect((await putEdits(req, context())).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it('reports a storage failure as 502', async () => {
    uploadObject.mockRejectedValueOnce(new Error('down'));
    expect((await putEdits(put('{}'), context())).status).toBe(502);
  });
});

describe('assets API', () => {
  const upload = (name, body) => new Request(`http://localhost/api/assets?name=${name}`, {
    method: 'POST', headers: { 'x-editor-key': 'secret' }, body,
  });

  it('uploads a named model', async () => {
    expect((await postAsset(upload('tree.glb', new Uint8Array([1, 2, 3])))).status).toBe(200);
    expect(uploadBinary).toHaveBeenCalledWith('assets/tree.glb', expect.any(Buffer), 'model/gltf-binary');
  });

  it('refuses a declared oversized upload without buffering it', async () => {
    const req = new Request('http://localhost/api/assets?name=big.glb', {
      method: 'POST', headers: { 'x-editor-key': 'secret', 'content-length': String(30_000_001) }, body: new Uint8Array(4),
    });
    const read = vi.spyOn(req.body, 'getReader');
    expect((await postAsset(req)).status).toBe(413);
    expect(read).not.toHaveBeenCalled();
  });

  it('falls back to an empty library when listing fails', async () => {
    listObjects.mockRejectedValueOnce(new Error('down'));
    const res = await listAssets();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
