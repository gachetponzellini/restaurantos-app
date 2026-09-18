// Edge Function `print-agent` (spec 206): el agente del local habla con
// Supabase y no con Vercel.
//
//   POST /print-agent/pull     { business_id, beat? }  → { comandas, next_poll_ms }
//   POST /print-agent/ack      { comanda_id, business_id, result, error? }
//   POST /print-agent/session  { business_id }         → credenciales de Realtime
//
// Auth: la misma key `pak_live_…` del agente (Bearer). Se deploya con
// verify_jwt = false porque la key no es un JWT de Supabase.
//
// /pull y /ack corren EL MISMO código que la ruta de Vercel
// (`src/app/api/print-agent/route.ts`), empaquetado en `ruta.bundle.js` por
// `scripts/build-print-agent-fn.mjs`. No editar el bundle: regenerarlo.
//
// El agente la llama con `x-region: us-east-1` para correr pegado a la base.

import { createClient } from "npm:@supabase/supabase-js@2";

import { autenticarAgente, GET, POST } from "./ruta.bundle.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Headers que la ruta mira: la key y la versión del agente. */
function headersDelAgente(req: Request): HeadersInit {
  const h: Record<string, string> = {};
  const auth = req.headers.get("authorization");
  if (auth) h.authorization = auth;
  const v = req.headers.get("x-agent-version");
  if (v) h["x-agent-version"] = v;
  return h;
}

async function pull(req: Request) {
  const body = await req.json().catch(() => ({}));
  const q = new URLSearchParams({
    business_id: String(body.business_id ?? ""),
    // Sin retención: con el aviso por Realtime el pull contesta al toque.
    wait_ms: "0",
  });
  if (body.beat === false) q.set("beat", "0");
  return GET(
    new Request(`http://fn/api/print-agent?${q}`, {
      headers: headersDelAgente(req),
    }),
  );
}

async function ack(req: Request) {
  const text = await req.text();
  return POST(
    new Request("http://fn/api/print-agent", {
      method: "POST",
      headers: { ...headersDelAgente(req), "content-type": "application/json" },
      body: text,
    }),
  );
}

/**
 * Credenciales de Realtime (spec 206 · D3). Cada agente tiene un usuario de
 * Auth propio, sin membresías, con su negocio en `app_metadata` — que sólo
 * escribe el service role. La policy de `realtime.messages` lo deja escuchar
 * únicamente `print-agent:<su negocio>`.
 *
 * No podemos firmar un JWT propio (el proyecto firma con ES256 y la clave la
 * guarda Supabase), así que la sesión sale de un magic link que se canjea acá
 * mismo: `generateLink` + `verifyOtp`. No se manda ningún mail.
 */
async function session(req: Request) {
  const body = await req.json().catch(() => ({}));
  const businessId = String(body.business_id ?? "");
  const agente = await autenticarAgente(
    new Request("http://fn/", { headers: headersDelAgente(req) }),
    businessId,
  );
  if (!agente) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `print-agent+${agente.id}@agents.pedidos.com.ar`;
  const app_metadata = { print_agent_id: agente.id, business_id: businessId };

  // Crear si no existe. Si ya existe, el error se ignora y el link lo encuentra.
  await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata,
  });

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.user) {
    console.error("print-agent session · link", linkErr);
    return json({ error: "no session" }, 500);
  }
  // Un usuario creado antes con otro negocio (no debería pasar: el email
  // lleva el id del agente) queda corregido acá.
  const meta = link.user.app_metadata ?? {};
  if (
    meta.business_id !== businessId ||
    meta.print_agent_id !== agente.id
  ) {
    await admin.auth.admin.updateUserById(link.user.id, { app_metadata });
  }

  const anon = createClient(SUPABASE_URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: ses, error: otpErr } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (otpErr || !ses?.session) {
    console.error("print-agent session · otp", otpErr);
    return json({ error: "no session" }, 500);
  }

  return json({
    // Informativo: el agente arma la URL con su propia supabaseUrl.
    realtime_url: `${SUPABASE_URL}/realtime/v1`,
    topic: `print-agent:${businessId}`,
    access_token: ses.session.access_token,
    refresh_token: ses.session.refresh_token,
    expires_at: ses.session.expires_at,
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const ruta = new URL(req.url).pathname.split("/").filter(Boolean).at(-1);
  try {
    if (ruta === "pull") return await pull(req);
    if (ruta === "ack") return await ack(req);
    if (ruta === "session") return await session(req);
    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error("print-agent fn", ruta, e);
    return json({ error: "internal" }, 500);
  }
});
