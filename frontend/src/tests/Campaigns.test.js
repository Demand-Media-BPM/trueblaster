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
