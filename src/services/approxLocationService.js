const DEFAULT_RESPONSE = {
  country: '',
  state: '',
  city: '',
  town: '',
  source: 'ip-approx'
};

const normalizeIp = (value = '') => String(value || '')
  .trim()
  .replace(/^::ffff:/i, '')
  .replace(/^\[|\]$/g, '');

const isLocalIp = (value = '') => {
  const ip = normalizeIp(value).toLowerCase();
  return !ip || ip === '::1' || ip === '127.0.0.1' || ip === 'localhost';
};

const fetchJson = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'NasdiyaApproxLocation/1.0'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    return await response.json().catch(() => null);
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const extractFromIpWhoIs = (payload) => ({
  country: String(payload?.country || '').trim(),
  state: String(payload?.region || '').trim(),
  city: String(payload?.city || '').trim(),
  town: '',
  source: 'ip-approx'
});

const extractFromIpApi = (payload) => ({
  country: String(payload?.country || '').trim(),
  state: String(payload?.regionName || '').trim(),
  city: String(payload?.city || '').trim(),
  town: '',
  source: 'ip-approx'
});

exports.lookupApproximateLocation = async (ipAddress = '') => {
  const normalizedIp = normalizeIp(ipAddress);
  if (isLocalIp(normalizedIp)) {
    return { ...DEFAULT_RESPONSE };
  }

  const ipWhoIsPayload = await fetchJson(`https://ipwho.is/${encodeURIComponent(normalizedIp)}`);
  if (ipWhoIsPayload?.success !== false) {
    const location = extractFromIpWhoIs(ipWhoIsPayload);
    if (location.country || location.state || location.city) {
      return location;
    }
  }

  const ipApiPayload = await fetchJson(`http://ip-api.com/json/${encodeURIComponent(normalizedIp)}?fields=status,country,regionName,city`);
  if (String(ipApiPayload?.status || '').toLowerCase() === 'success') {
    const location = extractFromIpApi(ipApiPayload);
    if (location.country || location.state || location.city) {
      return location;
    }
  }

  return { ...DEFAULT_RESPONSE };
};
