export type AuthIdentity = {
  id: string;
  email: string | null;
  displayName: string | null;
};

export const verifiedIdentityHeader = "x-jobpilot-verified-identity";

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function authIdentityFromClaims(value: unknown): AuthIdentity | undefined {
  const claims = objectRecord(value);
  const id = nonEmptyString(claims?.sub);
  if (!id) return undefined;
  const metadata = objectRecord(claims?.user_metadata);
  return {
    id,
    email: nonEmptyString(claims?.email),
    displayName: nonEmptyString(metadata?.full_name) ?? nonEmptyString(metadata?.name),
  };
}

export function serializeAuthIdentity(identity: AuthIdentity) {
  return encodeURIComponent(JSON.stringify(identity));
}

export function authIdentityFromVerifiedHeader(value: string | null | undefined): AuthIdentity | undefined {
  if (!value || value.length > 4_000) return undefined;
  try {
    const parsed = objectRecord(JSON.parse(decodeURIComponent(value)));
    const id = nonEmptyString(parsed?.id);
    if (!id) return undefined;
    return {
      id,
      email: nonEmptyString(parsed?.email),
      displayName: nonEmptyString(parsed?.displayName),
    };
  } catch {
    return undefined;
  }
}
