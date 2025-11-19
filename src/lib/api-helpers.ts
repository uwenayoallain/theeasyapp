import { compressResponse, shouldCompress } from "./compression";

export function jsonResponse(
  data: unknown,
  request: Request,
  options?: { status?: number; headers?: Record<string, string> },
): Response {
  const json = JSON.stringify(data);
  const acceptEncoding = request.headers.get("accept-encoding");

  if (shouldCompress(new URL(request.url).pathname, json.length)) {
    const { data: compressed, encoding } = compressResponse(
      json,
      acceptEncoding,
    );

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    };

    if (encoding) {
      headers["Content-Encoding"] = encoding;
      headers["Vary"] = "Accept-Encoding";
    }

    const typedArray = Uint8Array.from(compressed);
    const responseBody = new Blob([typedArray.buffer]);
    return new Response(responseBody, {
      status: options?.status ?? 200,
      headers,
    });
  }

  return Response.json(data, options);
}
