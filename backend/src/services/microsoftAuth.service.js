// Delegated (interactive) OAuth2/OIDC login against the same app registration
// used for app-only mail sending (PulseServiceSMTP-OATH), but a completely
// different flow: authorization code, with a real signed-in user. This is
// what backs "Sign in with Microsoft" -- not to be confused with
// graph-mail.service.js's client-credentials flow.
//
// Required env vars (in addition to MS_TENANT_ID/MS_CLIENT_ID/MS_CLIENT_SECRET,
// already used by graph-mail.service.js):
//   MS_REDIRECT_URI - must exactly match a Redirect URI registered on the app
//                      registration's Authentication blade, e.g.
//                      https://service.pulseplatforms.com/api/v1/auth/microsoft/callback

function isConfigured() {
  return Boolean(
    process.env.MS_TENANT_ID &&
      process.env.MS_CLIENT_ID &&
      process.env.MS_CLIENT_SECRET &&
      process.env.MS_REDIRECT_URI,
  );
}

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.MS_REDIRECT_URI,
    response_mode: "query",
    scope: "openid profile email User.Read",
    state,
  });
  return `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.MS_REDIRECT_URI,
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `[microsoft-auth] Token exchange failed (${res.status}): ${json.error_description || json.error}`,
    );
  }
  return json; // { access_token, id_token, ... }
}

// Graph /me is the authoritative source for the signed-in user's profile --
// more reliable than parsing the id_token's claims by hand.
async function getProfile(accessToken) {
  const res = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,givenName,surname,displayName",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `[microsoft-auth] Failed to fetch profile (${res.status}): ${json.error?.message}`,
    );
  }
  return json;
}

module.exports = {
  isConfigured,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  getProfile,
};
