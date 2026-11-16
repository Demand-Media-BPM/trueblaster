// Layout metadata is saved with the HTML so controls still work after reopening.
const MARKERS = { section: "data-tb-section", column: "data-tb-column", block: "data-tb-block", cell: "data-tb-block-cell" };
const LABELS = { heading: "Heading", text: "Text", button: "Button", image: "Image", divider: "Divider", spacer: "Spacer" };
const tableAttributes = { role: "presentation", width: "100%", cellpadding: "0", cellspacing: "0", border: "0" };
const tableStyle = { width: "100%", "border-collapse": "collapse", "border-spacing": "0" };

export const marker = (component, kind) => component?.getAttributes?.()[MARKERS[kind]] !== undefined;
const children = component => component?.components?.().models || [];
const tag = component => component?.get?.("tagName")?.toLowerCase();

export function closest(component, predicate) {
  let current = component;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent?.();
  }
  return null;
}

export function descendants(component, predicate) {
  return children(component).flatMap(child => [...(predicate(child) ? [child] : []), ...descendants(child, predicate)]);
}

export function blockCell(component) {
  return descendants(component, item => marker(item, "cell"))[0];
}

export function contentRoot(editor) {
  return descendants(editor.getWrapper(), item => item.getAttributes?.()["data-email-content"] !== undefined)[0] || editor.getWrapper();
}

export function columns(section) {
  const rows = children(section).flatMap(child => ["tbody", "thead", "tfoot"].includes(tag(child)) ? children(child) : [child]).filter(child => tag(child) === "tr");
  if (rows.length !== 1) return [];
  const cells = children(rows[0]).filter(child => ["td", "th"].includes(tag(child)));
  return cells.every(cell => Number(cell.getAttributes().colspan || 1) === 1 && Number(cell.getAttributes().rowspan || 1) === 1) ? cells : [];
}

export function sections(editor) {
  return children(contentRoot(editor)).filter(component => marker(component, "section"));
}

export function context(editor, selected) {
  const root = contentRoot(editor);
  const inside = !!closest(selected, component => component === root);
  if (!inside || selected === root) return { root, selected, inside, block: null, column: null, section: null };
  const block = closest(selected, component => marker(component, "block"));
  const column = closest(selected, component => marker(component, "column"));
  const section = closest(selected, component => marker(component, "section"));
  return { root, selected, inside, block, column, section };
}

export function blockKind(component) {
  if (marker(component, "block")) return component.getAttributes()[MARKERS.block];
  if (component?.is?.("image") || descendants(component, item => tag(item) === "img").length) return "image";
  if (tag(component) === "a") return "button";
  if (/^h[1-6]$/.test(tag(component) || "")) return "heading";
  if (tag(component) === "hr") return "divider";
  return "text";
}

export function friendlyName(component) {
  if (marker(component, "section")) return "Section";
  if (marker(component, "column")) return "Column";
  if (marker(component, "cell")) return "Block container";
  if (["td", "th"].includes(tag(component))) return "Imported column";
  if (["tr", "tbody", "table"].includes(tag(component))) return "Imported layout";
  return LABELS[blockKind(component)] || "Content";
}

export function blockDefinition(kind = "text", content) {
  const defaults = {
    heading: { type: "text", tagName: "h2", style: { "font-size": "26px", margin: "0 0 16px", "line-height": "1.3" }, components: "Your heading" },
    text: { type: "text", tagName: "p", style: { "font-size": "16px", "line-height": "1.7", margin: "0 0 16px" }, components: "Add your text here." },
    button: { type: "link", tagName: "a", attributes: { href: "https://example.com", target: "_blank" }, style: { display: "inline-block", padding: "14px 24px", "background-color": "#24342e", color: "#ffffff", "text-decoration": "none", "border-radius": "5px", "font-family": "Arial, sans-serif", "font-size": "16px" }, components: "Button" },
    image: { type: "image", attributes: { alt: "" }, style: { "max-width": "100%", height: "auto", display: "inline-block" } },
    divider: { tagName: "hr", style: { border: "0", "border-top": "1px solid #dce4d6", margin: "16px 0" } },
    spacer: { tagName: "span", style: { "font-size": "1px", "line-height": "24px" }, components: "&nbsp;" },
  };
  return {
    type: "tb-block", tagName: "table", name: LABELS[kind] || "Content",
    attributes: { ...tableAttributes, [MARKERS.block]: kind }, style: { ...tableStyle },
    components: [{ type: "tb-structure", tagName: "tbody", attributes: { "data-tb-structure": "true" }, components: [{ type: "tb-structure", tagName: "tr", attributes: { "data-tb-structure": "true" }, components: [{
      type: "tb-block-cell", tagName: "td", attributes: { [MARKERS.cell]: "true", align: "left", valign: "top" },
      style: { "text-align": "left", "vertical-align": "top", padding: "0", ...(kind === "spacer" ? { height: "24px" } : {}) },
      components: content || { ...(defaults[kind] || defaults.text), name: LABELS[kind] || "Content" },
    }] }] }],
  };
}

