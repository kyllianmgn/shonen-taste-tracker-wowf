/** `Authorization: Bearer <deviceToken>`; device tokens are 43 base64url characters (pair.response.json). */
const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/i;

/** The token of a well-formed Bearer header, or null (missing, other scheme, wrong shape). */
export function parseBearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  return BEARER.exec(header)?.[1] ?? null;
}
