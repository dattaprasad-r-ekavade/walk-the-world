import { afterEach, describe, expect, it, vi } from "vitest";

const preferred = "https://overpass.example.test/interpreter";
const completeCell = {
  elements: [
    ...Array.from({ length: 3 }, (_, id) => ({
      type: "way", id, tags: { building: "yes" }, geometry: [],
    })),
    ...Array.from({ length: 30 }, (_, id) => ({
      type: "way", id: 100 + id, tags: { highway: "residential" },
    })),
  ],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("configured Overpass endpoint", () => {
  it("tries the preferred endpoint before public mirrors", async () => {
    vi.stubEnv("OVERPASS_ENDPOINT", `  ${preferred}  `);
    const fetcher = vi.fn(async () => Response.json(completeCell));
    vi.stubGlobal("fetch", fetcher);
    vi.resetModules();

    const { fetchOverpassCell } = await import("../lib/overpassServer.js");
    const result = await fetchOverpassCell(1, 2, { staggerMs: 60_000 });

    expect(result.elements).toHaveLength(33);
    expect(fetcher.mock.calls[0][0]).toBe(preferred);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("falls back to public mirrors when the preferred endpoint fails", async () => {
    vi.stubEnv("OVERPASS_ENDPOINT", preferred);
    const fetcher = vi.fn(async () => {
      if (fetcher.mock.calls.length === 1) return new Response("", { status: 503 });
      return Response.json(completeCell);
    });
    vi.stubGlobal("fetch", fetcher);
    vi.resetModules();

    const { fetchOverpassCell } = await import("../lib/overpassServer.js");
    const result = await fetchOverpassCell(1, 2, { staggerMs: 60_000 });

    expect(result.elements).toHaveLength(33);
    expect(fetcher.mock.calls[0][0]).toBe(preferred);
    expect(fetcher.mock.calls[1][0]).toBe("https://overpass-api.de/api/interpreter");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
