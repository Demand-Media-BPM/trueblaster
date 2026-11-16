import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SuppressionList from "../component/SuppressionList";
import axios from "axios";
jest.mock("axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), delete: jest.fn(), post: jest.fn() },
}));
beforeEach(() => {
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: [] });
});
test("suppression search passes email as a query parameter without corrupting plus addresses", async () => {
  render(<SuppressionList endpoint="/api/blocklist" title="Blocklist" />);
  await waitFor(() => expect(axios.get).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText("Search by email"), {
    target: { value: "person+tag@example.com" },
  });
  await waitFor(() =>
    expect(axios.get.mock.calls.at(-1)[1].params).toEqual({ email: "person+tag@example.com" })
  );
});
test("backend list errors are visible instead of looking like an empty successful list", async () => {
  axios.get.mockRejectedValue({ response: { data: { error: "Workspace access denied" } } });
  render(<SuppressionList endpoint="/api/unsubscribelist" title="Unsubscribe list" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Workspace access denied");
});
