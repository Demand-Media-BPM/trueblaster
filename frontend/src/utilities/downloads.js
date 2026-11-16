import { API_URL } from "./api";
import { authFetch } from "./apiAuth";

// Check the authenticated response before turning it into a downloadable CSV file.
export async function downloadCampaignCsv(emailId) {
  const response = await authFetch(
    API_URL + "/api/campaign/campaign-csv?emailId=" + encodeURIComponent(emailId)
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || data.message || "Unable to download this campaign.");
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = String(emailId).replace(/[^a-z0-9_-]/gi, "_") + "_data.csv";
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    window.URL.revokeObjectURL(url);
  }
}
