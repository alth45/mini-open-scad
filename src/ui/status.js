const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const toastEl = document.getElementById('toast');

const btnCancelRender = document.getElementById('btnCancelRender');

export function setStatus(kind, text, showCancel = false) {
  statusDot.className = 'dot ' + kind;
  statusText.textContent = text;
  btnCancelRender.classList.toggle('hidden', !showCancel);
}

let toastTimer = null;
export function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1900);
}