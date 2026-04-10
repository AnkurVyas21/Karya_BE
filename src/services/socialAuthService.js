const crypto = require('crypto');
const User = require('../models/User');
const logger = require('../utils/logger');
const authService = require('./authService');
const { normalizeSocialAccount, uniqueSocialAccounts } = require('../utils/socialAccountUtils');

const STATE_TTL_MS = 10 * 60 * 1000;
const pendingStates = new Map();

const cleanupExpiredStates = () => {
  const now = Date.now();
  for (const [state, entry] of pendingStates.entries()) {
    if (entry.expiresAt <= now) {
      pendingStates.delete(state);
    }
  }
};

setInterval(cleanupExpiredStates, STATE_TTL_MS).unref();

const splitDisplayName = (displayName = '') => {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: '', lastName: '' };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
};

const toBase64Url = (buffer) => buffer
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '');

const buildPkce = () => {
  const verifier = toBase64Url(crypto.randomBytes(48));
  const challenge = toBase64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.error_description || payload.message || payload.error?.message || payload.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
};

const SOCIAL_PROVIDERS = {
  google: {
    label: 'Google',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'profile', 'email', 'https://www.googleapis.com/auth/user.phonenumbers.read']
  },
  facebook: {
    label: 'Facebook',
    clientIdEnv: 'FACEBOOK_CLIENT_ID',
    clientSecretEnv: 'FACEBOOK_CLIENT_SECRET',
    authorizeUrl: 'https://www.facebook.com/v23.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v23.0/oauth/access_token',
    scopes: ['public_profile', 'email']
  },
  linkedin: {
    label: 'LinkedIn',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: ['openid', 'profile', 'email']
  },
  x: {
    label: 'X',
    clientIdEnv: 'TWITTER_CLIENT_ID',
    clientSecretEnv: 'TWITTER_CLIENT_SECRET',
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.x.com/2/oauth2/token',
    scopes: ['users.read', 'tweet.read', 'offline.access'],
    usesPkce: true
  }
};

class SocialAuthService {
  getSupportedProviders() {
    return Object.keys(SOCIAL_PROVIDERS);
  }

  ensureProvider(provider) {
    const config = SOCIAL_PROVIDERS[provider];
    if (!config) {
      throw new Error('Unsupported social provider');
    }

    const clientId = process.env[config.clientIdEnv];
    const clientSecret = process.env[config.clientSecretEnv];
    if (!clientId || !clientSecret) {
      throw new Error(`${config.label} login is not configured yet`);
    }

    return {
      ...config,
      provider,
      clientId,
      clientSecret
    };
  }

  getRedirectUri(req, provider) {
    const publicBackendUrl = String(process.env.PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '');
    const baseUrl = publicBackendUrl || `${req.protocol}://${req.get('host')}`;
    return `${baseUrl}/api/auth/social/${provider}/callback`;
  }

