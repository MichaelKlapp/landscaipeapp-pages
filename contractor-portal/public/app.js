const BASE_PATH = window.location.pathname.startsWith('/contractor-portal') ? '/contractor-portal' : '';

const API = {
  async request(path, opts = {}) {
    const token = localStorage.getItem('cp_token') || '';
    const headers = Object.assign(
      { 'Content-Type': 'application/json' },
      opts.headers || {},
      token ? { Authorization: `Bearer ${token}` } : {}
    );
    const res = await fetch(`${BASE_PATH}${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data && data.error ? data.error : `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  },
  login(email, password) {
    return this.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  },
  register(payload) {
    return this.request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
  },
  async uploadPhoto(file, isFeatured) {
    const token = localStorage.getItem('cp_token') || '';
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('isFeatured', String(Boolean(isFeatured)));
    const res = await fetch(`${BASE_PATH}/api/profile/photos`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data && data.error) || `Upload failed (${res.status})`);
    return data;
  },
  deletePhoto(photoId) {
    return this.request(`/api/profile/photos/${encodeURIComponent(photoId)}`, { method: 'DELETE' });
  },
  featurePhoto(photoId, isFeatured) {
    return this.request(`/api/profile/photos/${encodeURIComponent(photoId)}/feature`, {
      method: 'POST',
      body: JSON.stringify({ isFeatured: Boolean(isFeatured) })
    });
  },
  movePhoto(photoId, direction) {
    return this.request(`/api/profile/photos/${encodeURIComponent(photoId)}/move`, {
      method: 'POST',
      body: JSON.stringify({ direction })
    });
  },
  publicContractor(contractorId) {
    return this.request(`/api/public/contractors/${encodeURIComponent(contractorId)}`, { headers: {} });
  },
  logout() {
    return this.request('/api/auth/logout', { method: 'POST' });
  },
  me() {
    return this.request('/api/me');
  },
  leads() {
    return this.request('/api/leads');
  },
  lead(id) {
    return this.request(`/api/leads/${encodeURIComponent(id)}`);
  },
  interest(id) {
    return this.request(`/api/leads/${encodeURIComponent(id)}/interest`, { method: 'POST' });
  },
  withdrawInterest(id) {
    return this.request(`/api/leads/${encodeURIComponent(id)}/withdraw-interest`, { method: 'POST' });
  },
  askQuestion(id, templateId, extra) {
    return this.request(`/api/leads/${encodeURIComponent(id)}/questions`, {
      method: 'POST',
      body: JSON.stringify({ templateId, extra })
    });
  },
  billing() {
    return this.request('/api/billing');
  },
  buyCredits(amount) {
    return this.request('/api/billing/buy-credits', { method: 'POST', body: JSON.stringify({ amount }) });
  },
  profile() {
    return this.request('/api/profile');
  },
  saveProfile(profile) {
    return this.request('/api/profile', { method: 'POST', body: JSON.stringify(profile) });
  },
  adminContractors() {
    return this.request('/api/admin/contractors');
  },
  adminAddCredits(contractorId, amount, note) {
    return this.request(`/api/admin/contractors/${encodeURIComponent(contractorId)}/add-credits`, {
      method: 'POST',
      body: JSON.stringify({ amount, note })
    });
  },
  adminAcceptLead(leadId, contractorId) {
    return this.request(`/api/admin/leads/${encodeURIComponent(leadId)}/accept`, {
      method: 'POST',
      body: JSON.stringify({ contractorId })
    });
  },
  adminLeads() {
    return this.request('/api/admin/leads');
  },
  async adminCreateLead(formData) {
    const token = localStorage.getItem('cp_token') || '';
    const res = await fetch(`${BASE_PATH}/api/admin/leads`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data && data.error) || `Create lead failed (${res.status})`);
    return data;
  },
  adminSpamLead(leadId) {
    return this.request(`/api/admin/leads/${encodeURIComponent(leadId)}/spam`, { method: 'POST' });
  },
  adminResetLead(leadId) {
    return this.request(`/api/admin/leads/${encodeURIComponent(leadId)}/reset`, { method: 'POST' });
  }
};

const el = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function fmtMoneyRange(min, max) {
  if (min == null && max == null) return '—';
  const f = (n) => `$${Number(n).toLocaleString()}`;
  if (min != null && max != null) return `${f(min)} - ${f(max)}`;
  if (min != null) return `${f(min)}+`;
  return `Up to ${f(max)}`;
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso || '');
  }
}

function timeLeft(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'Expired';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  if (days > 0) return `${days}d ${h}h left`;
  const mins = Math.floor(ms / (1000 * 60));
  return `${mins}m left`;
}

