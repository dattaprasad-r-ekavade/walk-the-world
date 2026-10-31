import { describe, expect, it } from "vitest";
import { overtureIndexAuthorization } from "../lib/overtureIndexAuth.js";

const request = (authorization) => new Request("http://localhost/api/overture-index", {
  method: "POST",
  headers: authorization ? { authorization } : {},
});

describe("overtureIndexAuthorization", () => {
  it("disables the index build when no secret is configured", () => {
    expect(overtureIndexAuthorization(request("Bearer token"), "")).toBe("disabled");
    expect(overtureIndexAuthorization(request("Bearer token"), "   ")).toBe("disabled");
  });

  it("rejects missing, malformed, and incorrect bearer tokens", () => {
    expect(overtureIndexAuthorization(request(), "secret-token")).toBe("unauthorized");
    expect(overtureIndexAuthorization(request("Basic secret-token"), "secret-token")).toBe("unauthorized");
    expect(overtureIndexAuthorization(request("Bearer wrong-token"), "secret-token")).toBe("unauthorized");
  });

  it("accepts the configured bearer token", () => {
    expect(overtureIndexAuthorization(request("Bearer secret-token"), "secret-token")).toBe("authorized");
    expect(overtureIndexAuthorization(request("bearer secret-token"), "secret-token")).toBe("authorized");
  });
});
