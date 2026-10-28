// Vercel function: every /api/* request is rewritten here (see vercel.json) and handled like the local server does.
export { handler as default } from '../server.mjs';
