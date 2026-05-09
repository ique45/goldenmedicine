export async function onRequestGet(context) {
  const { env } = context;
  return new Response(JSON.stringify({
    dashKeySet: !!env.DASH_KEY,
    dashKeyLength: (env.DASH_KEY || '').length,
    dbSet: !!env.GoldenMed,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
