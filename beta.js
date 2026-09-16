(function () {
  const form = document.getElementById('betaApplicationForm');
  const message = document.getElementById('betaFormMessage');
  const success = document.getElementById('betaSuccess');
  if (!form) return;

  const endpoint = (window.REBATIFY_BETA_ENDPOINT || '').trim();

  function setMessage(text, type) {
    message.textContent = text || '';
    message.className = 'beta-form-message' + (type ? ' ' + type : '');
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    setMessage('', '');

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    if (!endpoint || endpoint.indexOf('script.google.com') === -1) {
      setMessage('Beta signup is not connected yet. Please check back soon or contact Rebatify Support.', 'error');
      return;
    }

    const button = form.querySelector('.beta-submit');
    const originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = 'Submitting…';

    const data = new FormData(form);
    data.append('source', 'rebatifyapp.github.io/beta.html');
    data.append('submittedAtClient', new Date().toISOString());

    try {
      const params = new URLSearchParams();
      data.forEach((value, key) => params.append(key, value));

      await fetch(endpoint, {
        method: 'POST',
        mode: 'no-cors',
        headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
        body: params.toString()
      });

      form.hidden = true;
      success.hidden = false;
      success.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    } catch (error) {
      setMessage('We could not submit your application right now. Please try again in a moment.', 'error');
      button.disabled = false;
      button.innerHTML = originalText;
    }
  });
})();
