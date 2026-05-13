// GET /api/funnel?key=...&days=30
// Returns visit → form_open → lead funnel counts for /lp01

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get('days') || '30', 10) || 30));
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const db = env.GoldenMed || env.DB;

  try {
    const [visitsRow, formOpensRow, leadsRow] = await Promise.all([
      db.prepare(
        `SELECT COUNT(*) as count FROM sessions WHERE landing_url LIKE '%/lp01%' AND created_at >= ?`
      ).bind(since).first(),
      db.prepare(
        `SELECT COUNT(*) as count FROM event_log e
         LEFT JOIN sessions s ON e.session_id = s.session_id
         WHERE e.event_name = 'ViewContent'
           AND s.landing_url LIKE '%/lp01%'
           AND e.timestamp >= ?
           AND e.is_bot = 0`
      ).bind(since).first(),
      db.prepare(
        `SELECT COUNT(*) as count FROM event_log e
         LEFT JOIN sessions s ON e.session_id = s.session_id
         WHERE e.event_name = 'Lead'
           AND s.landing_url LIKE '%/lp01%'
           AND e.timestamp >= ?
           AND e.is_bot = 0`
      ).bind(since).first(),
    ]);

    return json({
      days,
      visits:     visitsRow?.count    || 0,
      form_opens: formOpensRow?.count || 0,
      leads:      leadsRow?.count     || 0,
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
