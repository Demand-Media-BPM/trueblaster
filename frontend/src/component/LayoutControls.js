import React, { useState } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { addColumn, addSection, align, blockCell, columns, context, duplicateItem, friendlyName, marker, moveItem, removeItem, sections, setDimension } from "../utilities/emailLayout";

function SectionDialog({ position, editor, beforeChange, changed, onClose }) {
  const [count, setCount] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function insert() {
    setBusy(true);
    try {
      await beforeChange();
      const section = addSection(editor, position, count);
      editor.select(columns(section)[0]);
      changed();
      onClose();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <Dialog open onClose={busy ? undefined : onClose} aria-labelledby="insert-section-title" fullWidth maxWidth="xs">
    <DialogTitle id="insert-section-title">Add a section</DialogTitle>
    <DialogContent><p className="field-hint">Choose its columns. Add your content after inserting the section.</p>{error && <p role="alert">{error}</p>}<div className="layout-section-options">{[1, 2, 3].map(number => <button key={number} type="button" aria-pressed={count === number} onClick={() => setCount(number)}><span className="layout-column-art">{Array.from({ length: number }, (_, index) => <i key={index} />)}</span>{number === 1 ? "One column" : `${number} columns`}</button>)}</div></DialogContent>
    <DialogActions><Button disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy} variant="contained" onClick={insert}>Add section</Button></DialogActions>
  </Dialog>;
}

export function SectionOutline({ editor, beforeChange, changed }) {
  const [insertAt, setInsertAt] = useState(null);
  if (!editor?.getWrapper) return null;
  const items = sections(editor);
  const current = context(editor, editor.getSelected?.()).section;
  return <div className="layout-outline">
    <h3>Email sections</h3><p>Choose a section, or insert one between two existing sections.</p>
    <div className="layout-outline-items">{items.map((section, index) => <React.Fragment key={section.getId()}>
      <button className="layout-insert" type="button" aria-label={`Add section before section ${index + 1}`} onClick={() => setInsertAt(index)}>＋ Add section here</button>
      <button type="button" className="layout-section-item" aria-pressed={current === section} onClick={() => editor.select(section)}><strong>Section {index + 1}</strong><span>{columns(section).length || "Imported"} {columns(section).length === 1 ? "column" : "columns"}</span></button>
    </React.Fragment>)}
    <button className="layout-insert" type="button" aria-label={items.length ? "Add section at end" : "Add first section"} onClick={() => setInsertAt(items.length)}>＋ {items.length ? "Add section here" : "Add first section"}</button></div>
    {insertAt !== null && <SectionDialog position={insertAt} editor={editor} beforeChange={beforeChange} changed={changed} onClose={() => setInsertAt(null)} />}
  </div>;
}

function dimensionValue(style, attributes, property) {
  if (property === "height") return parseFloat(style.height || attributes.height) || "";
  if (style[property] !== undefined) return parseFloat(style[property]) || 0;
  const parts = String(style.padding || "0").split(/\s+/).map(value => parseFloat(value) || 0);
  return { "padding-top": parts[0], "padding-right": parts[1] ?? parts[0], "padding-bottom": parts[2] ?? parts[0], "padding-left": parts[3] ?? parts[1] ?? parts[0] }[property];
}

export default function LayoutControls({ editor, beforeChange, changed }) {
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);
  const [insertAt, setInsertAt] = useState(null);
  if (!editor?.getWrapper) return null;
  const selected = editor.getSelected?.();
  const current = context(editor, selected);
  const structural = marker(selected, "section") || marker(selected, "column");
  const item = structural ? selected : current.block || selected;
  const available = !!selected && current.inside && selected !== current.root && (marker(item, "section") || marker(item, "column") || marker(item, "block") || !["table", "tbody", "tr", "td", "th"].includes(selected.get?.("tagName")));
  const columnItems = columns(current.section);
  const sectionIndex = sections(editor).indexOf(current.section);
  const target = marker(item, "column") ? item : marker(item, "section") ? columns(item)[0] : blockCell(current.block);
  const style = target?.getStyle() || {};
  const attributes = target?.getAttributes() || {};
  const horizontal = style["text-align"] || attributes.align || "left";
  const vertical = style["vertical-align"] || attributes.valign || "top";

  async function perform(action) {
    setError("");
    try { await beforeChange(); action(); changed(); }
    catch (failure) { setError(failure.message); }
  }

  function dimensions(property, label) {
    const value = dimensionValue(style, attributes, property);
    return <label className="layout-dimension" key={property}><span>{label}</span><input aria-label={label} type="number" min="0" max="1000" placeholder={property === "height" ? "Auto" : "0"} key={`${item?.getId?.()}-${property}-${value}`} defaultValue={value} disabled={!available} onBlur={event => {
      if (String(value) !== event.target.value) perform(() => setDimension(editor, selected, property, event.target.value));
    }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>;
  }

  return <div className="layout-controls">
    <nav className="layout-breadcrumbs" aria-label="Selected email content">
      <button onClick={() => editor.select(current.root)}>Email</button>
      {current.section && <><span>›</span><button aria-current={selected === current.section ? "location" : undefined} onClick={() => editor.select(current.section)}>Section {sectionIndex >= 0 ? sectionIndex + 1 : ""}</button></>}
      {current.column && <><span>›</span><button aria-current={selected === current.column ? "location" : undefined} onClick={() => editor.select(current.column)}>Column {columnItems.indexOf(current.column) + 1}</button></>}
      {current.block && <><span>›</span><button aria-current={!structural ? "location" : undefined} onClick={() => editor.select(blockCell(current.block)?.components().at(0) || current.block)}>{friendlyName(current.block)}</button></>}
    </nav>
    <h3>{available ? friendlyName(item) : "Choose something to edit"}</h3>
    <p className="field-hint">{structural ? "These settings apply to the selected column or section." : "Position this block without changing neighbouring content."}</p>
    {error && <p role="alert" className="layout-error">{error}</p>}
    <fieldset disabled={!available} className="layout-fieldset"><legend>Horizontal position</legend><div className="layout-options">{["left", "center", "right"].map(value => <button key={value} type="button" aria-label={`Align ${value}`} aria-pressed={horizontal === value} onClick={() => perform(() => align(editor, selected, value))}>{value === "center" ? "Centre" : value[0].toUpperCase() + value.slice(1)}</button>)}</div></fieldset>
    <fieldset disabled={!available} className="layout-fieldset"><legend>Vertical position</legend><div className="layout-options">{["top", "middle", "bottom"].map(value => <button key={value} type="button" aria-label={`Align ${value}`} aria-pressed={vertical === value} onClick={() => perform(() => align(editor, selected, undefined, value))}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div></fieldset>
    <Button fullWidth size="small" variant="outlined" disabled={!available} onClick={() => perform(() => align(editor, selected, "center", "middle"))}>Centre both ways</Button>
    <p className="layout-help">Middle or bottom uses a 160 px container when height is Auto. You can change it below.</p>
    <div className="layout-dimensions">{dimensions("height", "Container height (px)")}</div>
    <h4>Padding (px)</h4><div className="layout-padding">{["top", "right", "bottom", "left"].map(side => dimensions(`padding-${side}`, `${side[0].toUpperCase() + side.slice(1)} padding`))}</div>
    <div className="layout-actions"><Button size="small" disabled={!available} onClick={() => perform(() => moveItem(item, -1))}>{marker(item, "column") ? "Move left" : "Move up"}</Button><Button size="small" disabled={!available} onClick={() => perform(() => moveItem(item, 1))}>{marker(item, "column") ? "Move right" : "Move down"}</Button><Button size="small" disabled={!available} onClick={() => perform(() => {
      const clone = duplicateItem(item);
      editor.select(marker(clone, "block") ? blockCell(clone)?.components().at(0) || clone : clone);
    })}>Duplicate</Button><Button size="small" color="error" disabled={!available || (marker(item, "column") && columnItems.length === 1)} onClick={() => setDeleting(item)}>Delete</Button></div>

    {current.section && <div className="layout-section-tools"><h4>Section layout</h4><div className="layout-column-picker">{columnItems.map((column, index) => <button key={column.getId()} aria-pressed={selected === column} onClick={() => editor.select(column)}>Column {index + 1}</button>)}</div>{!columnItems.length && <p className="layout-help">This imported section has multiple rows or merged cells. Its structure is preserved; add a new section for simple columns.</p>}<div className="layout-actions"><Button size="small" disabled={!current.column || columnItems.length >= 4} onClick={() => perform(() => editor.select(addColumn(current.section, current.column, false)))}>Insert column before</Button><Button size="small" disabled={!current.column || columnItems.length >= 4} onClick={() => perform(() => editor.select(addColumn(current.section, current.column, true)))}>Insert column after</Button></div><p className="layout-help">Select a column above to insert a neighbour. New columns share the available width equally.</p><Button size="small" disabled={sectionIndex < 0} onClick={() => setInsertAt(sectionIndex)}>＋ Add section above</Button><Button size="small" disabled={sectionIndex < 0} onClick={() => setInsertAt(sectionIndex + 1)}>＋ Add section below</Button></div>}

    {insertAt !== null && <SectionDialog position={insertAt} editor={editor} beforeChange={beforeChange} changed={changed} onClose={() => setInsertAt(null)} />}
    <Dialog open={!!deleting} onClose={() => setDeleting(null)} aria-labelledby="delete-content-title"><DialogTitle id="delete-content-title">Delete this {friendlyName(deleting).toLowerCase()}?</DialogTitle><DialogContent>Its content will be removed from this design. You can restore it with Undo before leaving the editor.</DialogContent><DialogActions><Button onClick={() => setDeleting(null)}>Cancel</Button><Button color="error" onClick={() => perform(() => {
      const parent = deleting.parent();
      removeItem(deleting);
      editor.select(parent);
      setDeleting(null);
    })}>Delete content</Button></DialogActions></Dialog>
  </div>;
}