function setActiveRoute(route) {
  qsa('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.route === route));
}

async function refreshMe() {
  const data = await API.me();
  window.__cp_user = data.user;
  window.__cp_credits = data.credits;
  el('welcome').textContent = `Welcome back, ${data.user.companyName || 'Company'}`;
  el('credits-balance').textContent = String(data.credits.balance);
  el('credits-available').textContent = String(data.credits.available);
  el('admin-tab').classList.toggle('hidden', data.user.role !== 'admin');
}

function renderDashboard(container) {
  const u = window.__cp_user || {};
  const c = window.__cp_credits || { balance: '—', available: '—' };

  container.innerHTML = `
    <div class="grid-3">
      <div class="card">
        <div class="muted">You have</div>
        <div style="font-size:56px; color: var(--ink); line-height: 1.05; margin-top: 6px;">${c.available}</div>
        <div class="muted">lead credits available</div>
      </div>
      <div class="card">
        <div class="muted">Plan</div>
        <div style="font-size:26px; margin-top: 10px;">${u.plan || '—'}</div>
        <div class="muted">Billing is demo-only (Stripe later)</div>
      </div>
      <div class="card">
        <div class="muted">Support</div>
        <div style="margin-top: 10px;">Phone: (503) 545-9773</div>
        <div>Email: support@landscaipeapp.com</div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="card">
      <div style="font-size:22px; color: var(--brand);">How leads work</div>
      <div class="muted" style="margin-top:8px;">
        Click <em>Interested</em> to reserve (hold) 1 credit for 4 days. If the homeowner selects you, your credit is captured and contact info unlocks.
        If the homeowner picks someone else, your held credit is released automatically.
      </div>
    </div>
  `;
}

function leadCardHtml(lead) {
  const tags = (lead.requiredTags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  const interest = lead.interest;

  const interestLine = interest
    ? `<div class="muted">Interest: ${escapeHtml(interest.status)}${interest.expiresAt ? ` • ${escapeHtml(timeLeft(interest.expiresAt))}` : ''}</div>`
    : `<div class="muted">Interest: none</div>`;

  return `
    <div class="card lead-card" data-lead-id="${escapeAttr(lead.id)}">
      <div class="lead-row">
        <div class="lead-images">
          <div class="img-box">
            <img src="${escapeAttr(lead.beforeImageUrl)}" alt="Before" />
            <div class="img-label">Before</div>
          </div>
          <div class="img-box">
            <img src="${escapeAttr(lead.afterImageUrl)}" alt="After" />
            <div class="img-label">After</div>
          </div>
        </div>

        <div>
          <div class="kv">
            <div class="k">ZIP</div>
            <div class="v">${escapeHtml(lead.zip || '—')}</div>
          </div>
          <div class="kv" style="margin-top:10px;">
            <div class="k">Budget</div>
            <div class="v">${escapeHtml(fmtMoneyRange(lead.budgetMin, lead.budgetMax))}</div>
          </div>
          <div class="kv" style="margin-top:10px;">
            <div class="k">Vibe</div>
            <div class="v">${escapeHtml(lead.vibe || '—')}</div>
          </div>
          <div class="kv" style="margin-top:10px;">
            <div class="k">Change level</div>
            <div class="v">${escapeHtml(lead.changeLevel || '—')}</div>
          </div>
          <div class="kv" style="margin-top:10px;">
            <div class="k">Posted</div>
            <div class="v">${escapeHtml(fmtDate(lead.createdAt))}</div>
          </div>
          <div style="margin-top:10px;">${interestLine}</div>
        </div>
      </div>

      <div class="tags">${tags || '<span class="muted">No specific features listed.</span>'}</div>

      <div class="divider"></div>

      <div class="actions">
        ${renderLeadActions(lead)}
      </div>

      <div class="divider"></div>

      <div class="inline">
        <div class="field" style="min-width: 220px;">
          <label>Ask a question</label>
          <select class="q-template">
            <option value="">Choose…</option>
            <option value="timeline">Timeline</option>
            <option value="access">Access constraints</option>
            <option value="materials">Materials / style</option>
            <option value="budget">Budget flexibility</option>
            <option value="scope">Scope priority</option>
          </select>
        </div>
        <div class="field" style="flex: 1; min-width: 240px;">
          <label>Optional detail (no contact info)</label>
          <input class="q-extra" type="text" placeholder="Short note…" maxlength="120" />
        </div>
        <button class="btn btn-outline q-send" type="button">Send</button>
        <div class="muted" style="font-size: 13px;">Messages are filtered to block emails/phones/links.</div>
      </div>
      <div class="error q-error" role="alert" aria-live="polite"></div>
    </div>
  `;
}

function renderLeadActions(lead) {
  const i = lead.interest;
  const status = lead.status;

  if (status === 'assigned') {
    return `<div class="muted">Status: assigned to you. Open lead to see contact details.</div>
            <button class="btn btn-primary view-lead" type="button">View details</button>`;
  }

  if (!i) {
    return `<button class="btn btn-primary interest" type="button">Interested (hold 1 credit)</button>`;
  }

  if (i.status === 'held') {
    return `
      <button class="btn btn-outline withdraw" type="button">Withdraw interest</button>
      <div class="muted">Hold expires in ${escapeHtml(timeLeft(i.expiresAt))}.</div>
    `;
  }

  if (i.status === 'captured') {
    return `<div class="muted">You were accepted for this lead.</div>
            <button class="btn btn-primary view-lead" type="button">View details</button>`;
  }

  return `<div class="muted">Interest status: ${escapeHtml(i.status)}</div>`;
}

async function renderLeads(container) {
  container.innerHTML = `<div class="card"><div class="muted">Loading leads…</div></div>`;
  const { leads } = await API.leads();
  const user = window.__cp_user || {};
  const hasServiceZips = Array.isArray(user.serviceZips) && user.serviceZips.length > 0;

  container.innerHTML = `
    <div class="card" style="margin-bottom:14px;">
      <div style="display:flex; gap:12px; flex-wrap: wrap; align-items:center; justify-content: space-between;">
        <div>
          <div style="font-size:20px; color: var(--brand);">Leads</div>
          <div class="muted">Click Interested to reserve a credit for 4 days. Contact info unlocks only if the homeowner selects you.</div>
        </div>
        <button class="btn btn-outline" id="refresh-leads" type="button">Refresh</button>
      </div>
    </div>

    <div style="display:grid; gap:14px;">
      ${
        leads.length
          ? leads.map(leadCardHtml).join('')
          : !hasServiceZips
            ? `<div class="card">
                 <div style="font-size:18px; color: var(--brand);">Set your service ZIPs to see leads</div>
                 <div class="muted" style="margin-top:6px;">Right now your account has no service ZIPs saved, so matching will return zero leads.</div>
                 <div style="margin-top:12px;">
                   <button class="btn btn-primary" id="go-profile" type="button">Go to Profile</button>
                 </div>
               </div>`
            : `<div class="card"><div class="muted">No leads match your service area right now.</div></div>`
      }
    </div>
  `;

  el('refresh-leads').addEventListener('click', async () => {
    await navigate('leads');
  });

  const goProfile = el('go-profile');
  if (goProfile) {
    goProfile.addEventListener('click', async () => {
      await navigate('profile');
    });
  }

  qsa('.lead-card', container).forEach((card) => wireLeadCard(card));
}

function wireLeadCard(cardEl) {
  const leadId = cardEl.dataset.leadId;

  const setCardError = (msg) => {
    const e = qs('.q-error', cardEl);
    e.textContent = msg || '';
  };

  const interestBtn = qs('button.interest', cardEl);
  if (interestBtn) {
    interestBtn.addEventListener('click', async () => {
      setCardError('');
      interestBtn.disabled = true;
      try {
        await API.interest(leadId);
        await refreshMe();
        await navigate('leads');
      } catch (err) {
        setCardError(err.message);
        interestBtn.disabled = false;
      }
    });
  }

  const withdrawBtn = qs('button.withdraw', cardEl);
  if (withdrawBtn) {
    withdrawBtn.addEventListener('click', async () => {
      setCardError('');
      withdrawBtn.disabled = true;
      try {
        await API.withdrawInterest(leadId);
        await refreshMe();
        await navigate('leads');
      } catch (err) {
        setCardError(err.message);
        withdrawBtn.disabled = false;
      }
    });
  }

  const viewBtn = qs('button.view-lead', cardEl);
  if (viewBtn) {
    viewBtn.addEventListener('click', async () => {
      setCardError('');
      viewBtn.disabled = true;
      try {
        const { lead } = await API.lead(leadId);
        showLeadModal(lead);
      } catch (err) {
        setCardError(err.message);
      } finally {
        viewBtn.disabled = false;
      }
    });
  }

  const sendBtn = qs('button.q-send', cardEl);
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      setCardError('');
      const template = qs('select.q-template', cardEl).value;
      const extra = qs('input.q-extra', cardEl).value;
      if (!template) return setCardError('Choose a question template.');
      sendBtn.disabled = true;
      try {
        await API.askQuestion(leadId, template, extra);
        qs('select.q-template', cardEl).value = '';
        qs('input.q-extra', cardEl).value = '';
        setCardError('Question sent.');
        setTimeout(() => setCardError(''), 1600);
      } catch (err) {
        setCardError(err.message);
      } finally {
        sendBtn.disabled = false;
      }
    });
  }
}

