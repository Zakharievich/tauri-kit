import { isTauri } from "@tauri-apps/api/core";

/**
 * Saves a chat attachment (referenced by its in-memory object URL) to disk.
 *
 * Inside the Tauri desktop shell the browser's `<a download>` is unreliable
 * (notably WKWebView on macOS silently ignores it for blob URLs), so we use a
 * native "Save As" dialog (`plugin-dialog`) + a binary write (`plugin-fs`).
 * The plugins are imported dynamically so this module stays loadable in a
 * plain browser / test environment, where we fall back to an anchor download.
 *
 * Resolves `false` if the user cancelled the save dialog, `true` if a file was
 * written (or the browser download was triggered). Throws on write failure so
 * the caller can surface an error.
 */
export async function downloadAttachment(fileName: string, objectUrl: string): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { writeFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);

    const path = await save({ defaultPath: fileName });
    if (!path) return false; // user cancelled

    const bytes = new Uint8Array(await (await fetch(objectUrl)).arrayBuffer());
    await writeFile(path, bytes);
    return true;
  }

  // Browser fallback (Vite dev / tests): a normal anchor download works here.
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}
