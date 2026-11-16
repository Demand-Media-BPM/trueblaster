import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import grapesjs from "grapesjs";
import axios from "axios";
import TemplateEditor from "../component/TemplateEditor";

jest.mock("axios", () => ({ __esModule: true, default: { post: jest.fn(), put: jest.fn() } }));
jest.mock("grapesjs-preset-newsletter", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("grapesjs", () => ({
  __esModule: true,
  default: { init: jest.fn(() => {
    let html = "", css = "", pendingText = null;
    const callbacks = {};
    const textView = { disableEditing: async () => { if (pendingText !== null) html = pendingText; pendingText = null; } };
    const wrapper = { find: () => [], components: () => ({ models: [] }) };
    const editor = {
      getEditing: () => pendingText !== null ? { getView: () => textView } : undefined,
      typeInline: value => { pendingText = value; callbacks["component:input"]?.(); },
      getHtml: () => html,
      getCss: () => css,
      setComponents: value => { html = value; },
      setStyle: value => { css = value; },
      changeHtml: value => { html = value; callbacks.update?.(); },
      getWrapper: () => wrapper,
      Components: { addType: jest.fn() },
      Panels: { getPanels: () => ({ reset: jest.fn() }) },
      BlockManager: { add: jest.fn(), get: () => ({ set: jest.fn() }) },
      RichTextEditor: { add: jest.fn() },
      UndoManager: { clear: jest.fn(), hasUndo: () => true, hasRedo: () => false, undo: jest.fn(), redo: jest.fn() },
      on: (events, callback) => {
        events.split(" ").forEach(event => { callbacks[event] = callback; });
        if (events === "load") Promise.resolve().then(callback);
      },
      setDevice: jest.fn(),
      destroy: jest.fn(),
    };
    return editor;
  }) },
}));

const initialiseMockEditor = grapesjs.init.getMockImplementation();
const template = { name: "Welcome", html: "<p>Hello {{firstName}}</p>", css: "p { color: green; }" };
beforeEach(() => { axios.post.mockReset(); axios.put.mockReset(); grapesjs.init.mockImplementation(initialiseMockEditor); });

async function openEditor(props = {}) {
  const callbacks = { onSaved: jest.fn(), onClose: jest.fn() };
  render(<TemplateEditor template={template} {...callbacks} {...props} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled(), { timeout: 5000 });
  return callbacks;
}

test("a new template stays open after save and subsequent saves update its returned ID", async () => {
  axios.post.mockResolvedValue({ data: { ...template, _id: "saved-id" } });
  axios.put.mockResolvedValue({ data: { ...template, _id: "saved-id", name: "Updated welcome" } });
  const callbacks = await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Save template" }));
  await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledTimes(1));
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(axios.post.mock.calls[0][1]).toEqual(template);
  fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Updated welcome" } });
  fireEvent.click(screen.getByRole("button", { name: "Save template" }));
  await waitFor(() => expect(axios.put).toHaveBeenCalled());
  expect(axios.put.mock.calls[0][0]).toMatch(/\/api\/preview\/saved-id$/);
  expect(axios.post).toHaveBeenCalledTimes(1);
});

test("save failure keeps the editor open and preserves unsaved work", async () => {
  axios.post.mockRejectedValue({ response: { data: { error: "Save unavailable" } } });
  const callbacks = await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Save template" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save unavailable");
  expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Save template" })).toBeEnabled();
});

test("edits made while a save is pending remain unsaved after its response", async () => {
  let resolve;
  axios.post.mockImplementation(() => new Promise(done => { resolve = done; }));
  const callbacks = await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Save template" }));
  await waitFor(() => expect(axios.post).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Another edit" } });
  resolve({ data: { ...template, _id: "saved-id" } });
  await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalled());
  expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
  expect(screen.getByRole("button", { name: "Save template" })).toBeEnabled();
});

test("preview uses sample contact values without changing saved content", async () => {
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  const preview = await screen.findByTitle("Email preview");
  expect(preview).toHaveAttribute("sandbox", "");
  expect(preview.getAttribute("srcdoc")).toContain("Hello Rahul");
  fireEvent.click(screen.getByRole("checkbox", { name: "Use sample contact" }));
  expect(preview.getAttribute("srcdoc")).toContain("Hello {{firstName}}");
  expect(grapesjs.init.mock.results[0].value.getHtml()).toBe(template.html);
});

test("closing dirty work requires an explicit discard decision", async () => {
  const callbacks = await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Templates" }));
  const dialog = await screen.findByRole("dialog", { name: "Leave without saving?" });
  expect(callbacks.onClose).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Templates" }));
  fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(callbacks.onClose).toHaveBeenCalledTimes(1));
});


test("inline text is marked dirty immediately and committed before saving", async () => {
  axios.put.mockResolvedValue({ data: { ...template, _id: "existing-id", html: "<p>Fresh typing</p>" } });
  await openEditor({ template: { ...template, _id: "existing-id" } });
  act(() => grapesjs.init.mock.results[0].value.typeInline("<p>Fresh typing</p>"));
  expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
  fireEvent.click(screen.getByRole("button", { name: "Save template" }));
  await waitFor(() => expect(axios.put).toHaveBeenCalled());
  expect(axios.put.mock.calls[0][1].html).toBe("<p>Fresh typing</p>");
});
