import api from "./api";

/**
 * Fetches a PDF from an authenticated endpoint and downloads it. We can't point
 * an <a href> straight at the URL because it needs the Authorization header, so
 * we fetch it as a blob and trigger a download through a temporary anchor.
 */
export async function downloadPdf(
  path: string,
  filename: string,
): Promise<void> {
  const blob = await api.get<Blob>(path, { responseType: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10000);
}
