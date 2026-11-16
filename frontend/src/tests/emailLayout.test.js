import grapesjs from "grapesjs";
import { addColumn, addContent, addSection, align, blockCell, columns, contentRoot, context, descendants, duplicateItem, marker, moveItem, prepareLayout, registerLayoutTypes, removeItem, sections, setDimension } from "../utilities/emailLayout";

const ids = values => values.map(item => item.getId());
let editor;
beforeEach(() => {
  editor = grapesjs.init({ headless: true, storageManager: false, fromElement: false });
  registerLayoutTypes(editor);
  editor.setComponents('<table><tbody><tr><td data-email-content="true"><h1>Heading</h1><p>Neighbouring text</p><a href="https://example.com" style="display:inline-block;padding:12px">My button</a></td></tr><tr><td>Footer unchanged</td></tr></tbody></table>');
  prepareLayout(editor);
  editor.UndoManager.clear();
});
afterEach(() => editor.destroy());

test("existing body blocks become independent without losing footer content or inline styles", () => {
  expect(sections(editor)).toHaveLength(3);
  const button = descendants(editor.getWrapper(), item => item.get("tagName") === "a")[0];
  expect(context(editor, button).block.getAttributes()["data-tb-block"]).toBe("button");
  expect(editor.getHtml()).toContain("Footer unchanged");
  expect(editor.getCss()).toMatch(/padding:\s*12px/);
  prepareLayout(editor);
  expect(sections(editor)).toHaveLength(3);
});

test("centring one button changes only its own container and gives vertical positioning height", () => {
  const button = descendants(editor.getWrapper(), item => item.get("tagName") === "a")[0];
  const paragraph = descendants(editor.getWrapper(), item => item.get("tagName") === "p")[0];
  const neighbourCell = blockCell(context(editor, paragraph).block);
  align(editor, button, "center", "middle");
  const buttonCell = blockCell(context(editor, button).block);
  expect(buttonCell.getAttributes()).toMatchObject({ align: "center", valign: "middle", height: "160" });
  expect(buttonCell.getStyle()).toMatchObject({ "text-align": "center", "vertical-align": "middle", height: "160px" });
  expect(neighbourCell.getStyle()["text-align"]).toBe("left");
  setDimension(editor, button, "padding-top", "24");
  expect(buttonCell.getStyle()["padding-top"]).toBe("24px");
  setDimension(editor, button, "height", "");
  expect(buttonCell.getAttributes().height).toBeUndefined();
});

test("a section can be inserted between two sections and moved, duplicated, or removed", () => {
  const original = sections(editor);
  const middle = addSection(editor, 1, 2);
  expect(ids(sections(editor))).toEqual(ids([original[0], middle, original[1], original[2]]));
  moveItem(middle, 1);
  expect(ids(sections(editor))).toEqual(ids([original[0], original[1], middle, original[2]]));
  moveItem(middle, -1);
  expect(sections(editor)[1].getId()).toBe(middle.getId());
  const copy = duplicateItem(middle);
  expect(sections(editor)[2].getId()).toBe(copy.getId());
  removeItem(copy);
  expect(sections(editor)).toHaveLength(4);
});

test("columns insert in the middle and retain content while sharing widths", () => {
  const section = addSection(editor, 0, 2);
  const [left, right] = columns(section);
  const text = addContent(editor, "text", left);
  const inserted = addColumn(section, left, true);
  expect(ids(columns(section))).toEqual(ids([left, inserted, right]));
  expect(text.parent().getId()).toBe(left.getId());
  expect(columns(section).every(column => column.getStyle().width === "33.33%")).toBe(true);
  removeItem(inserted);
  expect(ids(columns(section))).toEqual(ids([left, right]));
  expect(left.getStyle().width).toBe("50%");
  removeItem(right);
  expect(() => removeItem(left)).toThrow("at least one column");
});

test("clicking a block inserts it into the selected column after the selected block", () => {
  const first = sections(editor)[0];
  const column = columns(first)[0];
  const heading = column.components().at(0);
  const button = addContent(editor, "button", heading);
  expect(button.parent().getId()).toBe(column.getId());
  expect(ids(column.components().models)).toEqual(ids([heading, button]));
  expect(marker(button, "block")).toBe(true);
  expect(contentRoot(editor).components().length).toBe(3);
});

test("merged imported tables are preserved and cannot be changed with simple column tools", () => {
  editor.setComponents('<table><tbody><tr><td data-email-content="true"><table><tbody><tr><td colspan="2">Merged content</td></tr><tr><td>A</td><td>B</td></tr></tbody></table></td></tr></tbody></table>');
  prepareLayout(editor);
  const imported = sections(editor)[0];
  expect(columns(imported)).toHaveLength(0);
  expect(() => addColumn(imported, null)).toThrow("merged cells");
  expect(editor.getHtml()).toContain('colspan="2"');
  expect(editor.getHtml()).toContain("Merged content");
});


test("duplicating a column keeps its content, balances widths, and enforces the column limit", () => {
  const section = addSection(editor, 0, 2);
  const left = columns(section)[0];
  addContent(editor, "button", left);
  const clone = duplicateItem(left);
  expect(columns(section)).toHaveLength(3);
  expect(descendants(clone, item => marker(item, "block"))).toHaveLength(1);
  expect(columns(section).every(column => column.getStyle().width === "33.33%")).toBe(true);
  addColumn(section, clone);
  expect(() => duplicateItem(clone)).toThrow("four columns");
  expect(editor.getHtml()).not.toContain("Click this column, then add content");
});


test("adapting an existing centred layout preserves its inherited alignment", () => {
  editor.setComponents('<table><tbody><tr><td data-email-content="true" align="center" style="text-align:center"><h1>Already centred</h1><a href="https://example.com">Already centred button</a></td></tr></tbody></table>');
  prepareLayout(editor);
  const cells = descendants(contentRoot(editor), item => marker(item, "cell"));
  expect(cells).toHaveLength(2);
  expect(cells.every(cell => cell.getAttributes().align === "center")).toBe(true);
});
