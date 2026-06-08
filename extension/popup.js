const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["payload"], ({ payload }) => { if (payload) $("payload").value = payload; });

$("save").addEventListener("click", () => {
  chrome.storage.local.set({ payload: $("payload").value }, () => { $("status").textContent = "Saved."; });
});

$("fill").addEventListener("click", async () => {
  let answers;
  try { answers = JSON.parse($("payload").value); }
  catch { $("status").textContent = "Invalid JSON."; return; }
  if (!Array.isArray(answers)) { $("status").textContent = "Expected an array."; return; }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $("status").textContent = "Filling...";
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillForm,
      args: [answers],
    });
    $("status").textContent = `Filled ${result.filled}/${result.total} fields.`;
  } catch (e) {
    $("status").textContent = "Error: " + e.message;
  }
});

async function fillForm(answers) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fields = Array.from(document.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, [role="radio"], [role="checkbox"], select'
  ));
  let filled = 0;
  const total = answers.length;

  function setNative(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  for (let i = 0; i < answers.length; i++) {
    const ans = answers[i];
    const value = String(ans.answer ?? ans.value ?? ans ?? "");
    const target = fields[i];
    if (!target) continue;
    const tag = target.tagName;
    const type = (target.getAttribute("type") || "").toLowerCase();
    const role = target.getAttribute("role");
    try {
      if (role === "radio" || role === "checkbox" || type === "radio" || type === "checkbox") {
        const group = target.closest('[role="radiogroup"], form, body');
        const selector = role ? `[role="${role}"]` : `input[type="${type}"]`;
        const opts = group ? Array.from(group.querySelectorAll(selector)) : [target];
        const match = opts.find((o) => (o.getAttribute("aria-label") || o.value || o.parentElement?.innerText || "").toLowerCase().includes(value.toLowerCase())) || target;
        match.click();
      } else if (tag === "SELECT") {
        const opt = Array.from(target.options).find((o) => o.text.toLowerCase().includes(value.toLowerCase())) || target.options[0];
        if (opt) { target.value = opt.value; target.dispatchEvent(new Event("change", { bubbles: true })); }
      } else {
        target.focus();
        setNative(target, value);
      }
      filled++;
      await sleep(120 + Math.random() * 220);
    } catch (e) {}
  }

  return { filled, total };
}
