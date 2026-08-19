// Shared 401 branch. Also answers the CORS preflight, which carries no session.

const input = $input.first().json || {};
if (input.preflight) return reply(204, {});
return reply(401, { message: 'Sign in again.' });
