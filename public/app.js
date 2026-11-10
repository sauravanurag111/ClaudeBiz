// Small progressive enhancements. No AI, no frameworks.
(function () {
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      const input = document.querySelector(copyBtn.dataset.copy);
      input.select();
      (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.reject())
        .catch(() => document.execCommand('copy'))
        .finally(() => {
          const old = copyBtn.textContent;
          copyBtn.textContent = 'Copied';
          setTimeout(() => { copyBtn.textContent = old; }, 1500);
        });
      return;
    }
    const confirmBtn = e.target.closest('[data-confirm]');
    if (confirmBtn && !window.confirm(confirmBtn.dataset.confirm)) {
      e.preventDefault();
      return;
    }
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a,button,input')) window.location = row.dataset.href;
  });

  // datetime-local inputs show the viewer's local time; the server gets ISO (UTC).
  const pad = (n) => String(n).padStart(2, '0');
  document.querySelectorAll('input[type=datetime-local][data-iso]').forEach((input) => {
    const d = new Date(input.dataset.iso);
    input.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  document.querySelectorAll('form[data-local-time]').forEach((form) => {
    form.addEventListener('submit', () => {
      const local = form.querySelector('input[type=datetime-local]');
      const hidden = form.querySelector('input[name=send_at]');
      if (local && hidden && local.value) hidden.value = new Date(local.value).toISOString();
    });
  });

  // Payment screenshot on the client's invoice page: shrink images in the browser, send as a data URL.
  document.querySelectorAll('[data-proof-form]').forEach((form) => {
    const fileInput = form.querySelector('[data-proof-file]');
    const hidden = form.querySelector('input[name=proof]');
    const status = form.querySelector('[data-proof-status]');
    const button = form.querySelector('button[type=submit]');
    const MAX = 5 * 1024 * 1024;
    fileInput.addEventListener('change', () => {
      hidden.value = '';
      const file = fileInput.files[0];
      if (!file) { status.textContent = 'PNG, JPG or PDF, up to 5 MB.'; return; }
      button.disabled = true;
      status.textContent = 'Preparing file...';
      const done = (dataUrl) => {
        if (!dataUrl || dataUrl.length * 0.75 > MAX) {
          status.textContent = 'That file is too large. Please choose one under 5 MB.';
          fileInput.value = '';
        } else {
          hidden.value = dataUrl;
          status.textContent = `Attached: ${file.name}`;
        }
        button.disabled = false;
      };
      const reader = new FileReader();
      reader.onerror = () => done(null);
      if (file.type === 'application/pdf') {
        reader.onload = () => done(reader.result);
        reader.readAsDataURL(file);
        return;
      }
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          done(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => done(null);
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  });

  // Line item editor on the quote page.
  const table = document.getElementById('items');
  if (!table) return;
  const form = document.getElementById('quote-form');
  const tbody = table.querySelector('tbody');
  const currency = () => (form.querySelector('[name=currency]').value || 'INR').toUpperCase();
  const fmt = (n) => {
    try {
      return new Intl.NumberFormat(currency() === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: currency() }).format(n);
    } catch (_) { return n.toFixed(2); }
  };
  const num = (v) => Number(v) || 0;

  function readItems() {
    return [...tbody.querySelectorAll('tr')].map((tr) => ({
      description: tr.querySelector('[data-k=description]').value,
      quantity: num(tr.querySelector('[data-k=quantity]').value),
      unit_price: num(tr.querySelector('[data-k=unit_price]').value),
    }));
  }

  function recalc() {
    let subtotal = 0;
    tbody.querySelectorAll('tr').forEach((tr) => {
      const amt = num(tr.querySelector('[data-k=quantity]').value) * num(tr.querySelector('[data-k=unit_price]').value);
      subtotal += amt;
      tr.querySelector('[data-amt]').textContent = fmt(amt);
    });
    const discount = Math.min(num(form.querySelector('[name=discount]').value), subtotal);
    const taxable = subtotal - discount;
    const total = taxable + (taxable * num(form.querySelector('[name=tax_percent]').value)) / 100;
    document.getElementById('grand-total').textContent = fmt(total);
  }

  document.getElementById('add-item').addEventListener('click', () => {
    const tr = tbody.querySelector('tr').cloneNode(true);
    tr.querySelectorAll('input').forEach((i) => { i.value = i.dataset.k === 'quantity' ? '1' : ''; });
    tbody.appendChild(tr);
    tr.querySelector('input').focus();
    recalc();
  });
  tbody.addEventListener('click', (e) => {
    if (!e.target.closest('[data-del-item]')) return;
    if (tbody.querySelectorAll('tr').length > 1) e.target.closest('tr').remove();
    else e.target.closest('tr').querySelectorAll('input').forEach((i) => { i.value = ''; });
    recalc();
  });
  form.addEventListener('input', recalc);
  form.addEventListener('submit', () => {
    document.getElementById('items_json').value = JSON.stringify(readItems());
  });
  recalc();
}());
