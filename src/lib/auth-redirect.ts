function normalizedOrigin(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    return new URL(value.trim()).origin;
  } catch {
    return null;
  }
}

export function resolveAuthOrigin(
  browserOrigin: string,
  configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL,
) {
  return normalizedOrigin(configuredOrigin) ?? normalizedOrigin(browserOrigin) ?? browserOrigin;
}

export function buildAuthCallbackUrl(
  browserOrigin: string,
  nextPath: string,
  configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL,
) {
  const callback = new URL("/auth/callback", resolveAuthOrigin(browserOrigin, configuredOrigin));
  callback.searchParams.set("next", nextPath);
  return callback.toString();
}