  createAuthorizationUrl(provider, req, options = {}) {
    const config = this.ensureProvider(provider);
    const intent = options.intent === 'signup' ? 'signup' : 'login';
    const signupRole = options.signupRole === 'professional' ? 'professional' : 'user';
    const frontendOrigin = String(options.frontendOrigin || '').trim();
    if (!frontendOrigin) {
      throw new Error('Missing frontend origin for social login');
    }

    const state = crypto.randomBytes(24).toString('hex');
    const redirectUri = this.getRedirectUri(req, provider);
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      state
    });

    const stateEntry = {
      provider,
      intent,
      signupRole,
      frontendOrigin,
      returnUrl: String(options.returnUrl || '').trim(),
      expiresAt: Date.now() + STATE_TTL_MS
    };

    if (config.usesPkce) {
      const pkce = buildPkce();
      stateEntry.codeVerifier = pkce.verifier;
      params.set('code_challenge', pkce.challenge);
      params.set('code_challenge_method', 'S256');
    }

    pendingStates.set(state, stateEntry);
    return `${config.authorizeUrl}?${params.toString()}`;
  }

  consumeState(state) {
    const stateEntry = pendingStates.get(state);
    if (!stateEntry) {
      throw new Error('Social login session expired. Please try again.');
    }

    pendingStates.delete(state);
    if (stateEntry.expiresAt <= Date.now()) {
      throw new Error('Social login session expired. Please try again.');
    }

    return stateEntry;
  }

  async handleCallback(provider, req) {
    const config = this.ensureProvider(provider);
    const error = String(req.query.error || '').trim();
    if (error) {
      const errorMessage = String(req.query.error_description || req.query.error || 'Social login was cancelled').trim();
      return {
        targetOrigin: String(req.query.frontendOrigin || '*'),
        payload: {
          type: 'error',
          provider,
          message: errorMessage
        }
      };
    }

    const code = String(req.query.code || '').trim();
    const state = String(req.query.state || '').trim();
    if (!code || !state) {
      throw new Error('Missing social login callback parameters');
    }

    const stateEntry = this.consumeState(state);
    const redirectUri = this.getRedirectUri(req, provider);
    const tokens = await this.exchangeCodeForTokens(config, code, redirectUri, stateEntry);
    const profile = await this.fetchSocialProfile(config, tokens.access_token);

    const normalizedProfile = {
      provider,
      providerId: String(profile.providerId || '').trim(),
      email: String(profile.email || '').trim().toLowerCase(),
      firstName: String(profile.firstName || '').trim(),
      lastName: String(profile.lastName || '').trim(),
      displayName: String(profile.displayName || '').trim(),
      mobile: String(profile.mobile || '').trim(),
      avatarUrl: String(profile.avatarUrl || '').trim(),
      profileUrl: String(profile.profileUrl || '').trim(),
      emailVerified: profile.emailVerified !== false
    };

    if (!normalizedProfile.firstName && normalizedProfile.displayName) {
      const names = splitDisplayName(normalizedProfile.displayName);
      normalizedProfile.firstName = names.firstName;
      normalizedProfile.lastName = normalizedProfile.lastName || names.lastName;
    }

    if (!normalizedProfile.providerId) {
      throw new Error(`Unable to read ${config.label} profile details`);
    }

    if (stateEntry.intent === 'signup') {
      let user = await this.findUserForSocialProfile(normalizedProfile);
      if (user && user.role !== stateEntry.signupRole) {
        throw new Error(`This social account is already linked to a ${user.role === 'professional' ? 'provider' : 'customer'} account`);
      }

      if (!user) {
        user = await authService.registerSocialUser(normalizedProfile, {
          role: stateEntry.signupRole
        });
      }

      const session = await authService.buildAuthenticatedSession(user);
      logger.info(`Social signup successful: ${user._id} via ${provider}`);

      return {
        targetOrigin: stateEntry.frontendOrigin,
        payload: {
          type: 'authenticated',
          provider,
          token: session.token,
          user: session.user,
          returnUrl: stateEntry.returnUrl
        }
      };
    }

    const user = await this.findUserForSocialProfile(normalizedProfile);
    if (!user) {
      return {
        targetOrigin: stateEntry.frontendOrigin,
        payload: {
          type: 'signup_required',
          provider,
          profile: normalizedProfile,
          message: `No Karya account was linked to this ${config.label} profile. Please complete signup.`
        }
      };
    }

    const session = await authService.buildAuthenticatedSession(user);
    logger.info(`Social login successful: ${user._id} via ${provider}`);

    return {
      targetOrigin: stateEntry.frontendOrigin,
      payload: {
        type: 'authenticated',
        provider,
        token: session.token,
        user: session.user,
        returnUrl: stateEntry.returnUrl
      }
    };
  }

  async exchangeCodeForTokens(config, code, redirectUri, stateEntry) {
    const body = new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

    if (config.usesPkce && stateEntry.codeVerifier) {
      body.set('code_verifier', stateEntry.codeVerifier);
    }

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    if (config.provider === 'x') {
      body.delete('client_secret');
      const encodedCredentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
      headers.Authorization = `Basic ${encodedCredentials}`;
    }

    return fetchJson(config.tokenUrl, {
      method: 'POST',
      headers,
      body
    });
  }

  async fetchSocialProfile(config, accessToken) {
    if (config.provider === 'google') {
      const userInfo = await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      let mobile = '';
      try {
        const people = await fetchJson('https://people.googleapis.com/v1/people/me?personFields=phoneNumbers', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        mobile = String(people.phoneNumbers?.[0]?.canonicalForm || people.phoneNumbers?.[0]?.value || '').replace(/[^\d+]/g, '');
      } catch (_error) {
        mobile = '';
      }

      return {
        providerId: userInfo.sub,
        email: userInfo.email,
        emailVerified: userInfo.email_verified,
        firstName: userInfo.given_name,
        lastName: userInfo.family_name,
        displayName: userInfo.name,
        avatarUrl: userInfo.picture,
        mobile
      };
    }

    if (config.provider === 'facebook') {
      const profile = await fetchJson(`https://graph.facebook.com/me?fields=id,first_name,last_name,name,email,picture.type(large)&access_token=${encodeURIComponent(accessToken)}`);
      return {
        providerId: profile.id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        displayName: profile.name,
        avatarUrl: profile.picture?.data?.url || ''
      };
    }

    if (config.provider === 'linkedin') {
      const profile = await fetchJson('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      return {
        providerId: profile.sub,
        email: profile.email,
        emailVerified: profile.email_verified,
        firstName: profile.given_name,
        lastName: profile.family_name,
        displayName: profile.name,
        avatarUrl: profile.picture,
        profileUrl: profile.profile
      };
    }

    if (config.provider === 'x') {
      const profile = await fetchJson('https://api.x.com/2/users/me?user.fields=profile_image_url,username,name', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return {
        providerId: profile.data?.id,
        displayName: profile.data?.name,
        firstName: profile.data?.name,
        lastName: '',
        avatarUrl: profile.data?.profile_image_url,
        profileUrl: profile.data?.username ? `https://x.com/${profile.data.username}` : ''
      };
    }

    throw new Error('Unsupported social provider');
  }

  async attachSocialAccount(user, socialProfile) {
    const nextAccounts = uniqueSocialAccounts([
      ...(Array.isArray(user.socialAccounts) ? user.socialAccounts.map((account) => ({
        provider: account.provider,
        providerId: account.providerId,
        email: account.email,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
        profileUrl: account.profileUrl
      })) : []),
      normalizeSocialAccount({
        provider: socialProfile.provider,
        providerId: socialProfile.providerId,
        email: socialProfile.email,
        displayName: socialProfile.displayName || [socialProfile.firstName, socialProfile.lastName].filter(Boolean).join(' ').trim(),
        avatarUrl: socialProfile.avatarUrl,
        profileUrl: socialProfile.profileUrl
      })
    ]);

    user.socialAccounts = nextAccounts;
    await user.save();
    return user;
  }

  async findUserForSocialProfile(socialProfile) {
    let user = await User.findOne({
      socialAccounts: {
        $elemMatch: {
          provider: socialProfile.provider,
          providerId: socialProfile.providerId
        }
      }
    });

    if (user) {
      return user;
    }

    if (socialProfile.email) {
      user = await User.findOne({ email: socialProfile.email });
      if (user) {
        return this.attachSocialAccount(user, socialProfile);
      }
    }

    return null;
  }

  renderPopupResponse(targetOrigin, payload) {
    const safeTargetOrigin = targetOrigin || '*';
    const messagePayload = JSON.stringify({
      source: 'karya-social-auth',
      ...payload
    }).replace(/</g, '\\u003c');

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Karya Social Login</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: Arial, sans-serif;
        background: linear-gradient(135deg, #eef3ff, #ffffff);
        color: #0f172a;
      }
      .card {
        max-width: 420px;
        padding: 24px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 16px 48px rgba(31, 41, 55, 0.12);
        text-align: center;
      }
      .hint {
        margin: 0;
        color: #475569;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <p class="hint">Finishing social login. This window should close automatically.</p>
    </div>
    <script>
      (function () {
        var payload = ${messagePayload};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, ${JSON.stringify(safeTargetOrigin)});
          }
        } finally {
          window.close();
          setTimeout(function () {
            document.body.innerHTML = '<div class="card"><p class="hint">' + (payload.message || 'You can close this window now.') + '</p></div>';
          }, 250);
        }
      })();
    </script>
  </body>
</html>`;
  }
}

module.exports = {
  socialAuthService: new SocialAuthService()
};
