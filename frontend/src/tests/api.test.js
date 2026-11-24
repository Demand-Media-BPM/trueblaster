import { formatDate, getErrorMessage, statusLabel } from "../utilities/api";
test("missing and invalid backend timestamps render as a placeholder", () => {
  for (const value of [undefined, null, "NA", "invalid"]) expect(formatDate(value)).toBe("?");
  expect(formatDate("2026-10-16T10:00:00Z")).not.toBe("?");
});
test("API errors preserve actionable backend messages", () => {
  expect(getErrorMessage({ response: { data: { error: "Invalid spreadsheet row 2" } } })).toBe(
    "Invalid spreadsheet row 2"
  );
  expect(getErrorMessage(new Error("Network Error"))).toMatch(/connect/);
});
test("worker statuses are rendered consistently", () => {
  expect(statusLabel("needs_review")).toBe("Needs review");
  expect(statusLabel("accepted")).toBe("Accepted");
  expect(statusLabel("blocked")).toBe("Temporarily blocked");
  expect(statusLabel("deferred")).toBe("Deferred");
  expect(statusLabel("dropped")).toBe("Dropped");
  expect(statusLabel("scheduled")).toBe("Scheduled");
});
