import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MailPreview from "../pages/MailPreview";
import axios from "axios";
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("grapesjs", () => ({
  __esModule: true,
  default: { plugins: { get: () => true }, init: jest.fn() },
}));
jest.mock("grapesjs-preset-newsletter", () => ({ __esModule: true, default: jest.fn() }));
beforeEach(() => { axios.get.mockReset(); axios.post.mockReset(); });
test("template backend failures are displayed to the user", async () => {
  axios.get.mockRejectedValue({ response: { data: { error: "Unable to load templates" } } });
  render(<MailPreview />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load templates");
});
test("untrusted template HTML is isolated in a sandboxed frame", async () => {
  axios.get.mockResolvedValue({
    data: [
      {
        _id: "template-1",
        name: "Welcome",
        html: "<script>window.untrusted=true</script><p>Preview</p>",
        css: "p { color: red; }",
      },
    ],
  });
  render(<MailPreview />);
  const frame = await screen.findByTitle("Preview: Welcome");
  expect(frame).toHaveAttribute("sandbox", "");
  expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("color: red"));
  expect(window.untrusted).toBeUndefined();
});

test("HTML upload stores the original source without opening or normalizing it in the editor", async () => {
  axios.get.mockResolvedValue({ data: [] });
  const html = '\n<!doctype html><html><head><style>.brand{color:teal}</style></head><body><p class="brand">Original</p></body></html>\n';
  axios.post.mockImplementation(async (url, body) => ({ data: { _id: "imported-template", ...body } }));
  render(<MailPreview />);
  fireEvent.change(screen.getByLabelText("Upload HTML template"), { target: { files: [new File([html], "original.html", { type: "text/html" })] } });
  expect(await screen.findByRole("dialog", { name: "Upload an HTML template" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Upload template" }));
  await waitFor(() => expect(axios.post).toHaveBeenCalled());
  expect(axios.post.mock.calls[0][1]).toEqual({ name: "original", html, css: "" });
  expect(await screen.findByTitle("Preview: original")).toBeInTheDocument();
  expect(screen.queryByText("Save template")).not.toBeInTheDocument();
});
