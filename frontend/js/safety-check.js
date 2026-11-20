(() => {
  const run = document.getElementById('runSafetyCheck');
  const reset = document.getElementById('resetSafetyCheck');
  const result = document.getElementById('safetyCheckResult');
  const checks = [...document.querySelectorAll('.safety-check-list input[type="checkbox"]')];
  if (!run || !reset || !result || checks.length !== 4) return;

  run.addEventListener('click', () => {
    const selected = new Set(checks.filter((item) => item.checked).map((item) => item.value));
    if (selected.has('secret')) {
      result.textContent = 'Stop and do not share the code, PIN, password or device access. A legitimate refund or support request should not require these. Contact your bank or service through its official app or a number you already trust.';
      result.dataset.level = 'urgent';
    } else if (selected.size) {
      result.textContent = 'Pause before replying or paying. Do not use links or contact details in the request; verify it independently through the organisation’s official app, website or a known phone number.';
      result.dataset.level = 'pause';
    } else {
      result.textContent = 'No listed warning signs selected. Still verify unusual requests independently and never share an OTP, UPI PIN or password.';
      result.dataset.level = 'clear';
    }
  });

  reset.addEventListener('click', () => {
    checks.forEach((item) => { item.checked = false; });
    result.textContent = 'Select any signs that apply, then get a practical next step.';
    result.removeAttribute('data-level');
  });
})();
