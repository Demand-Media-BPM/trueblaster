import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "../App";
import axios from "axios";
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../utilities/apiAuth", () => ({ clearSession: () => global.localStorage.clear() }));
jest.mock(
  "react-router-dom",
  () => ({
    BrowserRouter: () => "Workspace content",
    Routes: () => null,
    Route: () => null,
    NavLink: () => null,
    Navigate: () => null,
  }),
  { virtual: true }
);
jest.mock("../pages/Contacts", () => () => null);
jest.mock("../pages/Campaigns", () => () => null);
jest.mock("../pages/MailPreview", () => () => null);
jest.mock("../pages/BlockList", () => () => null);
jest.mock("../pages/UnsubscribeList", () => () => null);
jest.mock("../component/HeaderBar", () => () => null);
jest.mock("../component/Loader", () => () => "Checking session");
jest.mock("../pages/Login", () => () => "Login form");
jest.mock("react-toastify", () => ({ ToastContainer: () => null }));
const session = {
  data: {
    user: { firstName: "Test", lastName: "Owner", email: "test@example.com" },
    workspace: { id: "workspace-1", name: "Test workspace" },
  },
};
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("authToken", "token");
  axios.get.mockReset();
});
test("protected screens wait for server validation before restoring a saved session", async () => {
  let resolve;
  axios.get.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  render(<App />);
  expect(screen.getByText("Checking session")).toBeInTheDocument();
  expect(screen.queryByText("Workspace content")).not.toBeInTheDocument();
  resolve(session);
  expect(await screen.findByText("Workspace content")).toBeInTheDocument();
  expect(localStorage.getItem("loggedInUser")).toBe("Test Owner");
});
test("an invalid token returns to login", async () => {
  axios.get.mockRejectedValue({ response: { status: 401 } });
  render(<App />);
  expect(await screen.findByText("Login form")).toBeInTheDocument();
  expect(localStorage.getItem("authToken")).toBeNull();
});
test("connection failures preserve the session and allow retry", async () => {
  axios.get.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValueOnce(session);
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to connect");
  expect(localStorage.getItem("authToken")).toBe("token");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Workspace content")).toBeInTheDocument();
});
