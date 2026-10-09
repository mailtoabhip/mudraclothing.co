(() => {
  const status = document.getElementById('reservationStatus');
  const content = document.getElementById('reservationContent');
  async function load() {
    const response = await fetch('/api/customer/session', { cache: 'no-store' });
    if (!response.ok) throw new Error('Sign-in is unavailable. Please try again later.');
    const account = await response.json();
    if (!account.signedIn) {
      status.textContent = new URLSearchParams(location.search).has('error') ? 'Sign-in could not be completed. Please try again.' : 'Sign in to view your reserved tees across devices.';
      const link = document.createElement('a');
      link.className = 'btn'; link.href = '/api/customer/login'; link.textContent = 'Sign in'; content.append(link);
      return;
    }
    status.textContent = 'You are signed in. Reservation checkout is being configured.';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn'; button.textContent = 'Sign out';
    button.addEventListener('click', async () => {
      const result = await fetch('/api/customer/session', { method: 'POST', headers: { 'X-Mudra-CSRF': account.csrf } });
      if (result.ok) location.reload(); else status.textContent = 'Could not sign out. Refresh and try again.';
    });
    content.append(button);
  }
  load().catch(error => { status.textContent = error.message; });
})();
