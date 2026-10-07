// STATE MANAGEMENT
// tasks/groceries/emailConfig are populated from the SQLite-backed API on
// load (see loadState()) and re-synced to the server after every mutation
// (see saveData()). There is no localStorage or local-file involvement.
let tasks = [];
let groceries = [];
let emailConfig = {
  publicKey: '',
  serviceId: '',
  templateId: '',
  userEmail: ''
};

const CATEGORIES = ['food', 'bathroom', 'hygiene', 'snacks', 'drinks', 'household'];

function setDbStatus(text, kind) {
  const el = document.getElementById('db-status-indicator');
  if (!el) return;
  el.innerText = text;
  el.classList.toggle('connected', kind === 'ok');
}

// LOAD INITIAL STATE FROM THE SERVER (SQLite)
async function loadState() {
  setDbStatus('Loading…', 'loading');
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    tasks = data.tasks || [];
    groceries = data.groceries || [];
    emailConfig = data.emailConfig || emailConfig;

    // Guard on window.emailjs so a blocked/failed CDN script (e.g. an ad
    // blocker) doesn't stop the rest of the app from loading.
    if (emailConfig.publicKey && window.emailjs) {
      emailjs.init(emailConfig.publicKey);
    }
    showEmailStatus();

    setDbStatus('💾 Synced to SQLite', 'ok');
    render();
  } catch (err) {
    console.error('Failed to load state from server:', err);
    setDbStatus('⚠️ Could not load data', 'error');
  }
}

// EMAILJS STATUS
// EmailJS settings are read-only here: they come from the server's .env file
// (EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID,
// EMAILJS_USER_EMAIL). Edit .env and restart the app to change them.
function isEmailConfigured() {
  return Boolean(emailConfig.publicKey && emailConfig.serviceId &&
                 emailConfig.templateId && emailConfig.userEmail);
}

function showEmailStatus() {
  const el = document.getElementById('email-status');
  if (!el) return;
  if (isEmailConfigured()) {
    el.textContent = window.emailjs
      ? `✅ Email alerts are on — sending to ${emailConfig.userEmail}. (Configured in .env)`
      : `⚠️ EmailJS is configured in .env, but its script didn't load (blocked or offline), so emails can't be sent.`;
  } else {
    const missing = [
      ['EMAILJS_PUBLIC_KEY', emailConfig.publicKey],
      ['EMAILJS_SERVICE_ID', emailConfig.serviceId],
      ['EMAILJS_TEMPLATE_ID', emailConfig.templateId],
      ['EMAILJS_USER_EMAIL', emailConfig.userEmail]
    ].filter(([, v]) => !v).map(([k]) => k);
    el.textContent = `⚠️ Email alerts are off. Set ${missing.join(', ')} in .env and restart the app.`;
  }
}

// EMAILJS TRANSMISSION FUNCTION
function sendEmailJS(subject, message) {
  if (!isEmailConfigured()) {
    console.warn("EmailJS is not fully configured. Email skipped.");
    return;
  }
  if (!window.emailjs) {
    console.warn("EmailJS SDK failed to load. Email skipped.");
    return;
  }

  const templateParams = {
    to_email: emailConfig.userEmail,
    subject_line: subject,
    message_body: message
  };

  emailjs.send(emailConfig.serviceId, emailConfig.templateId, templateParams)
    .then((res) => {
      console.log('[EmailJS SUCCESS]', res.status, res.text);
    }, (err) => {
      console.error('[EmailJS ERROR]', err);
    });
}

// --- EXPORT FUNCTIONS (.TXT & .DOCX) ---
// Unchanged: these just read the in-memory tasks/groceries arrays, which
// are now sourced from SQLite instead of localStorage.

