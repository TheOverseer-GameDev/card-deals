const CERT = /^\d{7,10}$/;

export function psaCertNumber(value) {
  const text = String(value || '').trim();
  return CERT.test(text) ? text : null;
}

export function psaCertUrl(cert) {
  const number = psaCertNumber(cert);
  return number ? `https://www.psacard.com/cert/${number}` : null;
}

export function vaultListingUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const allowed = host === 'psacard.com' || host.endsWith('.psacard.com')
    || host === 'ebay.com' || host.endsWith('.ebay.com')
    || host === 'ebay.ca' || host.endsWith('.ebay.ca');
  if (!allowed) return null;
  return url.toString();
}

export function vaultFields(action) {
  const vaulted = action?.vaulted === true;
  const certRaw = String(action?.psaCert || '').trim();
  const urlRaw = String(action?.vaultUrl || '').trim();
  if (!vaulted) {
    if (certRaw || urlRaw) return { error: 'A cert number and vault link are only for a PSA Vault listing.' };
    return { error: null, vaulted: false, psaCert: null, vaultUrl: null };
  }
  const psaCert = psaCertNumber(certRaw);
  const vaultUrl = vaultListingUrl(urlRaw);
  if (!psaCert) return { error: 'PSA cert number must be 7 to 10 digits.' };
  if (!vaultUrl) return { error: 'Vault listing link must be an https link on psacard.com, ebay.com, or ebay.ca.' };
  return { error: null, vaulted: true, psaCert, vaultUrl };
}
