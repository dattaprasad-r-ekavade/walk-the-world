import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gzipSync } from 'node:zlib';
vi.mock('@/lib/r2Server', () => ({ isConfigured: vi.fn(() => true), checkEditorKey: vi.fn(req => req.headers.get('x-editor-key') === 'test'), downloadObjectRaw: vi.fn(async () => null), uploadObject: vi.fn() }));
vi.mock('@/lib/overpassServer', () => ({ fetchOverpassCell: vi.fn() }));
import { GET, PUT } from '@/app/api/city/[key]/route';
import { uploadObject, downloadObjectRaw } from '@/lib/r2Server';
import { fetchOverpassCell } from '@/lib/overpassServer';
import { readBoundedJson } from '@/lib/read-bounded-json';
const params = { params: { key: 'wtw_city6_35.660_139.701' } };
const city = { elements: [{ type: 'way', id: 1, tags: { building: 'yes' } }] };
const request = (body, key = 'test') => new Request('http://localhost/api/city/' + params.params.key, { method:'PUT', headers:{'x-editor-key':key}, body:JSON.stringify(body) });
beforeEach(() => vi.clearAllMocks());
describe('city API boundaries', () => {
  it('rejects anonymous writes before reading the body', async () => {
    const req = request(city, ''); const read = vi.spyOn(req.body, 'getReader');
    expect((await PUT(req, params)).status).toBe(401);
    expect(read).not.toHaveBeenCalled(); expect(uploadObject).not.toHaveBeenCalled();
  });
  it('stores complete authorized payloads', async () => {
    expect((await PUT(request(city), params)).status).toBe(200);
    expect(uploadObject).toHaveBeenCalledOnce();
  });
  it.each([{ elements: 'bad' }, { ...city, partial:true }, { elements:[{ type:'node', id:1, lat:200, lon:1 }] }])('rejects invalid or partial payloads', async payload => {
    expect((await PUT(request(payload), params)).status).toBe(400);
    expect(uploadObject).not.toHaveBeenCalled();
  });
  it('rejects invalid coordinate keys', async () => {
    expect((await GET(new Request('http://localhost/'), {params:{key:'wtw_city6_999.000_0.000'}})).status).toBe(400);
    expect(downloadObjectRaw).not.toHaveBeenCalled();
  });
  it('preserves incomplete status without browser or R2 caching', async () => {
    fetchOverpassCell.mockResolvedValue({ ...city, partial:true });
    const res = await GET(new Request('http://localhost/'), params);
    expect((await res.json()).partial).toBe(true);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(uploadObject).not.toHaveBeenCalled();
  });
  it('passes trusted gzip objects straight through without re-serializing', async () => {
    const bytes = gzipSync(Buffer.from(JSON.stringify(city)));
    downloadObjectRaw.mockResolvedValue({ bytes, gzip: true, trusted: true });
    const res = await GET(new Request('http://localhost/'), params);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    expect(fetchOverpassCell).not.toHaveBeenCalled();
  });
  it('validates legacy objects and refetches partial ones', async () => {
    downloadObjectRaw.mockResolvedValue({ bytes: gzipSync(Buffer.from(JSON.stringify({ ...city, partial: true }))), gzip: true, trusted: false });
    fetchOverpassCell.mockResolvedValue(city);
    const res = await GET(new Request('http://localhost/'), params);
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(fetchOverpassCell).toHaveBeenCalledOnce();
  });
  it('still returns Overpass data when the R2 write-back fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchOverpassCell.mockResolvedValue(city);
    uploadObject.mockRejectedValue(new Error('r2 down'));
    const res = await GET(new Request('http://localhost/'), params);
    expect(res.status).toBe(200);
    expect((await res.json()).elements).toHaveLength(1);
  });
  it('rejects oversized streaming bodies without content-length', async () => {
    const req = new Request('http://localhost/', {method:'POST', body:'"1234567890"'});
    await expect(readBoundedJson(req, 5)).rejects.toMatchObject({status:413});
  });
});
