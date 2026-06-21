// Pampa Meats — password gate for the orders dashboard + its data feed.
// Protects /dashboard and /api/orders with HTTP Basic Auth.
// Password is read from the DASH_PASS env var (set it in Vercel). Username can be anything.
// SECURITY: if DASH_PASS is not set, access is DENIED by default (never open).
// EXCEPTION: /api/order-create is PUBLIC (the order form must POST to it without a password).

export const config = {
  matcher: ['/dashboard', '/dashboard/(.*)', '/api/(.*)']
};

export default function middleware(req) {
  // Public endpoint: the customer order form posts here. Never gate it.
  const pathname = new URL(req.url).pathname;
  if ((pathname === '/api/order-create' || pathname === '/api/daily-digest')) return;

  const pass = process.env.DASH_PASS;
  const auth = req.headers.get('authorization') || '';

  if (pass && auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6)); // "username:password"
      const provided = decoded.slice(decoded.indexOf(':') + 1);
      if (provided === pass) {
        return; // correct password -> allow the request through
      }
    } catch (e) { /* fall through to 401 */ }
  }

  return new Response('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Pampa Meats Dashboard", charset="UTF-8"' }
  });
}
