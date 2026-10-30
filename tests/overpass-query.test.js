import { afterEach, expect, it, vi } from 'vitest';
import { fetchOverpassCell } from '@/lib/overpassServer';

afterEach(() => vi.unstubAllGlobals());

it('requests a bounded set of tagged multipolygon land-use relations', async () => {
  const elements = [
    ...Array.from({ length: 3 }, (_, id) => ({ type: 'way', id, tags: { building: 'yes' }, geometry: [] })),
    ...Array.from({ length: 30 }, (_, id) => ({ type: 'way', id: 100 + id, tags: { highway: 'residential' } })),
  ];
  const fetcher = vi.fn(async () => Response.json({ elements }));
  vi.stubGlobal('fetch', fetcher);

  await fetchOverpassCell(55.95, -3.18, { staggerMs: 60000 });

  const body = fetcher.mock.calls[0][1].body;
  const query = new URLSearchParams(body).get('data');
  expect(query).toContain('relation(around:650,55.95,-3.18)[type=multipolygon]');
  expect(query).toContain('[landuse~"^(residential|commercial|retail|garages|industrial|railway|construction|brownfield|wasteland|cemetery|allotments|recreation_ground|village_green)$"]; out geom 120;');
});
