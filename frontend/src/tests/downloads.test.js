import { downloadCampaignCsv } from "../utilities/downloads";
import { authFetch } from "../utilities/apiAuth";
jest.mock("../utilities/apiAuth", () => ({ authFetch: jest.fn() }));
beforeEach(() => {
  authFetch.mockReset();
  window.URL.createObjectURL = jest.fn(() => "blob:test");
  window.URL.revokeObjectURL = jest.fn();
});
test("failed API responses are not downloaded as misleading CSV files", async () => {
  authFetch.mockResolvedValue({ ok: false, json: async () => ({ error: "Please log in" }) });
  await expect(downloadCampaignCsv("Campaign + 1")).rejects.toThrow("Please log in");
  expect(window.URL.createObjectURL).not.toHaveBeenCalled();
});
test("successful exports encode the campaign name and clean up the temporary URL", async () => {
  authFetch.mockResolvedValue({
    ok: true,
    blob: async () => new Blob(["Recipient\nexample@example.com"]),
  });
  const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await downloadCampaignCsv("Campaign + 1");
  expect(authFetch.mock.calls[0][0]).toContain("emailId=Campaign%20%2B%201");
  expect(click).toHaveBeenCalled();
  expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  click.mockRestore();
});