function showLeadModal(lead) {
  const full = lead.homeowner && lead.homeowner.email;
  const homeownerBlock = full
    ? `<div class="card" style="margin-top: 12px;">
         <div style="font-size: 20px; color: var(--brand);">Homeowner contact (unlocked)</div>
         <div style="margin-top: 8px;"><span class="muted">Name:</span> ${escapeHtml(lead.homeowner.displayName || '—')}</div>
         <div><span class="muted">Email:</span> ${escapeHtml(lead.homeowner.email || '—')}</div>
         <div><span class="muted">Phone:</span> ${escapeHtml(lead.homeowner.phone || '—')}</div>
       </div>`
    : `<div class="card" style="margin-top: 12px;">
         <div style="font-size: 20px; color: var(--brand);">Homeowner contact</div>
         <div class="muted" style="margin-top: 8px;">Contact info stays hidden until the homeowner accepts you.</div>
       </div>`;

  const modal = document.createElement('div');
  modal.style.position = 'fixed';
  modal.style.inset = '0';
  modal.style.background = 'rgba(0,0,0,0.35)';
  modal.style.display = 'grid';
  modal.style.placeItems = 'center';
  modal.style.padding = '18px';
  modal.style.zIndex = '9999';

  modal.innerHTML = `
    <div class="card" style="width: min(980px, 100%); max-height: 90vh; overflow: auto;">
      <div style="display:flex; align-items:center; justify-content: space-between; gap: 12px;">
        <div style="font-size: 22px; color: var(--brand);">Lead ${escapeHtml(lead.id)}</div>
        <button class="btn btn-ghost close" type="button">Close</button>
      </div>
      <div class="divider"></div>
      <div class="lead-images">
        <div class="img-box">
          <img src="${escapeAttr(lead.beforeImageUrl)}" alt="Before" />
          <div class="img-label">Before</div>
        </div>
        <div class="img-box">
          <img src="${escapeAttr(lead.afterImageUrl)}" alt="After" />
          <div class="img-label">After</div>
        </div>
      </div>
      ${homeownerBlock}
      <div class="divider"></div>
      <div class="muted">This modal is for demo. In production you’ll also see homeowner-side acceptance timestamps, message history, and project status.</div>
    </div>
  `;

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
  qs('button.close', modal).addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}

