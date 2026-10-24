const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const toastEl = document.getElementById('toast');

export function setStatus(kind, text) {
  statusDot.className = 'dot ' + kind;
  statusText.textContent = text;
}

let toastTimer = null;
export function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1900);
}