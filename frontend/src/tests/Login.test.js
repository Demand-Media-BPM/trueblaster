import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Login from "../pages/Login";
import axios from "axios";
jest.mock("axios", () => ({ __esModule: true, default: { post: jest.fn() } }));
beforeEach(() => {
  localStorage.clear();
  axios.post.mockReset();
});
const response = {
  data: {
    success: true,
    token: "signed-token",
    workspace: { id: "workspace-id", name: "New workspace" },
    user: { firstName: "Test", lastName: "Owner", email: "test@example.com" },
  },
};
test("login asks for email/password and sends the correct fields", async () => {
  axios.post.mockResolvedValue(response);
  const onLogin = jest.fn();
  render(<Login onLogin={onLogin} />);
  expect(screen.queryByLabelText("First name")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  await waitFor(() => expect(onLogin).toHaveBeenCalledWith("Test Owner"));
  expect(axios.post.mock.calls[0][0]).toMatch(/\/login$/);
  expect(axios.post.mock.calls[0][1]).toEqual({
    email: "test@example.com",
    password: "test-password",
  });
  expect(localStorage.getItem("authToken")).toBe("signed-token");
});
test("signup asks for four fields, creates an account, and opens its workspace", async () => {
  axios.post.mockResolvedValue(response);
  const onLogin = jest.fn();
  render(<Login onLogin={onLogin} />);
  fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
  for (const [label, value] of [
    ["First name", "Test"],
    ["Last name", "Owner"],
    ["Email", "test@example.com"],
    ["Password", "test-password"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
  await waitFor(() => expect(onLogin).toHaveBeenCalled());
  expect(axios.post.mock.calls[0][0]).toMatch(/\/signup$/);
  expect(axios.post.mock.calls[0][1]).toEqual({
    firstName: "Test",
    lastName: "Owner",
    email: "test@example.com",
    password: "test-password",
  });
  expect(JSON.parse(localStorage.getItem("workspace")).id).toBe("workspace-id");
});
test("authentication errors are displayed without storing a session", async () => {
  axios.post.mockRejectedValue({ response: { data: { error: "Invalid email or password" } } });
  const onLogin = jest.fn();
  render(<Login onLogin={onLogin} />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "incorrect-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  expect(onLogin).not.toHaveBeenCalled();
  expect(localStorage.getItem("authToken")).toBeNull();
});
