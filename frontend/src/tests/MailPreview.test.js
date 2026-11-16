import React from "react";
import { render, screen } from "@testing-library/react";
import MailPreview from "../pages/MailPreview";
import axios from "axios";
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock("grapesjs", () => ({
  __esModule: true,
  default: { plugins: { get: () => true }, init: jest.fn() },
}));
jest.mock("grapesjs-preset-newsletter", () => ({ __esModule: true, default: jest.fn() }));
beforeEach(() => axios.get.mockReset());
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
