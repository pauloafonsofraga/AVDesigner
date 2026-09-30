export function accountConfiguration(env = process.env) {
  const url = env.WIRENEXUS_SUPABASE_URL, publishableKey = env.WIRENEXUS_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return { configured: false };
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) throw new Error('Account URL must use HTTPS.');
  const anon = publishableKey.startsWith('eyJ') && JSON.parse(Buffer.from(publishableKey.split('.')[1], 'base64url')).role === 'anon';
  if (!publishableKey.startsWith('sb_publishable_') && !anon) throw new Error('Only a Supabase publishable/anon key may be exposed.');
  return { configured: true, url, publishableKey };
}
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try { res.status(200).json(accountConfiguration()); }
  catch { res.status(503).json({ configured: false, error: 'Account service configuration needs administrator attention.' }); }
}