export function columnDefinition(count = 1) {
  return { type: "tb-column", tagName: "td", name: "Column", attributes: { [MARKERS.column]: "true", width: `${100 / count}%`, valign: "top" }, style: { width: `${100 / count}%`, "vertical-align": "top", padding: count > 1 ? "8px" : "0" }, components: [] };
}

export function sectionDefinition(count = 1) {
  return { type: "tb-section", tagName: "table", name: "Section", attributes: { ...tableAttributes, [MARKERS.section]: "true" }, style: { ...tableStyle }, components: [{ type: "tb-structure", tagName: "tbody", attributes: { "data-tb-structure": "true" }, components: [{ type: "tb-structure", tagName: "tr", attributes: { "data-tb-structure": "true" }, components: Array.from({ length: count }, () => columnDefinition(count)) }] }] };
}

export function registerLayoutTypes(editor) {
  const types = [
    ["tb-section", "section", "Section", { draggable: "[data-email-content]", droppable: false }],
    ["tb-column", "column", "Column", { draggable: false, droppable: "[data-tb-block]" }],
    ["tb-block", "block", "Content", { draggable: "[data-tb-column]", droppable: false }],
    ["tb-block-cell", "cell", "Block container", { selectable: false, hoverable: false, droppable: false, draggable: false }],
  ];
  types.forEach(([type, kind, name, options]) => editor.Components.addType(type, {
    isComponent: element => element.hasAttribute?.(MARKERS[kind]) ? { type, name: kind === "block" ? LABELS[element.getAttribute(MARKERS.block)] || name : name } : false,
    model: { defaults: { name, ...options } },
  }));
  editor.Components.addType("tb-structure", {
    isComponent: element => element.hasAttribute?.("data-tb-structure") ? { type: "tb-structure" } : false,
    model: { defaults: { selectable: false, hoverable: false, draggable: false, droppable: false } },
  });
}

function inheritedAlignment(component) {
  const element = component.getEl?.();
  const computed = element?.ownerDocument?.defaultView?.getComputedStyle(element);
  if (computed?.textAlign) {
    const value = computed.textAlign;
    if (value === "start") return computed.direction === "rtl" ? "right" : "left";
    if (value === "end") return computed.direction === "rtl" ? "left" : "right";
    if (["left", "center", "right", "justify"].includes(value)) return value;
  }
  const owner = closest(component, item => item.getStyle?.()["text-align"] || item.getAttributes?.().align);
  return owner?.getStyle?.()["text-align"] || owner?.getAttributes?.().align || "left";
}

function wrapContent(component, parent) {
  const at = children(parent).indexOf(component);
  const horizontal = inheritedAlignment(component);
  const definition = blockDefinition(blockKind(component), []);
  const definitionCell = definition.components[0].components[0].components[0];
  definitionCell.style["text-align"] = horizontal;
  definitionCell.attributes.align = horizontal;
  const [wrapper] = parent.append(definition, { at });
  const cell = blockCell(wrapper);
  component.move(cell);
  component.setName(LABELS[blockKind(component)] || "Content");
  return wrapper;
}

// Only simple body content is adapted. Multi-row or merged imported tables stay intact.
export function prepareLayout(editor) {
  const root = contentRoot(editor);
  if (root === editor.getWrapper()) return;
  [...children(root)].forEach(component => {
    if (marker(component, "section") || (component.is?.("textnode") && !String(component.get("content") || "").trim())) return;
    if (tag(component) === "table") {
      component.addAttributes({ [MARKERS.section]: "true" });
      component.setName("Section");
      columns(component).forEach(cell => {
        cell.addAttributes({ [MARKERS.column]: "true" });
        cell.setName("Column");
        [...children(cell)].forEach(child => { if (!marker(child, "block")) wrapContent(child, cell); });
      });
      return;
    }
    const at = children(root).indexOf(component);
    const [section] = root.append(sectionDefinition(), { at });
    const cell = columns(section)[0];
    component.move(cell);
    wrapContent(component, cell);
  });
}

export function ensureBlock(editor, selected) {
  const current = context(editor, selected);
  if (current.block) return current.block;
  if (!selected || !closest(selected, component => component === current.root) || ["td", "tr", "tbody", "table", "body"].includes(tag(selected))) {
    throw new Error("Select a heading, text, button, or image in the email body first.");
  }
  let target = selected;
  if (target.is?.("textnode")) target = target.parent();
  if (target.is?.("image") && target.parent()?.is?.("link")) target = target.parent();
  while (["p", "span", "a", "h1", "h2", "h3", "h4"].includes(tag(target.parent()))) target = target.parent();
  const parent = target.parent();
  if (parent === current.root) {
    const [section] = parent.append(sectionDefinition(), { at: children(parent).indexOf(target) });
    const cell = columns(section)[0];
    target.move(cell);
    return wrapContent(target, cell);
  }
  return wrapContent(target, parent);
}

