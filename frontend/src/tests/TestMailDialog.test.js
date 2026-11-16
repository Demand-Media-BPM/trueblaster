import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TestMailDialog from "../component/TestMailDialog";
import axios from "axios";
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../component/TemplateDropdown", () => (props) => (
  <button onClick={() => props.onSelect({ html: "Hello {{firstName}}", css: "" })}>
    Choose template
  </button>
));
beforeEach(() => {
  axios.get.mockReset();
  axios.post.mockReset();
});
test("uses the workspace sender and leaves sender selection to the backend", async () => {
  axios.get.mockResolvedValue({
    data: { workspace: { senderEmail: "configured@example.com", mailConfigured: true } },
  });
  axios.post.mockResolvedValue({ data: { success: true } });
  render(<TestMailDialog open onClose={() => {}} />);
  await waitFor(() =>
    expect(screen.getByLabelText("Sender email")).toHaveValue("configured@example.com")
  );
  fireEvent.change(screen.getByLabelText("Receiver email"), {
    target: { value: "receiver@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Test subject" } });
  fireEvent.click(screen.getByText("Choose template"));
  fireEvent.click(screen.getByRole("button", { name: "Send Test" }));
  await waitFor(() => expect(axios.post).toHaveBeenCalled());
  expect(axios.post.mock.calls[0][1]).toEqual({
    receiver: "receiver@example.com",
    subject: "Test subject",
    body: "Hello {{firstName}}",
    style: "",
  });
});
test("sending is disabled when backend mail configuration is missing", async () => {
  axios.get.mockResolvedValue({ data: { workspace: { senderEmail: "", mailConfigured: false } } });
  render(<TestMailDialog open onClose={() => {}} />);
  expect(
    await screen.findByText("Email sending is not configured for this workspace.")
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send Test" })).toBeDisabled();
  expect(axios.post).not.toHaveBeenCalled();
});

test("reopening the test dialog does not silently reuse a previously selected template", async () => {
  axios.get.mockResolvedValue({
    data: { workspace: { senderEmail: "configured@example.com", mailConfigured: true } },
  });
  const { rerender } = render(<TestMailDialog open onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Send Test" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Receiver email"), {
    target: { value: "receiver@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Subject" } });
  fireEvent.click(screen.getByText("Choose template"));
  rerender(<TestMailDialog open={false} onClose={() => {}} />);
  rerender(<TestMailDialog open onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Send Test" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Send Test" }));
  expect(
    await screen.findByText("Enter a receiver, subject, and email template.")
  ).toBeInTheDocument();
  expect(axios.post).not.toHaveBeenCalled();
});