async function renderBilling(container) {
  container.innerHTML = `<div class="card"><div class="muted">Loading billing…</div></div>`;
  const data = await API.billing();
  container.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div style="font-size: 20px; color: var(--brand);">Lead Credits</div>
        <div style="margin-top: 8px;">Balance: <strong>${escapeHtml(String(data.credits.balance))}</strong></div>
        <div>Available (after holds): <strong>${escapeHtml(String(data.credits.available))}</strong></div>
        <div class="divider"></div>
        <div class="inline">
          <div class="field" style="min-width: 180px;">
            <label>Buy credits (demo)</label>
            <input id="buy-amount" type="number" min="1" max="100" value="5" />
          </div>
          <button id="buy-btn" class="btn btn-primary" type="button">Buy</button>
        </div>
        <div id="buy-msg" class="muted" style="margin-top: 10px;"></div>
      </div>

      <div class="card">
        <div style="font-size: 20px; color: var(--brand);">Auto-reload</div>
        <div class="muted" style="margin-top: 8px;">
          For v1 this is display-only. In production this will be backed by Stripe saved card + webhook fulfillment.
        </div>
        <div class="divider"></div>
        <div class="muted">Enabled: ${escapeHtml(String(Boolean(data.autoReload && data.autoReload.enabled)))}</div>
        <div class="muted">Threshold: ${escapeHtml(String((data.autoReload && data.autoReload.threshold) || 0))}</div>
        <div class="muted">Reload amount: ${escapeHtml(String((data.autoReload && data.autoReload.reloadAmount) || 0))}</div>
      </div>
    </div>
  `;

  el('buy-btn').addEventListener('click', async () => {
    const amount = Number(el('buy-amount').value || 0);
    el('buy-btn').disabled = true;
    el('buy-msg').textContent = '';
    try {
      await API.buyCredits(amount);
      await refreshMe();
      el('buy-msg').textContent = 'Credits added (demo).';
    } catch (err) {
      el('buy-msg').textContent = err.message;
    } finally {
      el('buy-btn').disabled = false;
    }
  });
}

async function renderProfile(container) {
  container.innerHTML = `<div class="card"><div class="muted">Loading profile…</div></div>`;
  const { profile } = await API.profile();

  const majorOptions = ['Landscape Construction', 'Landscape Design/Build'];
  const subOptions = ['Lights', 'Walkways', 'Water Features', 'Structures', 'Fencing', 'Flowers', 'Bushes'];

  container.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div style="font-size: 20px; color: var(--brand);">Company Information</div>
        <div class="divider"></div>
        <div class="field">
          <label>Business name</label>
          <input id="p-company" type="text" value="${escapeAttr(profile.companyName || '')}" />
        </div>
        <div class="field">
          <label>Owner name</label>
          <input id="p-owner" type="text" value="${escapeAttr(profile.ownerName || '')}" />
        </div>
        <div class="field">
          <label>Tagline (optional)</label>
          <input id="p-tagline" type="text" value="${escapeAttr(profile.tagline || '')}" />
        </div>
        <button id="p-save" class="btn btn-primary" type="button">Save</button>
        <div id="p-msg" class="muted" style="margin-top: 10px;"></div>
      </div>

      <div class="card">
        <div style="font-size: 20px; color: var(--brand);">Service Areas (ZIPs)</div>
        <div class="divider"></div>
        <div class="inline">
          <div class="field" style="min-width: 180px;">
            <label>Enter ZIP</label>
            <input id="zip-add" type="text" placeholder="97062" maxlength="10" />
          </div>
          <button id="zip-add-btn" class="btn btn-outline" type="button">Add ZIP</button>
        </div>
        <div id="zip-list" class="tags" style="margin-top: 12px;"></div>
        <div style="margin-top: 12px;" class="inline">
          <button id="zip-save" class="btn btn-primary" type="button">Save ZIPs</button>
          <span id="zip-msg" class="muted"></span>
        </div>
      </div>
    </div>

    <div style="height: 14px;"></div>

    <div class="card">
      <div style="font-size: 20px; color: var(--brand);">Business Type and Service Categories</div>
      <div class="divider"></div>
      <div class="grid-2">
        <div>
          <div class="muted">Major categories</div>
          ${majorOptions
            .map(
              (m) => `
            <label style="display:flex; gap:10px; align-items:center; margin-top: 10px;">
              <input class="maj" type="checkbox" value="${escapeAttr(m)}" ${profile.majorCategories && profile.majorCategories.includes(m) ? 'checked' : ''} />
              <span>${escapeHtml(m)}</span>
            </label>`
            )
            .join('')}
        </div>
        <div>
          <div class="muted">Sub-categories</div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px;">
            ${subOptions
              .map(
                (s) => `
              <label style="display:flex; gap:10px; align-items:center;">
                <input class="sub" type="checkbox" value="${escapeAttr(s)}" ${profile.subCategories && profile.subCategories.includes(s) ? 'checked' : ''} />
                <span>${escapeHtml(s)}</span>
              </label>`
              )
              .join('')}
          </div>
        </div>
      </div>
      <div style="margin-top: 12px;">
        <button id="cat-save" class="btn btn-primary" type="button">Save categories</button>
        <span id="cat-msg" class="muted" style="margin-left: 10px;"></span>
      </div>
    </div>

    <div style="height: 14px;"></div>

    <div class="grid-2">
      <div class="card">
        <div style="display:flex; align-items:center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
          <div>
            <div style="font-size: 20px; color: var(--brand);">Portfolio Photos</div>
            <div class="muted">Up to 10 total. Choose up to 3 featured photos (shown first to homeowners).</div>
          </div>
          <div class="pill pill-muted"><span id="photo-count">0</span>/10</div>
        </div>
        <div class="divider"></div>

        <div class="inline">
          <div class="field" style="min-width: 260px;">
            <label>Add photo</label>
            <input id="photo-file" type="file" accept="image/*" />
          </div>
          <label style="display:flex; gap:10px; align-items:center; padding-bottom: 6px;">
            <input id="photo-feature" type="checkbox" />
            <span>Make featured</span>
          </label>
          <button id="photo-upload" class="btn btn-primary" type="button">Upload</button>
          <div id="photo-msg" class="muted"></div>
        </div>

        <div style="height: 12px;"></div>
        <div id="photo-grid" class="photo-grid"></div>
      </div>

      <div class="card">
        <div style="font-size: 20px; color: var(--brand);">Homeowner Preview</div>
        <div class="muted" style="margin-top: 6px;">This is exactly what the app can render: 3 featured photos + “View all”.</div>
        <div class="divider"></div>
        <div id="preview-featured" class="preview-row"></div>
        <div style="height: 10px;"></div>
        <button id="preview-viewall" class="btn btn-outline" type="button">View all</button>
      </div>
    </div>
  `;

  let zips = Array.isArray(profile.serviceZips) ? [...profile.serviceZips] : [];
  const renderZips = () => {
    el('zip-list').innerHTML = zips
      .map((z) => `<span class="tag" data-zip="${escapeAttr(z)}">${escapeHtml(z)} <button class="btn btn-ghost" style="padding:0 6px;" type="button" data-remove="${escapeAttr(z)}">x</button></span>`)
      .join('');
    qsa('[data-remove]', el('zip-list')).forEach((b) => {
      b.addEventListener('click', () => {
        const rz = b.getAttribute('data-remove');
        zips = zips.filter((x) => x !== rz);
        renderZips();
      });
    });
  };
  renderZips();

  el('zip-add-btn').addEventListener('click', () => {
    const v = String(el('zip-add').value || '').trim();
    if (!v) return;
    if (!zips.includes(v)) zips.push(v);
    el('zip-add').value = '';
    renderZips();
  });

  el('zip-save').addEventListener('click', async () => {
    el('zip-save').disabled = true;
    el('zip-msg').textContent = '';
    try {
      await API.saveProfile({ serviceZips: zips });
      await refreshMe();
      el('zip-msg').textContent = 'Saved.';
    } catch (err) {
      el('zip-msg').textContent = err.message;
    } finally {
      el('zip-save').disabled = false;
    }
  });

  el('p-save').addEventListener('click', async () => {
    el('p-save').disabled = true;
    el('p-msg').textContent = '';
    try {
      await API.saveProfile({
        companyName: el('p-company').value,
        ownerName: el('p-owner').value,
        tagline: el('p-tagline').value,
        serviceZips: zips
      });
      await refreshMe();
      el('p-msg').textContent = 'Saved.';
    } catch (err) {
      el('p-msg').textContent = err.message;
    } finally {
      el('p-save').disabled = false;
    }
  });

  el('cat-save').addEventListener('click', async () => {
    el('cat-save').disabled = true;
    el('cat-msg').textContent = '';
    const majors = qsa('input.maj:checked', container).map((x) => x.value);
    const subs = qsa('input.sub:checked', container).map((x) => x.value);
    try {
      await API.saveProfile({ majorCategories: majors, subCategories: subs, serviceZips: zips });
      el('cat-msg').textContent = 'Saved.';
    } catch (err) {
      el('cat-msg').textContent = err.message;
    } finally {
      el('cat-save').disabled = false;
    }
  });

  // ---- Portfolio photos + homeowner preview ----
  let previewAll = [];
  let previewFeatured = [];

  const renderPreview = () => {
    el('preview-featured').innerHTML = previewFeatured.length
      ? previewFeatured
          .map(
            (p) => `
        <div class="preview-img">
          <img src="${escapeAttr(p.thumbUrl || p.url)}" alt="" />
        </div>`
          )
          .join('')
      : `<div class="muted">No featured photos selected yet.</div>`;
  };

  const refreshPreview = async () => {
    const preview = await API.publicContractor(profile.id);
    previewFeatured = (preview.contractor && preview.contractor.featuredPhotos) || [];
    previewAll = (preview.contractor && preview.contractor.allPhotos) || [];
    renderPreview();
  };

  // "View all" should always use the latest list
  el('preview-viewall').addEventListener('click', () => showGalleryModal(previewAll));

  const renderPhotos = async (photos) => {
    const list = Array.isArray(photos) ? photos : [];
    const featuredCount = list.filter((p) => p.isFeatured).length;
    el('photo-count').textContent = String(list.length);

    el('photo-grid').innerHTML = list.length
      ? list
          .map((p, idx) => {
            const badge = p.isFeatured ? `<span class="photo-badge">Featured</span>` : '';
            return `
              <div class="photo-tile" data-photo-id="${escapeAttr(p.id)}">
                <div class="photo-img">
                  <img src="${escapeAttr(p.thumbUrl || p.url)}" alt="" />
                  ${badge}
                </div>
                <div class="photo-actions">
                  <button class="btn btn-outline btn-sm move-up" type="button" ${idx === 0 ? 'disabled' : ''}>↑</button>
                  <button class="btn btn-outline btn-sm move-down" type="button" ${idx === list.length - 1 ? 'disabled' : ''}>↓</button>
                  <button class="btn btn-outline btn-sm toggle-feature" type="button">${p.isFeatured ? 'Unfeature' : 'Feature'}</button>
                  <button class="btn btn-danger btn-sm delete" type="button">Delete</button>
                </div>
              </div>
            `;
          })
          .join('')
      : `<div class="muted">No photos yet. Upload up to 10.</div>`;

    qsa('.photo-tile', el('photo-grid')).forEach((tile) => {
      const photoId = tile.dataset.photoId;
      const btnUp = qs('button.move-up', tile);
      const btnDown = qs('button.move-down', tile);
      const btnToggle = qs('button.toggle-feature', tile);
      const btnDelete = qs('button.delete', tile);

      btnUp.addEventListener('click', async () => {
        el('photo-msg').textContent = '';
        try {
          const r = await API.movePhoto(photoId, 'up');
          await renderPhotos(r.photos);
          await refreshMe();
          await refreshPreview();
        } catch (err) {
          el('photo-msg').textContent = err.message;
        }
      });
      btnDown.addEventListener('click', async () => {
        el('photo-msg').textContent = '';
        try {
          const r = await API.movePhoto(photoId, 'down');
          await renderPhotos(r.photos);
          await refreshMe();
          await refreshPreview();
        } catch (err) {
          el('photo-msg').textContent = err.message;
        }
      });
      btnToggle.addEventListener('click', async () => {
        el('photo-msg').textContent = '';
        const want = btnToggle.textContent === 'Feature';
        if (want && featuredCount >= 3) return (el('photo-msg').textContent = 'You can only feature 3 photos.');
        try {
          const r = await API.featurePhoto(photoId, want);
          await renderPhotos(r.photos);
          await refreshMe();
          await refreshPreview();
        } catch (err) {
          el('photo-msg').textContent = err.message;
        }
      });
      btnDelete.addEventListener('click', async () => {
        el('photo-msg').textContent = '';
        try {
          const r = await API.deletePhoto(photoId);
          await renderPhotos(r.photos);
          await refreshMe();
          await refreshPreview();
        } catch (err) {
          el('photo-msg').textContent = err.message;
        }
      });
    });
  };

  await renderPhotos(profile.photos || []);

  el('photo-upload').addEventListener('click', async () => {
    const fileInput = el('photo-file');
    const file = fileInput.files && fileInput.files[0];
    el('photo-msg').textContent = '';
    if (!file) return (el('photo-msg').textContent = 'Choose an image file.');
    el('photo-upload').disabled = true;
    try {
      const res = await API.uploadPhoto(file, el('photo-feature').checked);
      fileInput.value = '';
      el('photo-feature').checked = false;
      el('photo-msg').textContent = 'Uploaded.';
      await renderPhotos(res.photos);
      await refreshMe();
      await refreshPreview();
      setTimeout(() => (el('photo-msg').textContent = ''), 1400);
    } catch (err) {
      el('photo-msg').textContent = err.message;
    } finally {
      el('photo-upload').disabled = false;
    }
  });

  // Initial homeowner preview (app-facing payload)
  await refreshPreview();
}

