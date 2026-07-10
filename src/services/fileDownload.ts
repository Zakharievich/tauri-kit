import { isTauri } from "@tauri-apps/api/core";

/**
 * Saves a chat attachment (its in-memory `Blob`) to disk.
 *
 * Inside the Tauri desktop shell the browser's `<a download>` is unreliable
 * (notably WKWebView on macOS silently ignores it for blob URLs), so we use a
 * native "Save As" dialog (`plugin-dialog`) + a binary write (`plugin-fs`).
 * The plugins are imported dynamically so this module stays loadable in a
 * plain browser / test environment, where we fall back to an anchor download.
 *
 * We read the bytes via `blob.arrayBuffer()` rather than `fetch(objectUrl)`:
 * the app's CSP `connect-src` does not include `blob:`, so fetching a blob URL
 * throws inside the webview — which is why the previous implementation failed
 * right after the save dialog returned. Reading the Blob directly avoids the
 * network layer (and CSP) entirely and is faster.
 *
 * Resolves `false` if the user cancelled the save dialog, `true` if a file was
 * written (or the browser download was triggered). Throws on write failure so
 * the caller can surface an error.
 */
export async function downloadAttachment(fileName: string, blob: Blob): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { writeFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);

    const path = await save({ defaultPath: fileName });
    if (!path) return false; // user cancelled

    const bytes = new Uint8Array(await blob.arrayBuffer());
    await writeFile(path, bytes);
    return true;
  }

  // Browser fallback (Vite dev / tests): a normal anchor download works here.
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return true;
}
