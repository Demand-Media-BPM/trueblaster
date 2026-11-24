import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Campaigns from "../pages/Campaigns";
import axios from "axios";
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../utilities/downloads", () => ({ downloadCampaignCsv: jest.fn() }));
jest.mock("../component/TestMailDialog", () => () => null);
jest.mock("../component/TemplateDropdown", () => (props) => (
  <button onClick={() => props.onSelect({ html: "Hello {{firstName}}", css: "" })}>
    Choose template
  </button>
));
jest.mock("@mui/x-date-pickers/DateTimePicker", () => ({ DateTimePicker: () => null }));
jest.mock("@mui/x-date-pickers/LocalizationProvider", () => ({
  LocalizationProvider: (props) => props.children,
}));
jest.mock("@mui/x-date-pickers/AdapterDayjs", () => ({ AdapterDayjs: () => null }));
beforeEach(() => {
  axios.get.mockReset();
  axios.post.mockReset();
  axios.get.mockImplementation((url) =>
    Promise.resolve({
      data: url.endsWith("/me")
        ? { workspace: { mailConfigured: true } }
        : url.endsWith("/contact-lists")
          ? ["Customers"]
          : [],
    })
  );
  axios.post.mockResolvedValue({ data: { message: "Campaign queued", status: "queued" } });
});
async function fillCampaign() {
  render(<Campaigns />);
  fireEvent.click(screen.getByRole("button", { name: "Create Campaign" }));
  fireEvent.change(screen.getByLabelText("Campaign Name"), { target: { value: "Welcome" } });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Hello" } });
  fireEvent.mouseDown(screen.getByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name: "Customers" }));
  fireEvent.click(screen.getByText("Choose template"));
}
test("Send Now submits null schedule time and reports backend queue acceptance", async () => {
  await fillCampaign();
  await waitFor(() => expect(screen.getByRole("button", { name: "Send Now" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Send Now" }));
  await waitFor(() => expect(axios.post).toHaveBeenCalled());
  expect(axios.post.mock.calls[0][1]).toMatchObject({
    emailId: "Welcome",
    listName: "Customers",
    scheduleTime: null,
  });
  expect(await screen.findByText("Campaign queued")).toBeInTheDocument();
});
test("Schedule submits a future ISO timestamp", async () => {
  await fillCampaign();
  await waitFor(() => expect(screen.getByRole("button", { name: "Schedule" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
  await waitFor(() => expect(axios.post).toHaveBeenCalled());
  expect(new Date(axios.post.mock.calls[0][1].scheduleTime).getTime()).toBeGreaterThan(Date.now());
});

test("campaign reports show real delivery metrics, SMTP reasons, and the privacy limitation", async () => {
  const summary = { emailId: "Delivery test", status: "completed", totalSent: 3, attemptedCount: 4,
    deliveredCount: 2, deferredCount: 1, droppedCount: 0, spamReportCount: 1,
    hardBounceCount: 1, softBounceCount: 0, uniqueOpens: 1, totalOpens: 2,
    uniqueClicks: 1, totalClicks: 1, openRate: 33.33, clickRate: 33.33, bounceRate: 33.33,
    unsubscribeCount: 1, unsubscribeRate: 33.33, deliveryRate: 66.67, totalRecipients: 4 };
  axios.get.mockImplementation(url => Promise.resolve({ data:
    url.endsWith("/me") ? { workspace: { mailConfigured: true } } :
    url.endsWith("/campaign-ids") ? ["Delivery test"] :
    url.endsWith("/campaign-analytics") ? summary :
    url.endsWith("/campaign-details") ? [{ recipient: "demo@example.com", deliveryStatus: "deferred", deliveryReason: "Try again later", smtpStatus: "421", bounceStatus: "NA", organization: "Fixture ISP", asn: "AS123", userAgent: "Fixture agent" }] :
    url.endsWith("/send-campaign-progress") ? { sent: 3, processed: 4, total: 4, status: "completed" } : [] }));
  render(<Campaigns />);
  fireEvent.click(await screen.findByRole("button", { name: "View Details" }));
  expect(await screen.findByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("tab", { name: "Opens" }));
  expect(screen.getByText("Total opens")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Clicks" }));
  expect(screen.getByText("Total clicks")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Unsubscribes" }));
  expect(screen.getByText("Unsubscribe rate")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Deliverability" }));
  expect(screen.getByText("Accepted by provider")).toBeInTheDocument();
  expect(screen.getByText("66.67%")).toBeInTheDocument();
  expect(screen.getByText("Deferred (current)")).toBeInTheDocument();
  expect(screen.getByText("Spam reports")).toBeInTheDocument();
  expect(screen.getByText(/Opens can include privacy proxies/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Contact details" }));
  expect(screen.getByRole("columnheader", { name: "Last activity" })).toBeInTheDocument();
  expect(screen.getByText("Try again later · 421")).toBeInTheDocument();
  expect(screen.getByText("Deferred")).toBeInTheDocument();
  expect(screen.getByText("Fixture ISP")).toBeInTheDocument();
  expect(screen.getByText("AS123")).toBeInTheDocument();
  expect(screen.getByText("Fixture agent")).toBeInTheDocument();
  expect(screen.getByText(/Location is approximate network information/)).toBeInTheDocument();
});
