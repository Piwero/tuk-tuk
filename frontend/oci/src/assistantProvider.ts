export function assistantProviderHost(baseUrl: string): { host: string; local: boolean } | null {
  try {
    const host = new URL(baseUrl).hostname;
    return { host, local: ["localhost", "127.0.0.1", "[::1]"].includes(host) };
  } catch {
    return null;
  }
}