// 1. TEXT (.TXT) EXPORT
function exportAsTXT() {
  let content = "========================================\n";
  content += "       TASK & GROCERY DASHBOARD REPORT  \n";
  content += `       Generated: ${new Date().toLocaleString()}\n`;
  content += "========================================\n\n";

  content += "--- ACTIVE TASKS ---\n";
  const activeTasks = tasks.filter(t => t.status !== 'uncompleted');
  if (activeTasks.length === 0) {
    content += "(No active tasks)\n";
  } else {
    activeTasks.forEach((t, i) => {
      content += `${i + 1}. ${t.title}\n`;
      content += `   - Due: ${new Date(t.dueDate).toLocaleString()}\n`;
      content += `   - Repeat: ${t.repeat}\n`;
      content += `   - Interval: ${t.interval === 'none' ? 'None' : t.interval + ' mins'}\n\n`;
    });
  }

  content += "\n--- UNCOMPLETED / EXPIRED TASKS ---\n";
  const uncompletedTasks = tasks.filter(t => t.status === 'uncompleted');
  if (uncompletedTasks.length === 0) {
    content += "(No uncompleted tasks)\n";
  } else {
    uncompletedTasks.forEach((t, i) => {
      content += `${i + 1}. ${t.title}\n`;
      content += `   - Expired Due Date: ${new Date(t.dueDate).toLocaleString()}\n\n`;
    });
  }

  content += "\n--- GROCERY TRACKER ---\n";
  CATEGORIES.forEach(cat => {
    const items = groceries.filter(g => g.category === cat);
    content += `\n[ ${cat.toUpperCase()} ]\n`;
    if (items.length === 0) {
      content += "  (No items)\n";
    } else {
      items.forEach(item => {
        const elapsedDays = (Date.now() - item.lastRestocked) / 86400000;
        const remainingDays = Math.max(0, (item.depletionDays - elapsedDays)).toFixed(1);
        content += `  - ${item.title} (${Math.round(getStockPercent(item))}% stock, ~${remainingDays} days remaining / ${item.depletionDays} day speed)\n`;
      });
    }
  });

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Tasks_and_Groceries_${new Date().toISOString().slice(0,10)}.txt`;
  link.click();
}

// 2. WORD DOCUMENT (.DOCX) EXPORT
function exportAsDOCX() {
  if (!window.docx) {
    alert("DOCX generator library is loading, please try again in a moment.");
    return;
  }

  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = window.docx;

  const docChildren = [
    new Paragraph({
      text: "Task & Grocery Dashboard Report",
      heading: HeadingLevel.TITLE,
      spacing: { after: 300 }
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Generated on: ${new Date().toLocaleString()}`, italic: true })
      ],
      spacing: { after: 400 }
    }),
    new Paragraph({ text: "Active Tasks", heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 150 } })
  ];

  const activeTasks = tasks.filter(t => t.status !== 'uncompleted');
  if (activeTasks.length === 0) {
    docChildren.push(new Paragraph({ text: "(No active tasks)", spacing: { after: 100 } }));
  } else {
    activeTasks.forEach((t) => {
      docChildren.push(new Paragraph({
        children: [
          new TextRun({ text: `• ${t.title}`, bold: true }),
          new TextRun({ text: ` — Due: ${new Date(t.dueDate).toLocaleString()} (Repeat: ${t.repeat})` })
        ],
        spacing: { after: 100 }
      }));
    });
  }

  docChildren.push(new Paragraph({ text: "Uncompleted / Expired Tasks", heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 150 } }));
  const uncompletedTasks = tasks.filter(t => t.status === 'uncompleted');
  if (uncompletedTasks.length === 0) {
    docChildren.push(new Paragraph({ text: "(No uncompleted tasks)", spacing: { after: 100 } }));
  } else {
    uncompletedTasks.forEach((t) => {
      docChildren.push(new Paragraph({
        children: [
          new TextRun({ text: `• ${t.title}`, bold: true, color: "EF4444" }),
          new TextRun({ text: ` — Expired Due Date: ${new Date(t.dueDate).toLocaleString()}` })
        ],
        spacing: { after: 100 }
      }));
    });
  }

  docChildren.push(new Paragraph({ text: "Grocery Inventory & Depletion Tracker", heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 150 } }));
  CATEGORIES.forEach(cat => {
    const items = groceries.filter(g => g.category === cat);
    docChildren.push(new Paragraph({ text: cat.toUpperCase(), heading: HeadingLevel.HEADING_2, spacing: { before: 150, after: 100 } }));

    if (items.length === 0) {
      docChildren.push(new Paragraph({ text: "  (No items)", spacing: { after: 100 } }));
    } else {
      items.forEach(item => {
        const elapsedDays = (Date.now() - item.lastRestocked) / 86400000;
        const remainingDays = Math.max(0, (item.depletionDays - elapsedDays)).toFixed(1);
        docChildren.push(new Paragraph({
          children: [
            new TextRun({ text: `  - ${item.title}: `, bold: true }),
            new TextRun({ text: `${Math.round(getStockPercent(item))}% stock, ~${remainingDays} days remaining (depletes every ${item.depletionDays} days)` })
          ],
          spacing: { after: 80 }
        }));
      });
    }
  });

  const doc = new Document({
    sections: [{ properties: {}, children: docChildren }]
  });

  Packer.toBlob(doc).then(blob => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Tasks_and_Groceries_${new Date().toISOString().slice(0,10)}.docx`;
    link.click();
  });
}

// NOTIFICATION & ALERT DISPATCHER
function requestNotificationPermission() {
  if ('Notification' in window) {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        document.getElementById('notify-btn').innerText = 'Notifications Active';
        document.getElementById('notify-btn').style.background = 'var(--success)';
        document.getElementById('notify-btn').style.color = 'white';
      }
    });
  }
}

function dispatchAlert(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
  sendEmailJS(title, body);
}

// PERSIST CURRENT STATE TO SQLITE (via the Flask API) AND RE-RENDER
async function saveData() {
  render();
  setDbStatus('Saving…', 'loading');
  try {
    const res = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks, groceries })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setDbStatus('💾 Synced to SQLite', 'ok');
  } catch (err) {
    console.error('Failed to save state to server:', err);
    setDbStatus('⚠️ Save failed — retrying next change', 'error');
  }
}

// TASK ACTIONS
document.getElementById('task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const newTask = {
    id: Date.now().toString(),
    title: document.getElementById('task-title').value,
    dueDate: new Date(document.getElementById('task-due').value).getTime(),
    interval: document.getElementById('task-interval').value,
    repeat: document.getElementById('task-repeat').value,
    status: 'active',
    expiredAlertSent: false,
    lastReminderSent: Date.now()
  };
  tasks.push(newTask);
  saveData();
  e.target.reset();
});

function completeTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  if (task.repeat !== 'none') {
    const offset = task.repeat === 'daily' ? 86400000 : 604800000;
    task.dueDate = Date.now() + offset;
    task.status = 'active';
    task.expiredAlertSent = false;
    dispatchAlert("Task Renewed", `Recurring task "${task.title}" reset for next cycle.`);
  } else {
    tasks = tasks.filter(t => t.id !== id);
  }
  saveData();
}

function extendTask(id, days = 2) {
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.dueDate = Date.now() + (days * 86400000);
    task.status = 'active';
    task.expiredAlertSent = false;
    saveData();
  }
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  saveData();
}

// GROCERY ACTIONS
document.getElementById('grocery-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const newItem = {
    id: Date.now().toString(),
    title: document.getElementById('grocery-title').value,
    category: document.getElementById('grocery-category').value,
    depletionDays: parseInt(document.getElementById('grocery-days').value),
    lastRestocked: Date.now(),
    lowAlertSent: false
  };
  applyStockPercent(newItem, document.getElementById('grocery-stock').value);
  groceries.push(newItem);
  saveData();
  e.target.reset();
});

// STOCK PERCENTAGE HELPERS
// Stock % is derived from how long ago the item was "full" relative to its
// depletion speed. Setting a stock % simply back-dates lastRestocked so the
// item is that far through its depletion cycle — it then keeps counting
// down from there at the same speed. No extra database column is needed.
const LOW_STOCK_PERCENT = 20; // matches the 80%-depleted alert threshold

function clampPercent(value) {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return null;
  return Math.min(100, Math.max(0, n));
}

function getStockPercent(item) {
  const elapsedDays = (Date.now() - item.lastRestocked) / 86400000;
  return Math.max(0, 100 - (elapsedDays / item.depletionDays) * 100);
}

function applyStockPercent(item, percent) {
  const pct = clampPercent(percent);
  if (pct === null) return false;
  const usedFraction = 1 - pct / 100;
  item.lastRestocked = Date.now() - Math.round(usedFraction * item.depletionDays * 86400000);
  // If the user deliberately sets a low level they already know it's low,
  // so don't fire a "depleting soon" alert for it. Raising it re-arms the alert.
  item.lowAlertSent = pct <= LOW_STOCK_PERCENT;
  return true;
}

function setStockPercent(id, value) {
  const item = groceries.find(g => g.id === id);
  if (!item) return;
  if (!applyStockPercent(item, value)) {
    render(); // invalid input — snap the field back to the real value
    return;
  }
  saveData();
}

function restockCategory(category) {
  groceries.forEach(item => {
    if (item.category === category) {
      item.lastRestocked = Date.now();
      item.lowAlertSent = false;
    }
  });
  saveData();
}

function restockSingle(id) {
  const item = groceries.find(g => g.id === id);
  if (item) {
    item.lastRestocked = Date.now();
    item.lowAlertSent = false;
    saveData();
  }
}

function deleteGrocery(id) {
  groceries = groceries.filter(g => g.id !== id);
  saveData();
}

// AUTOMATION ENGINE
function processAutomationRules() {
  const now = Date.now();
  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
  let changed = false;

  tasks.forEach(task => {
    if (now > task.dueDate) {
      if (!task.expiredAlertSent) {
        dispatchAlert("Task Expired!", `The task "${task.title}" has expired. Please renew or extend it.`);
        task.expiredAlertSent = true;
        changed = true;
      }

      if (now - task.dueDate >= TWO_DAYS_MS && task.status !== 'uncompleted') {
        task.status = 'uncompleted';
        dispatchAlert("Task Moved to Uncompleted", `"${task.title}" was not extended within 2 days.`);
        changed = true;
      } else if (task.status === 'active') {
        task.status = 'expired';
        changed = true;
      }
    }

    if (task.status === 'active' && task.interval !== 'none') {
      const intervalMs = parseInt(task.interval) * 60 * 1000;
      if (now - task.lastReminderSent >= intervalMs) {
        dispatchAlert("Task Reminder", `Reminder for active task: "${task.title}"`);
        task.lastReminderSent = now;
        changed = true;
      }
    }
  });

  groceries.forEach(item => {
    const durationMs = item.depletionDays * 86400000;
    const elapsed = now - item.lastRestocked;
    const percentDepleted = (elapsed / durationMs) * 100;

    if (percentDepleted >= 100 - LOW_STOCK_PERCENT && !item.lowAlertSent) {
      dispatchAlert("Grocery Depleting Soon!", `"${item.title}" is almost out. Time to restock!`);
      item.lowAlertSent = true;
      changed = true;
    }
  });

  // Only hit the database when something actually changed, and always
  // re-render so the "days remaining" figures stay current either way.
  if (changed) {
    saveData();
  } else {
    render();
  }
}

// RENDER ENGINE
function render() {
  const activeList = document.getElementById('active-tasks-list');
  const uncompletedList = document.getElementById('uncompleted-tasks-list');
  activeList.innerHTML = '';
  uncompletedList.innerHTML = '';

  tasks.forEach(task => {
    const li = document.createElement('li');
    const isExpired = Date.now() > task.dueDate;
    const dueString = new Date(task.dueDate).toLocaleString();

    li.innerHTML = `
      <div class="item-info">
        <span class="item-title">${task.title}</span>
        <span class="item-meta">Due: ${dueString}</span>
        <div>
          ${task.repeat !== 'none' ? `<span class="badge badge-recurring">Repeats ${task.repeat}</span>` : ''}
          ${isExpired ? `<span class="badge badge-expired">Expired</span>` : ''}
        </div>
      </div>
      <div class="item-actions">
        ${isExpired ? `<button class="btn-secondary" onclick="extendTask('${task.id}')">+2 Days</button>` : ''}
        <button class="btn-success" onclick="completeTask('${task.id}')">✓</button>
        <button class="btn-danger" onclick="deleteTask('${task.id}')">✕</button>
      </div>
    `;

    if (task.status === 'uncompleted') {
      uncompletedList.appendChild(li);
    } else {
      activeList.appendChild(li);
    }
  });

  const groceryContainer = document.getElementById('grocery-categories-container');
  // Don't wipe out a stock % the user is in the middle of typing when the
  // 30-second automation tick re-renders the page.
  if (groceryContainer.contains(document.activeElement) &&
      document.activeElement.classList.contains('stock-input')) {
    return;
  }
  groceryContainer.innerHTML = '';

  CATEGORIES.forEach(cat => {
    const itemsInCat = groceries.filter(g => g.category === cat);
    if (itemsInCat.length === 0) return;

    const catBlock = document.createElement('div');
    catBlock.className = 'category-block';

    let itemsHtml = itemsInCat.map(item => {
      const elapsedDays = (Date.now() - item.lastRestocked) / 86400000;
      const remainingDays = Math.max(0, (item.depletionDays - elapsedDays)).toFixed(1);
      const percentLeft = Math.round(getStockPercent(item));
      const barClass = percentLeft <= LOW_STOCK_PERCENT ? 'low' : (percentLeft <= 50 ? 'mid' : '');

      return `
        <li>
          <div class="item-info">
            <span class="item-title">${item.title}</span>
            <span class="item-meta">Est. ~${remainingDays} days left (${percentLeft}% remaining)</span>
            <div class="stock-bar"><div class="stock-bar-fill ${barClass}" style="width:${percentLeft}%"></div></div>
          </div>
          <div class="item-actions">
            <label class="stock-edit" title="Set current stock %">
              <input type="number" class="stock-input" min="0" max="100" step="1"
                     value="${percentLeft}" aria-label="Stock percent for ${item.title}"
                     onchange="setStockPercent('${item.id}', this.value)"
                     onkeydown="if (event.key === 'Enter') this.blur()">
              <span>%</span>
            </label>
            <button class="btn-secondary" onclick="restockSingle('${item.id}')">Restock</button>
            <button class="btn-danger" onclick="deleteGrocery('${item.id}')">✕</button>
          </div>
        </li>
      `;
    }).join('');

    catBlock.innerHTML = `
      <div class="category-header">
        <h3>${cat}</h3>
        <button class="btn-secondary" onclick="restockCategory('${cat}')">Restock All ${cat}</button>
      </div>
      <ul>${itemsHtml}</ul>
    `;
    groceryContainer.appendChild(catBlock);
  });
}

// INITIALIZE
loadState();
setInterval(processAutomationRules, 30000);
