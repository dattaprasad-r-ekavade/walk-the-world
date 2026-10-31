import { timingSafeEqual } from "node:crypto";

/** Return the access state for the one-time Overture index build endpoint. */
export function overtureIndexAuthorization(request, configuredSecret = process.env.OVERTURE_INDEX_SECRET) {
  const expected = typeof configuredSecret === "string" ? configuredSecret.trim() : "";
  if (!expected) return "disabled";

  const authorization = request.headers.get("authorization") || "";
  const token = /^Bearer\s+([^\s]+)$/iu.exec(authorization)?.[1];
  if (!token) return "unauthorized";

  const expectedBytes = Buffer.from(expected, "utf8");
  const tokenBytes = Buffer.from(token, "utf8");
  if (expectedBytes.length !== tokenBytes.length) return "unauthorized";
  return timingSafeEqual(expectedBytes, tokenBytes) ? "authorized" : "unauthorized";
}
