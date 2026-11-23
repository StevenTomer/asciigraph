/**
 * Put `text` on the clipboard; false if the browser won't. The clipboard API only exists on
 * https and localhost, so on plain http (an office network, say) this falls back to the older
 * way, copying from a hidden text field, which browsers still allow in response to a click.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // (Refused: try the older way.)
    }
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  Object.assign(field.style, { position: "fixed", top: "0", left: "0", opacity: "0" });
  const focused = document.activeElement as HTMLElement | null;
  document.body.appendChild(field);
  field.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  field.remove();
  focused?.focus?.();
  return ok;
}
