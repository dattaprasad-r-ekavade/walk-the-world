import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/r2Server', () => ({ isConfigured: vi.fn(() => true), checkEditorKey: vi.fn(req => req.headers.get('x-editor-key') === 'test'), downloadObject: vi.fn(async () => null), uploadObject: vi.fn() }));
vi.mock('@/lib/overpassServer', () => ({ fetchOverpassCell: vi.fn() }));
import { GET, PUT } from '@/app/api/city/[key]/route';
import { uploadObject, downloadObject } from '@/lib/r2Server';
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
    expect(downloadObject).not.toHaveBeenCalled();
  });
  it('preserves incomplete status without browser or R2 caching', async () => {
    fetchOverpassCell.mockResolvedValue({ ...city, partial:true });
    const res = await GET(new Request('http://localhost/'), params);
    expect((await res.json()).partial).toBe(true);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(uploadObject).not.toHaveBeenCalled();
  });
  it('rejects oversized streaming bodies without content-length', async () => {
    const req = new Request('http://localhost/', {method:'POST', body:'"1234567890"'});
    await expect(readBoundedJson(req, 5)).rejects.toMatchObject({status:413});
  });
});
