const CUSTOM_DOMAINS_KEY = 'django-devbar-custom-domains';

const textarea = document.getElementById('domains-input');
const saveBtn = document.getElementById('save-btn');
const statusEl = document.getElementById('status');
const domainListEl = document.getElementById('domain-list');
const activeSectionEl = document.getElementById('active-section');

function parseDomains(text) {
  return text
    .split('\n')
    .map(line => {
      let d = line.trim();
      // Strip protocol
      d = d.replace(/^https?:\/\//, '');
      // Keep only host[:port] — strip any path
      d = d.split('/')[0];
      return d;
    })
    .filter(Boolean);
}

function showStatus(msg, type = 'success') {
  statusEl.textContent = msg;
  statusEl.className = `status ${type}`;
  if (type === 'success') {
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  }
}

async function getStoredDomains() {
  return new Promise(resolve => {
    chrome.storage.sync.get([CUSTOM_DOMAINS_KEY], result => {
      resolve(result[CUSTOM_DOMAINS_KEY] || []);
    });
  });
}

async function setStoredDomains(domains) {
  return new Promise(resolve => {
    chrome.storage.sync.set({ [CUSTOM_DOMAINS_KEY]: domains }, resolve);
  });
}

async function requestPermissionForDomain(domain) {
  return new Promise(resolve => {
    chrome.permissions.request(
      { origins: [`*://${domain}/*`] },
      resolve
    );
  });
}

async function registerContentScript(domain) {
  const scriptId = `devbar-custom-${domain}`;
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [scriptId] });
    if (existing.length === 0) {
      await chrome.scripting.registerContentScripts([{
        id: scriptId,
        matches: [`*://${domain}/*`],
        js: ['content.js'],
        runAt: 'document_start'
      }]);
    }
  } catch (e) {
    console.warn(`Could not register content script for ${domain}:`, e);
  }
}

async function unregisterContentScript(domain) {
  const scriptId = `devbar-custom-${domain}`;
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
  } catch (e) {
    // Script may not be registered; ignore
  }
}

async function removeDomain(domain) {
  const domains = await getStoredDomains();
  const updated = domains.filter(d => d !== domain);
  await setStoredDomains(updated);
  await unregisterContentScript(domain);
  renderDomainList(updated);
}

function renderDomainList(domains) {
  if (domains.length === 0) {
    activeSectionEl.style.display = 'none';
    return;
  }
  activeSectionEl.style.display = '';
  domainListEl.innerHTML = domains.map(domain => `
    <div class="domain-item">
      <span class="domain-name">${domain}</span>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="domain-status">✓ active</span>
        <button class="remove-btn" data-domain="${domain}" title="Remove domain">✕</button>
      </div>
    </div>
  `).join('');

  domainListEl.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => removeDomain(btn.dataset.domain));
  });
}

async function init() {
  const domains = await getStoredDomains();
  textarea.value = domains.join('\n');
  renderDomainList(domains);
}

saveBtn.addEventListener('click', async () => {
  const newDomains = parseDomains(textarea.value);
  const existingDomains = await getStoredDomains();

  saveBtn.disabled = true;
  showStatus('Saving…', 'info');

  const added = newDomains.filter(d => !existingDomains.includes(d));
  const removed = existingDomains.filter(d => !newDomains.includes(d));

  // Unregister content scripts for removed domains
  for (const domain of removed) {
    await unregisterContentScript(domain);
  }

  // Request permissions and register content scripts for new domains
  const denied = [];
  for (const domain of added) {
    const granted = await requestPermissionForDomain(domain);
    if (granted) {
      await registerContentScript(domain);
    } else {
      denied.push(domain);
    }
  }

  const domainsToSave = newDomains.filter(d => !denied.includes(d));
  await setStoredDomains(domainsToSave);
  renderDomainList(domainsToSave);

  // Update textarea to reflect what was actually saved
  textarea.value = domainsToSave.join('\n');

  saveBtn.disabled = false;

  if (denied.length > 0) {
    showStatus(`Saved. Permission denied for: ${denied.join(', ')}. DevTools metrics still work.`, 'error');
  } else {
    showStatus('Settings saved.', 'success');
  }
});

init();