export function addSection(editor, at, count = 1) {
  const root = contentRoot(editor);
  const items = sections(editor);
  const anchor = items[at];
  const last = items[items.length - 1];
  const index = anchor ? children(root).indexOf(anchor) : last ? children(root).indexOf(last) + 1 : children(root).length;
  const [section] = root.append(sectionDefinition(count), { at: index });
  return section;
}

export function addContent(editor, kind, selected, definition) {
  let current = context(editor, selected);
  if (!current.column && selected && selected !== current.root && !current.section) {
    try { current = context(editor, ensureBlock(editor, selected)); } catch { /* Use a new section when the selection is structural. */ }
  }
  const column = current.column || columns(current.section)[0] || columns(addSection(editor, sections(editor).length))[0];
  const at = current.block?.parent() === column ? children(column).indexOf(current.block) + 1 : children(column).length;
  return column.append(blockDefinition(kind, definition), { at })[0];
}

export function addColumn(section, column, after = true) {
  const cells = columns(section);
  if (!cells.length) throw new Error("This imported layout has merged cells or multiple rows. Add a new section to use column controls.");
  if (cells.length >= 4) throw new Error("Use up to four columns in a section so the email stays readable.");
  const position = Math.max(0, cells.indexOf(column));
  const [inserted] = cells[0].parent().append(columnDefinition(cells.length + 1), { at: position + (after ? 1 : 0) });
  balanceColumns(section);
  return inserted;
}

export function balanceColumns(section) {
  const cells = columns(section);
  cells.forEach(cell => {
    const width = `${Math.round(10000 / cells.length) / 100}%`;
    cell.addAttributes({ width, [MARKERS.column]: "true" });
    cell.addStyle({ width });
  });
}

export function alignmentTargets(editor, selected) {
  if (marker(selected, "column")) return [selected];
  if (marker(selected, "section")) return columns(selected);
  const block = ensureBlock(editor, selected);
  return [blockCell(block)].filter(Boolean);
}

export function align(editor, selected, horizontal, vertical) {
  const targets = alignmentTargets(editor, selected);
  if (!targets.length) throw new Error("Select a simple section, column, or content block to align.");
  targets.forEach(cell => {
    const cells = marker(cell, "column") ? [cell, ...descendants(cell, item => marker(item, "cell"))] : [cell];
    cells.forEach(target => {
      if (horizontal) {
        target.addStyle({ "text-align": horizontal });
        target.addAttributes({ align: horizontal });
        children(target).forEach(child => {
          if (child.is?.("image") || child.is?.("link")) child.addStyle({ display: "inline-block", "max-width": "100%" });
          else if (["p", "div", "h1", "h2", "h3", "h4"].includes(tag(child))) child.addStyle({ "text-align": horizontal });
        });
      }
    });
    if (vertical) {
      cell.addStyle({ "vertical-align": vertical });
      cell.addAttributes({ valign: vertical });
      if (vertical !== "top" && !parseFloat(cell.getStyle().height || cell.getAttributes().height)) {
        cell.addStyle({ height: "160px" });
        cell.addAttributes({ height: "160" });
      }
    }
  });
}

export function setDimension(editor, selected, property, value) {
  const targets = alignmentTargets(editor, selected);
  targets.forEach(cell => {
    if (value === "") {
      const style = { ...cell.getStyle() };
      delete style[property];
      cell.setStyle(style);
      if (property === "height") cell.removeAttributes("height");
    } else {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 1000) throw new Error("Enter a value from 0 to 1000 pixels.");
      cell.addStyle({ [property]: `${number}px` });
      if (property === "height") cell.addAttributes({ height: String(number) });
    }
  });
}

export function moveItem(component, direction) {
  const parent = component?.parent();
  const at = children(parent).indexOf(component);
  const next = at + direction;
  if (!parent || next < 0 || next >= children(parent).length) return;
  // GrapesJS uses the insertion position before removing the moving component.
  component.move(parent, { at: direction > 0 ? next + 1 : next });
}

export function duplicateItem(component) {
  const parent = component.parent();
  if (marker(component, "column") && columns(closest(component, item => marker(item, "section"))).length >= 4) throw new Error("Use up to four columns in a section.");
  const clone = parent.append(component.clone(), { at: children(parent).indexOf(component) + 1 })[0];
  if (marker(component, "column")) balanceColumns(closest(component, item => marker(item, "section")));
  return clone;
}

export function removeItem(component) {
  const section = closest(component, item => marker(item, "section"));
  if (marker(component, "column") && columns(section).length < 2) throw new Error("Keep at least one column in a section.");
  component.remove();
  if (section && marker(component, "column")) balanceColumns(section);
}
