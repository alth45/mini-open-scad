const consoleBody  = document.getElementById('consoleBody');
const consolePanel = document.getElementById('consolePanel');
const consoleBadge = document.getElementById('consoleBadge');

let errorCount = 0;

export function log(level, msg) {
  const div = document.createElement('div');
  div.className = 'log ' + level;
  const prefix = level === 'error' ? '✖ ' : level === 'warn' ? '⚠ ' : level === 'ok' ? '✔ ' : '› ';
  div.textContent = prefix + msg;
  consoleBody.appendChild(div);
  consoleBody.scrollTop = consoleBody.scrollHeight;

  if (level === 'error') errorCount++;

  consoleBadge.textContent = String(consoleBody.children.length);
  consoleBadge.classList.toggle('has-err', errorCount > 0);

  while (consoleBody.children.length > 400) consoleBody.removeChild(consoleBody.firstChild);
}

export function clear() {
  consoleBody.innerHTML = '';
  errorCount = 0;
  consoleBadge.textContent = '0';
  consoleBadge.classList.remove('has-err');
}

export function initConsoleControls() {
  document.getElementById('consoleToggle').addEventListener('click', () => {
    consolePanel.classList.toggle('collapsed');
    const t = document.getElementById('consoleToggle');
    t.textContent = consolePanel.classList.contains('collapsed') ? '▸ Console' : '▾ Console';
  });
  document.getElementById('consoleClear').addEventListener('click', clear);
}