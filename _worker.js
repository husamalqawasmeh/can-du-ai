/**
 * Cloudflare Pages advanced-mode worker.
 *
 * Everything except POST /api/comment is served straight from the static
 * assets. Comments are emailed to the owner through Resend.
 *
 * Required secret (set once, never committed):
 *   npx wrangler pages secret put RESEND_API_KEY --project-name can-du-ai
 *
 * Optional vars:
 *   COMMENT_TO    destination address   (default husamalqawasmeh@gmail.com)
 *   COMMENT_FROM  verified sender       (default onboarding@resend.dev)
 */

const DEFAULT_TO = "husamalqawasmeh@gmail.com";
const DEFAULT_FROM = "Can-Du-AI <onboarding@resend.dev>";
const MAX_MESSAGE = 4000;
const MAX_NAME = 80;
const MAX_EMAIL = 120;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });

const clean = (value, limit) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

async function handleComment(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Malformed request." }, 400);
  }

  const name = clean(payload.name, MAX_NAME);
  const email = clean(payload.email, MAX_EMAIL);
  const message = clean(payload.message, MAX_MESSAGE);

  if (!message) {
    return json({ ok: false, error: "A message is required." }, 400);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "That email address looks wrong." }, 400);
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    // No mail credential configured: tell the page so it can fall back.
    return json({ ok: false, error: "Email is not configured yet." }, 503);
  }

  const country = request.headers.get("CF-IPCountry") || "unknown";
  const subject = "can-du-ai.com comment" + (name ? " from " + name : "");
  const text =
    message +
    "\n\n---\n" +
    "Name: " + (name || "(not given)") + "\n" +
    "Email: " + (email || "(not given)") + "\n" +
    "Country: " + country + "\n" +
    "Received: " + new Date().toISOString() + "\n";

  const html =
    '<div style="font:15px/1.55 -apple-system,Segoe UI,sans-serif;color:#241C10">' +
    "<p style=\"white-space:pre-wrap;margin:0 0 1.2rem\">" + escapeHtml(message) + "</p>" +
    '<hr style="border:none;border-top:1px solid #ddd0b8">' +
    '<p style="font-size:13px;color:#6A5B45;margin:.8rem 0 0">' +
    "Name: " + escapeHtml(name || "(not given)") + "<br>" +
    "Email: " + escapeHtml(email || "(not given)") + "<br>" +
    "Country: " + escapeHtml(country) +
    "</p></div>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.COMMENT_FROM || DEFAULT_FROM,
      to: [env.COMMENT_TO || DEFAULT_TO],
      subject,
      text,
      html,
      ...(email ? { reply_to: email } : {})
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.log("resend failed", res.status, detail.slice(0, 400));
    return json({ ok: false, error: "The mail service refused it." }, 502);
  }

  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/comment") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "POST only." }, 405);
      }
      return handleComment(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
