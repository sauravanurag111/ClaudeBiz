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

  // Tabs (Connect page): Claude app vs Claude Code.
  const tabs = document.querySelectorAll('[data-tab]');
  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => { x.classList.toggle('on', x === t); x.setAttribute('aria-selected', x === t); });
    document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== t.dataset.tab; });
  }));

  // Flash messages: dismiss button, success ones fade out on their own.
  document.querySelectorAll('[data-dismiss]').forEach((b) => b.addEventListener('click', () => b.closest('.flash').classList.add('hide')));
  document.querySelectorAll('.flash[data-autohide]').forEach((f) => setTimeout(() => f.classList.add('hide'), 6000));

  // Copy example prompts with one click.
  document.querySelectorAll('[data-copy-text]').forEach((el) => el.addEventListener('click', () => {
    const text = el.textContent.trim().replace(/^"|"$/g, '');
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).catch(() => {});
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 1500);
  }));

  // "Fill in" the test account on the login page.
  document.querySelectorAll('[data-fill-demo]').forEach((b) => b.addEventListener('click', () => {
    const [email, pw] = b.dataset.fillDemo.split('|');
    document.querySelector('[name=email]').value = email;
    document.querySelector('[name=password]').value = pw;
    document.querySelector('[name=password]').focus();
  }));

  // Count-up numbers on the dashboard.
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    const cur = el.dataset.currency;
    if (reduce || !target) return;
    const fmt = (n) => {
      if (!cur) return String(Math.round(n));
      try {
        return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
      } catch (_) { return String(Math.round(n)); }
    };
    const final = el.textContent;
    const start = performance.now();
    const dur = 900;
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = p < 1 ? fmt(target * eased) : final;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  // Fade sections in as they scroll into view.
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.12 });
    revealEls.forEach((el, i) => { el.style.transitionDelay = `${(i % 4) * 70}ms`; io.observe(el); });
  } else {
    revealEls.forEach((el) => el.classList.add('in'));
  }

  // A small celebration when a quote is accepted or paid.
  if (document.querySelector('[data-celebrate]') && !reduce) {
    const c = document.createElement('canvas');
    c.className = 'confetti';
    document.body.appendChild(c);
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.scale(dpr, dpr);
    const colors = ['#5b47f5', '#8b45f2', '#c13ad9', '#0c8a5c', '#f5b942', '#38bdf8'];
    const parts = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.32,
      vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 13 - 4, r: Math.random() * 6 + 4,
      c: colors[Math.floor(Math.random() * colors.length)], a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.3,
    }));
    const t0 = performance.now();
    const tick = (t) => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach((p) => {
        p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c;
        ctx.globalAlpha = Math.max(0, 1 - (t - t0) / 2600);
        ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
      });
      if (t - t0 < 2600) requestAnimationFrame(tick); else c.remove();
    };
    requestAnimationFrame(tick);
  }

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
      return new Intl.NumberFormat(currency() === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency', currency: currency(), minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2, maximumFractionDigits: 2,
      }).format(n);
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
