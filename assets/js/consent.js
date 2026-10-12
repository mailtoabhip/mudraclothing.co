/* Optional analytics loads only after an explicit choice. Shopping stays available either way. */
(() => {
  'use strict';
  const key = 'mudra-analytics-choice-v1', ttl = 180 * 86400000;
  const id = document.currentScript?.dataset.gaId;
  let accepted = false, loaded = false;
  function read() {
    try { const value = JSON.parse(localStorage.getItem(key)); return value && Date.now() - value.at < ttl ? value : null; } catch { return null; }
  }
  function start() {
    if (loaded || !/^G-[A-Z0-9]+$/.test(id || '')) return;
    loaded = true;
    window[`ga-disable-${id}`] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    window.gtag('js', new Date());
    let referrer = '';
    try { const from = new URL(document.referrer); if (['http:', 'https:'].includes(from.protocol)) referrer = from.origin + from.pathname; } catch {}
    window.gtag('config', id, { allow_google_signals: false, allow_ad_personalization_signals: false, page_location: location.origin + location.pathname, page_referrer: referrer });
    const script = document.createElement('script'); script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`; document.head.append(script);
  }
  function clearCookies() {
    for (const part of document.cookie.split(';')) {
      const name = part.trim().split('=')[0]; if (!/^_ga(?:_|$)/.test(name)) continue;
      for (const domain of ['', location.hostname, '.wearmudra.shop']) document.cookie = `${name}=; Max-Age=0; Path=/;${domain ? ` Domain=${domain};` : ''} SameSite=Lax; Secure`;
    }
  }
  async function withdrawSavedConsent() {
    try {
      const response = await fetch('/api/customer/session', { cache: 'no-store' });
      if (!response.ok) return;
      const account = await response.json(); if (!account.signedIn) return;
      await fetch('/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mudra-CSRF': account.csrf }, body: JSON.stringify({ action: 'forget-analytics' }) });
    } catch { /* Choice is still saved locally even when the account is unavailable. */ }
  }
  async function choose(value) {
    accepted = value;
    try { localStorage.setItem(key, JSON.stringify({ allowed: value, at: Date.now() })); } catch {}
    banner.hidden = true;
    if (value) start();
    else {
      window[`ga-disable-${id}`] = true;
      window.gtag?.('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      clearCookies(); await withdrawSavedConsent();
      // Remove already queued optional events and stop a previously loaded tag.
      if (loaded) location.reload();
    }
  }
  const banner = document.createElement('section'); banner.className = 'analytics-choice'; banner.setAttribute('aria-label', 'Analytics preferences');
  banner.innerHTML = '<p>Can we use analytics cookies? They help us understand visits, tee choices and purchases. Shopping works either way. <a href="/privacy">Privacy</a></p><div><button type="button" data-choice="no">Decline analytics</button><button type="button" data-choice="yes">Allow analytics</button></div>';
  banner.querySelector('[data-choice="no"]').addEventListener('click', () => choose(false));
  banner.querySelector('[data-choice="yes"]').addEventListener('click', () => choose(true));
  const saved = read(); accepted = saved?.allowed === true; banner.hidden = !!saved;
  document.body.append(banner);
  const preferences = document.createElement('button'); preferences.type = 'button'; preferences.className = 'analytics-preferences'; preferences.textContent = 'Cookie preferences';
  preferences.addEventListener('click', () => { banner.hidden = false; banner.querySelector('button').focus(); });
  (document.querySelector('footer') || document.body).append(preferences);
  window.MudraAnalytics = { allowed: () => accepted };
  window.addEventListener('storage', event => { if (event.key === key) location.reload(); });
  if (accepted) start(); else { window[`ga-disable-${id}`] = true; clearCookies(); }
})();
