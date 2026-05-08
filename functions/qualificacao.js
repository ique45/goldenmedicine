// POST /qualificacao — salva respostas de lead scoring vinculadas à sessão.
// Lê _krob_sid do cookie (não-HttpOnly, legível pelo JS e pelo servidor).
// Dispara evento MQL no Meta CAPI quando faturamento >= 75k.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Faturamentos que qualificam como MQL (>= 75k/mês)
const MQL_FATURAMENTOS = new Set([
  'Entre 75k e 100k',
  'Entre 100k e 150k',
  'Entre 150k e 200k',
  'Acima de 200k',
]);

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const sessionId = cookies['_krob_sid'] || body.session_id || '';

  if (!sessionId) {
    return json({ error: 'session not found' }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  try {
    await env.DB.prepare(`
      INSERT INTO lead_qualification (session_id, instagram, especialidade, faturamento, foco, disposto, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      sessionId,
      body.instagram     || null,
      body.especialidade || null,
      body.faturamento   || null,
      body.foco          || null,
      body.disposto      || null,
      now
    ).run();
  } catch (err) {
    return json({ error: err.message }, 500);
  }

  const isMQL = MQL_FATURAMENTOS.has(body.faturamento);
  let leadName = '';

  if (isMQL) {
    const [sessionRow, leadRow] = await Promise.all([
      env.DB.prepare(
        'SELECT fbp, fbc, external_id, ip_address, user_agent, landing_url FROM sessions WHERE session_id = ? LIMIT 1'
      ).bind(sessionId).first().catch(() => null),
      env.DB.prepare(
        `SELECT raw_name, raw_phone FROM event_log WHERE session_id = ? AND event_name = 'Lead' ORDER BY timestamp DESC LIMIT 1`
      ).bind(sessionId).first().catch(() => null),
    ]);

    leadName = leadRow?.raw_name || '';

    const pageUrl = `https://${new URL(request.url).host}/qualificacao`;
    context.waitUntil(
      fireMqlEvent({ env, sessionId, body, sessionRow, leadRow, pageUrl, now })
    );
  }

  return json({ ok: true, mql: isMQL, nome: leadName });
}

// -------------------------------------------------------
// MQL — Meta CAPI
// -------------------------------------------------------
async function fireMqlEvent({ env, sessionId, body, sessionRow, leadRow, pageUrl, now }) {
  if (!env.META_PIXEL_ID || !env.META_ACCESS_TOKEN) return;

  const eventId = body.event_id || crypto.randomUUID();

  const userData = {};

  if (sessionRow?.ip_address) userData.client_ip_address = sessionRow.ip_address;
  if (sessionRow?.user_agent) userData.client_user_agent = sessionRow.user_agent;
  if (sessionRow?.fbp)        userData.fbp = sessionRow.fbp;
  if (sessionRow?.fbc)        userData.fbc = sessionRow.fbc;

  if (sessionRow?.external_id) {
    userData.external_id = [await sha256(sessionRow.external_id)];
  }

  if (leadRow?.raw_phone) {
    userData.ph = [await sha256(normalizePhone(leadRow.raw_phone, env.DEFAULT_COUNTRY_CODE || '55'))];
  }

  if (leadRow?.raw_name) {
    const parts = leadRow.raw_name.trim().split(/\s+/);
    userData.fn = [await sha256(parts[0].toLowerCase())];
    if (parts.length > 1) userData.ln = [await sha256(parts.slice(1).join(' ').toLowerCase())];
  }

  const payload = {
    data: [{
      event_name: 'Subscribe',
      event_time: now,
      event_id: eventId,
      event_source_url: pageUrl,
      action_source: 'website',
      user_data: userData,
      custom_data: {
        especialidade: body.especialidade || null,
        faturamento:   body.faturamento   || null,
        foco:          body.foco          || null,
      },
    }],
  };

  if (env.META_TEST_EVENT_CODE) {
    payload.test_event_code = env.META_TEST_EVENT_CODE;
  }

  try {
    await fetch(
      `https://graph.facebook.com/v25.0/${env.META_PIXEL_ID}/events?access_token=${env.META_ACCESS_TOKEN}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
  } catch (err) {
    console.error('MQL CAPI error:', err.message);
  }
}

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
async function sha256(str) {
  if (!str) return '';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function normalizePhone(ph, countryCode) {
  if (!ph) return '';
  const cc = String(countryCode || '55');
  const digits = ph.replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return '';
  if (digits.startsWith(cc) && digits.length >= cc.length + 8 && digits.length <= cc.length + 11) return digits;
  if (digits.length >= 8 && digits.length <= 11) return cc + digits;
  return digits;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function parseCookies(header) {
  const cookies = {};
  header.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=');
  });
  return cookies;
}