function showGalleryModal(photos) {
  const list = Array.isArray(photos) ? photos : [];
  const modal = document.createElement('div');
  modal.style.position = 'fixed';
  modal.style.inset = '0';
  modal.style.background = 'rgba(0,0,0,0.35)';
  modal.style.display = 'grid';
  modal.style.placeItems = 'center';
  modal.style.padding = '18px';
  modal.style.zIndex = '9999';

  modal.innerHTML = `
    <div class="card" style="width: min(980px, 100%); max-height: 90vh; overflow: auto;">
      <div style="display:flex; align-items:center; justify-content: space-between; gap: 12px;">
        <div style="font-size: 22px; color: var(--brand);">All Photos</div>
        <button class="btn btn-ghost close" type="button">Close</button>
      </div>
      <div class="divider"></div>
      <div class="gallery-grid">
        ${list.map((p) => `<div class="gallery-img"><img src="${escapeAttr(p.url)}" alt="" /></div>`).join('')}
      </div>
      ${list.length ? '' : `<div class="muted">No photos yet.</div>`}
    </div>
  `;

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
  qs('button.close', modal).addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}

async function renderAdmin(container) {
  container.innerHTML = `<div class="card"><div class="muted">Loading admin…</div></div>`;
  const { contractors } = await API.adminContractors();
  const list = contractors.filter((c) => c.role !== 'admin');
  const { leads } = await API.adminLeads();

  container.innerHTML = `
    <div class="card">
      <div style="font-size: 20px; color: var(--brand);">Admin tools (demo)</div>
      <div class="muted" style="margin-top: 8px;">Simulate homeowner acceptance and adjust contractor credits. App integration will call the acceptance endpoint directly.</div>
    </div>

    <div style="height: 14px;"></div>

    <div class="card">
      <div style="font-size: 18px; color: var(--brand);">Create Lead (requires Before + After)</div>
      <div class="muted" style="margin-top: 6px;">This simulates the app creating a lead so we can test matching, holds, and acceptance.</div>
      <div class="divider"></div>
      <div class="grid-2">
        <div>
          <div class="field">
            <label>Homeowner name</label>
            <input id="lead-homeowner-name" type="text" placeholder="Casey" />
          </div>
          <div class="field">
            <label>Homeowner email</label>
            <input id="lead-homeowner-email" type="email" placeholder="casey@example.com" />
          </div>
          <div class="field">
            <label>Homeowner phone</label>
            <input id="lead-homeowner-phone" type="tel" placeholder="+15035550123" />
          </div>
          <div class="field">
            <label>ZIP</label>
            <input id="lead-zip" type="text" placeholder="97062" />
          </div>
          <div class="inline">
            <div class="field" style="min-width: 160px;">
              <label>Budget min</label>
              <input id="lead-budget-min" type="number" placeholder="1000" />
            </div>
            <div class="field" style="min-width: 160px;">
              <label>Budget max</label>
              <input id="lead-budget-max" type="number" placeholder="2500" />
            </div>
          </div>
        </div>
        <div>
          <div class="field">
            <label>Vibe</label>
            <input id="lead-vibe" type="text" placeholder="Modern / clean lines" />
          </div>
          <div class="field">
            <label>Change level</label>
            <input id="lead-change" type="text" placeholder="Medium" />
          </div>
          <div class="field">
            <label>Major categories (comma-separated)</label>
            <input id="lead-majors" type="text" placeholder="Landscape Construction" />
          </div>
          <div class="field">
            <label>Required tags (comma-separated)</label>
            <input id="lead-tags" type="text" placeholder="Walkways, Lights, Structures" />
          </div>
          <div class="inline">
            <div class="field" style="min-width: 240px;">
              <label>Before image (required)</label>
              <input id="lead-before" type="file" accept="image/*" />
            </div>
            <div class="field" style="min-width: 240px;">
              <label>After image (required)</label>
              <input id="lead-after" type="file" accept="image/*" />
            </div>
          </div>
        </div>
      </div>
      <div style="margin-top: 12px;" class="inline">
        <button id="lead-create" class="btn btn-primary" type="button">Create Lead</button>
        <div id="lead-create-msg" class="muted"></div>
      </div>
    </div>

    <div style="height: 14px;"></div>

    <div class="grid-2">
      <div class="card">
        <div style="font-size: 18px; color: var(--brand);">Add credits</div>
        <div class="divider"></div>
        <div class="field">
          <label>Contractor</label>
          <select id="adm-ctr">
            ${list.map((c) => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.companyName)} (${escapeHtml(c.email)})</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Amount</label>
          <input id="adm-amt" type="number" value="5" />
        </div>
        <div class="field">
          <label>Note</label>
          <input id="adm-note" type="text" value="Admin adjustment (demo)" />
        </div>
        <button id="adm-add" class="btn btn-primary" type="button">Add Credits</button>
        <div id="adm-add-msg" class="muted" style="margin-top: 10px;"></div>
      </div>

      <div class="card">
        <div style="font-size: 18px; color: var(--brand);">Force homeowner acceptance</div>
        <div class="divider"></div>
        <div class="muted">Pick a lead and a contractor who has a held interest.</div>
        <div class="field" style="margin-top:10px;">
          <label>Lead ID</label>
          <input id="adm-lead" type="text" placeholder="lead_1" />
        </div>
        <div class="field">
          <label>Contractor ID</label>
          <input id="adm-win" type="text" placeholder="ctr_1" />
        </div>
        <button id="adm-accept" class="btn btn-primary" type="button">Accept Contractor</button>
        <div id="adm-accept-msg" class="muted" style="margin-top: 10px;"></div>
      </div>
    </div>

    <div style="height: 14px;"></div>

    <div class="card">
      <div style="display:flex; align-items:center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
        <div>
          <div style="font-size: 18px; color: var(--brand);">Leads</div>
          <div class="muted">Quick view + actions for testing.</div>
        </div>
        <button id="adm-refresh-leads" class="btn btn-outline" type="button">Refresh</button>
      </div>
      <div class="divider"></div>
      <div style="display:grid; gap: 12px;">
        ${
          leads && leads.length
            ? leads
                .map((l) => {
                  return `
            <div class="card" style="box-shadow:none; border-style: dashed;">
              <div style="display:flex; align-items:center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                <div>
                  <div><strong>${escapeHtml(l.id)}</strong> <span class="muted">(${escapeHtml(l.status)})</span></div>
                  <div class="muted">ZIP ${escapeHtml(l.zip)} • Budget ${escapeHtml(fmtMoneyRange(l.budgetMin, l.budgetMax))}</div>
                </div>
                <div class="actions">
                  <button class="btn btn-outline btn-sm adm-copy" data-lead-id="${escapeAttr(l.id)}" type="button">Copy ID</button>
                  <button class="btn btn-outline btn-sm adm-reset" data-lead-id="${escapeAttr(l.id)}" type="button">Reset</button>
                  <button class="btn btn-danger btn-sm adm-spam" data-lead-id="${escapeAttr(l.id)}" type="button">Spam</button>
                </div>
              </div>
              <div style="height: 10px;"></div>
              <div class="lead-images">
                <div class="img-box"><img src="${escapeAttr(l.beforeImageUrl)}" alt="" /><div class="img-label">Before</div></div>
                <div class="img-box"><img src="${escapeAttr(l.afterImageUrl)}" alt="" /><div class="img-label">After</div></div>
              </div>
            </div>
          `;
                })
                .join('')
            : `<div class="muted">No leads yet. Create one above.</div>`
        }
      </div>
      <div id="adm-leads-msg" class="muted" style="margin-top: 10px;"></div>
    </div>
  `;

  el('lead-create').addEventListener('click', async () => {
    el('lead-create').disabled = true;
    el('lead-create-msg').textContent = '';

    const before = el('lead-before').files && el('lead-before').files[0];
    const after = el('lead-after').files && el('lead-after').files[0];
    if (!before || !after) {
      el('lead-create-msg').textContent = 'Both before and after images are required.';
      el('lead-create').disabled = false;
      return;
    }

    const fd = new FormData();
    fd.append('homeownerName', el('lead-homeowner-name').value);
    fd.append('homeownerEmail', el('lead-homeowner-email').value);
    fd.append('homeownerPhone', el('lead-homeowner-phone').value);
    fd.append('zip', el('lead-zip').value);
    fd.append('budgetMin', el('lead-budget-min').value);
    fd.append('budgetMax', el('lead-budget-max').value);
    fd.append('vibe', el('lead-vibe').value);
    fd.append('changeLevel', el('lead-change').value);
    fd.append('majorCategories', el('lead-majors').value);
    fd.append('requiredTags', el('lead-tags').value);
    fd.append('before', before);
    fd.append('after', after);

    try {
      const r = await API.adminCreateLead(fd);
      el('lead-create-msg').textContent = `Created ${r.lead.id}.`;
      // helpful: prefill force-accept lead id
      el('adm-lead').value = r.lead.id;
    } catch (err) {
      el('lead-create-msg').textContent = err.message;
    } finally {
      el('lead-create').disabled = false;
    }
  });

  el('adm-add').addEventListener('click', async () => {
    el('adm-add').disabled = true;
    el('adm-add-msg').textContent = '';
    try {
      await API.adminAddCredits(el('adm-ctr').value, Number(el('adm-amt').value), el('adm-note').value);
      el('adm-add-msg').textContent = 'Done.';
      await refreshMe();
    } catch (err) {
      el('adm-add-msg').textContent = err.message;
    } finally {
      el('adm-add').disabled = false;
    }
  });

  el('adm-accept').addEventListener('click', async () => {
    el('adm-accept').disabled = true;
    el('adm-accept-msg').textContent = '';
    try {
      await API.adminAcceptLead(String(el('adm-lead').value || '').trim(), String(el('adm-win').value || '').trim());
      el('adm-accept-msg').textContent = 'Lead assigned.';
    } catch (err) {
      el('adm-accept-msg').textContent = err.message;
    } finally {
      el('adm-accept').disabled = false;
    }
  });

  el('adm-refresh-leads').addEventListener('click', async () => {
    await navigate('admin');
  });

  qsa('button.adm-copy', container).forEach((b) => {
    b.addEventListener('click', async () => {
      const id = b.getAttribute('data-lead-id');
      try {
        await navigator.clipboard.writeText(id);
        el('adm-leads-msg').textContent = `Copied ${id}`;
        setTimeout(() => (el('adm-leads-msg').textContent = ''), 1200);
      } catch {
        el('adm-leads-msg').textContent = id;
      }
    });
  });

  qsa('button.adm-spam', container).forEach((b) => {
    b.addEventListener('click', async () => {
      const id = b.getAttribute('data-lead-id');
      el('adm-leads-msg').textContent = '';
      b.disabled = true;
      try {
        await API.adminSpamLead(id);
        el('adm-leads-msg').textContent = `Marked ${id} as spam.`;
        await navigate('admin');
      } catch (err) {
        el('adm-leads-msg').textContent = err.message;
        b.disabled = false;
      }
    });
  });

  qsa('button.adm-reset', container).forEach((b) => {
    b.addEventListener('click', async () => {
      const id = b.getAttribute('data-lead-id');
      el('adm-leads-msg').textContent = '';
      b.disabled = true;
      try {
        await API.adminResetLead(id);
        el('adm-leads-msg').textContent = `Reset ${id} to open.`;
        await navigate('admin');
      } catch (err) {
        el('adm-leads-msg').textContent = err.message;
        b.disabled = false;
      }
    });
  });
}

