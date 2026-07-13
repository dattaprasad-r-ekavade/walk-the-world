import { deterministicWorldRepair } from '@/lib/world-repair';

export const runtime = 'nodejs';
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const summary = body?.summary;
  if (!summary || typeof summary !== 'object' || Number(summary.elements) > 100000) {
    return Response.json({ error: 'A bounded city summary is required' }, { status: 400 });
  }

  return Response.json({
    ...deterministicWorldRepair(summary, { place: body.place }),
    note: 'Runs locally with deterministic rules; no paid model or external AI API is used.',
  });
}
