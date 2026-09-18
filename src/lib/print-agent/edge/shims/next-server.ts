/** `next/server` para Deno: la ruta sólo usa `NextResponse.json`. */
export const NextResponse = {
  json(body: unknown, init?: ResponseInit) {
    return new Response(JSON.stringify(body), {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  },
};
