export function proxyApiRequest(
  request: Request,
  path: string[],
  environment: Record<string, string | undefined>,
  fetcher: typeof fetch,
  accessToken?: string | null,
): Promise<Response>;
