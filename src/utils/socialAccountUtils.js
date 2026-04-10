const normalizeSocialAccount = (account = {}) => ({
  provider: String(account.provider || '').trim(),
  providerId: String(account.providerId || '').trim(),
  email: String(account.email || '').trim().toLowerCase(),
  displayName: String(account.displayName || '').trim(),
  avatarUrl: String(account.avatarUrl || '').trim(),
  profileUrl: String(account.profileUrl || '').trim()
});

const uniqueSocialAccounts = (accounts = []) => {
  const seen = new Set();

  return accounts.filter((account) => {
    const normalized = normalizeSocialAccount(account);
    const key = `${normalized.provider}:${normalized.providerId}`;
    if (!normalized.provider || !normalized.providerId || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

module.exports = {
  normalizeSocialAccount,
  uniqueSocialAccounts
};