async function navigate(route) {
  setActiveRoute(route);
  const titleMap = { dashboard: 'Dashboard', leads: 'Leads', billing: 'Billing', profile: 'Profile', admin: 'Admin' };
  el('page-title').textContent = titleMap[route] || 'Dashboard';
  const container = el('page-body');

  if (route === 'dashboard') return renderDashboard(container);
  if (route === 'leads') return renderLeads(container);
  if (route === 'billing') return renderBilling(container);
  if (route === 'profile') return renderProfile(container);
  if (route === 'admin') return renderAdmin(container);

  return renderDashboard(container);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, '&#096;');
}

async function bootAuthed() {
  el('login').classList.add('hidden');
  el('shell').classList.remove('hidden');

  await refreshMe();
  await navigate('dashboard');
}

async function boot() {
  const token = localStorage.getItem('cp_token');
  if (token) {
    try {
      await bootAuthed();
      return;
    } catch {
      localStorage.removeItem('cp_token');
    }
  }
  el('login').classList.remove('hidden');
  el('shell').classList.add('hidden');
}

el('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('login-error').textContent = '';
  const email = el('email').value;
  const password = el('password').value;
  const btn = qs('button[type="submit"]', el('login-form'));
  btn.disabled = true;
  try {
    const data = await API.login(email, password);
    localStorage.setItem('cp_token', data.token);
    await bootAuthed();
  } catch (err) {
    el('login-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

const handleLogout = async () => {
  try {
    await API.logout();
  } catch {
    // ignore
  }
  localStorage.removeItem('cp_token');
  location.reload();
};

el('logout').addEventListener('click', handleLogout);
if (el('sidebar-logout')) {
  el('sidebar-logout').addEventListener('click', handleLogout);
}

qsa('.nav-item').forEach((b) => {
  b.addEventListener('click', async () => {
    const route = b.dataset.route;
    if (!route) return;
    if (route === 'admin' && window.__cp_user && window.__cp_user.role !== 'admin') return;
    await navigate(route);
  });
});

boot();

// ---- login/register toggle ----
function showRegister() {
  el('login-form').classList.add('hidden');
  el('register-form').classList.remove('hidden');
  el('login-error').textContent = '';
  el('register-error').textContent = '';
}
function showLogin() {
  el('register-form').classList.add('hidden');
  el('login-form').classList.remove('hidden');
  el('login-error').textContent = '';
  el('register-error').textContent = '';
}

el('show-register').addEventListener('click', showRegister);
el('show-login').addEventListener('click', showLogin);

el('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('register-error').textContent = '';

  const payload = {
    companyName: el('reg-company').value,
    ownerName: el('reg-owner').value,
    yearsInBusiness: Number(el('reg-years').value || 0),
    phone: el('reg-phone').value,
    email: el('reg-email').value,
    password: el('reg-password').value
  };

  const btn = qs('button[type="submit"]', el('register-form'));
  btn.disabled = true;
  try {
    const data = await API.register(payload);
    localStorage.setItem('cp_token', data.token);
    await bootAuthed();
  } catch (err) {
    el('register-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});


