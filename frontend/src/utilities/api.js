export const API_URL = (process.env.REACT_APP_API_URL || "http://localhost:5000").replace(
  /\/+$/,
  ""
);

export function getErrorMessage(error, fallback = "The request failed. Please try again.") {
  return (
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    (error?.response
      ? fallback
      : error?.message && error.message !== "Network Error"
        ? error.message
        : "Unable to connect to the server. Please try again.")
  );
}

export function formatDate(value) {
  if (!value || value === "NA") return "?";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "?" : date.toLocaleString();
}

export function statusLabel(value) {
  return (
    {
      pending: "Pending",
      queued: "Queued",
      scheduled: "Scheduled",
      running: "Sending",
      sending: "Sending",
      completed: "Completed",
      needs_review: "Needs review",
      accepted: "Sent",
      delivered: "Delivered",
      bounced: "Bounced",
      failed: "Failed",
      skipped: "Skipped",
      unknown: "Needs review",
    }[value] ||
    value ||
    "Pending"
  );
}
