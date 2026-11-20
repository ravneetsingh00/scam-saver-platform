(() => {
  const isAdminPage = /(^|\/)admin\.html$/.test(location.pathname);
  const isDetailsPage = /(^|\/)(business-details|report-details|investigate)\.html$/.test(location.pathname);
  const tokenKey = (isAdminPage || (isDetailsPage && !localStorage.getItem('ss_token') && localStorage.getItem('ss_admin_token'))) ? 'ss_admin_token' : 'ss_token';
  const userKey = tokenKey === 'ss_admin_token' ? 'ss_admin_user' : 'ss_user';
  const token = localStorage.getItem(tokenKey);
  const target = location.pathname.split('/').pop() + location.search + location.hash;
  const signIn = () => location.replace((isAdminPage ? 'admin-login.html' : 'login.html') + '?next=' + encodeURIComponent(target));
  document.documentElement.classList.add('auth-checking');
  if (!token) { document.documentElement.classList.remove('auth-checking'); signIn(); return; }
  fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' })
    .then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.user) throw new Error('Your session has expired. Please sign in again.');
      if (isAdminPage && data.user.role !== 'admin') {
        document.documentElement.classList.remove('auth-checking');
        location.replace('dashboard.html');
        return;
      }
      localStorage.setItem(userKey, JSON.stringify(data.user));
      document.documentElement.classList.remove('auth-checking');
      window.dispatchEvent(new CustomEvent('scam-saver:auth-ready', { detail: { role: data.user.role } }));
    })
    .catch(() => {
      document.documentElement.classList.remove('auth-checking');
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(userKey);
      signIn();
    });
})();
