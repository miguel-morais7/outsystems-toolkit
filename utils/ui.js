/**
 * utils/ui.js — Shared UI helper functions
 */

/* DOM references (shared across sections) */
const statusBar  = document.getElementById("status-bar");
const statusText = document.getElementById("status-text");
const toastBox   = document.getElementById("toast-container");

/** Remove the `hidden` class from an element. */
export function show(el) {
  el.classList.remove("hidden");
}

/** Add the `hidden` class to an element. */
export function hide(el) {
  el.classList.add("hidden");
}

/** Briefly flash a row with a success or error animation. */
export function flashRow(rowEl, cls) {
  if (!rowEl) return;
  rowEl.classList.remove("saved", "error");
  // force reflow
  void rowEl.offsetWidth;
  rowEl.classList.add(cls);
  setTimeout(() => rowEl.classList.remove(cls), 700);
}

/** Show a toast notification. */
export function toast(msg, type) {
  const el = document.createElement("div");
  el.className = "toast " + (type || "info");
  el.textContent = msg;
  toastBox.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/** Show a message in the status bar. */
export function showStatus(msg, type) {
  statusText.textContent = msg;
  statusBar.className = "status-bar " + (type || "");
  show(statusBar);
}

/** Hide the status bar. */
export function hideStatus() {
  hide(statusBar);
}
