/**
 * utils/helpers.js — Shared pure utility functions
 */

/** HTML-escape a string for safe insertion into innerHTML. */
export function esc(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/** Escape a string for use inside an HTML attribute. */
export function escAttr(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Create a debounced version of a function. */
export function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/** Promise wrapper around chrome.runtime.sendMessage. */
export function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}
