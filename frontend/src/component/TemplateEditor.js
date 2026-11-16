import LayoutControls, { SectionOutline } from "./LayoutControls";
import { addContent, addSection, blockCell, blockDefinition, columns, friendlyName, prepareLayout, registerLayoutTypes, sectionDefinition, sections } from "../utilities/emailLayout";
import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import grapesjs from "grapesjs";
import newsletter from "grapesjs-preset-newsletter";
import "grapesjs/dist/css/grapes.min.css";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Switch, TextField } from "@mui/material";
import { ArrowLeft, Check, Eye, ImagePlus, Monitor, Redo2, Save, Smartphone, Undo2 } from "lucide-react";
import { API_URL, getErrorMessage } from "../utilities/api";
import { PERSONALISATION_FIELDS, previewDocument, publicImageUrl } from "../utilities/templateContent";
import "../styling/TemplateEditor.css";

export default function TemplateEditor({ template, onClose, onSaved }) {
  const canvasRef = useRef(null);
  const blocksRef = useRef(null);
  const stylesRef = useRef(null);
  const traitsRef = useRef(null);
  const editorRef = useRef(null);
  const baselineRef = useRef("");
  const savedIdRef = useRef(template._id);
  const nameRef = useRef(template.name);
  const dirtyRef = useRef(!template._id);
  const activeTextDirtyRef = useRef(false);
  const activeTextViewRef = useRef(null);
  const textSyncRef = useRef(null);
  const savingRef = useRef(false);
  const mountedRef = useRef(false);
  const imageTargetRef = useRef(null);
  const [name, setName] = useState(template.name);
  const [ready, setReady] = useState(false);
  const [hostReady, setHostReady] = useState(false);
  const [dirty, setDirty] = useState(!template._id);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [, setLayoutVersion] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [device, setDevice] = useState("Desktop");
  const [preview, setPreview] = useState(null);
  const [sampleContact, setSampleContact] = useState(true);
  const [confirmClose, setConfirmClose] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [imageLink, setImageLink] = useState("");
  const [imageError, setImageError] = useState("");
  const [uploading, setUploading] = useState(false);

  const markDirty = useCallback(value => {
    dirtyRef.current = value;
    if (mountedRef.current) setDirty(value);
  }, []);

  const snapshot = useCallback(() => {
    const editor = editorRef.current;
    return editor ? { name: nameRef.current.trim(), html: editor.getHtml(), css: editor.getCss() } : null;
  }, []);

  const refreshChanges = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !mountedRef.current) return;
    markDirty(activeTextDirtyRef.current || !savedIdRef.current || JSON.stringify(snapshot()) !== baselineRef.current);
    setCanUndo(editor.UndoManager.hasUndo());
    setCanRedo(editor.UndoManager.hasRedo());
    setLayoutVersion(value => value + 1);
  }, [markDirty, snapshot]);

  // GrapesJS keeps inline text in its canvas until it is synchronised to the model.
  const flushText = useCallback(async () => {
    const view = activeTextViewRef.current || editorRef.current?.getEditing?.()?.getView?.();
    const operation = textSyncRef.current || (view?.disableEditing ? Promise.resolve(view.disableEditing()) : null);
    if (operation) {
      textSyncRef.current = operation;
      try { await operation; } finally {
        if (textSyncRef.current === operation) textSyncRef.current = null;
      }
    }
    activeTextViewRef.current = null;
    activeTextDirtyRef.current = false;
  }, []);

  const closeEditor = useCallback(async () => {
    if (savingRef.current) return;
    await flushText();
    if (dirtyRef.current) setConfirmClose(true);
    else onClose();
  }, [flushText, onClose]);

  // Capture exactly what was submitted so edits made during a request stay unsaved.
  const save = useCallback(async () => {
    if (!editorRef.current || savingRef.current) return;
    if (!nameRef.current.trim() || nameRef.current.trim().length > 150) {
      setError("Give your template a name between 1 and 150 characters.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await flushText();
      const payload = snapshot();
      const { data } = savedIdRef.current
        ? await axios.put(`${API_URL}/api/preview/${savedIdRef.current}`, payload)
        : await axios.post(`${API_URL}/api/preview`, payload);
      if (!data?._id) throw new Error("The server did not confirm the saved template.");
      savedIdRef.current = data._id;
      baselineRef.current = JSON.stringify(payload);
      if (mountedRef.current) {
        setSavedAt(new Date());
        markDirty(activeTextDirtyRef.current || JSON.stringify(snapshot()) !== baselineRef.current);
        onSaved(data);
      }
    } catch (failure) {
      if (mountedRef.current) setError(getErrorMessage(failure));
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }, [flushText, markDirty, onSaved, snapshot]);

  useEffect(() => {
    if (!hostReady) return;
    mountedRef.current = true;
    let disposed = false;
    let editor;

    try {
      editor = grapesjs.init({
        container: canvasRef.current,
        height: "100%",
        width: "auto",
        storageManager: false,
        noticeOnUnload: false,
        selectorManager: { componentFirst: true },
        canvasCss: "[data-tb-column]:empty { height: 90px; outline: 1px dashed #a4b99a; } [data-tb-column]:empty::before { content: 'Click this column, then add content'; display: block; padding: 18px 8px; color: #839379; font: 11px Arial; text-align: center; }",
        panels: { defaults: [] },
        blockManager: {
          appendTo: blocksRef.current,
          appendOnClick: async (block, instance) => {
            if (block.getId() === "image") { openImage(); return; }
            await flushText();
            const id = block.getId();
            if (["sect100", "sect50", "sect33"].includes(id)) {
              const section = addSection(instance, sections(instance).length, id === "sect50" ? 2 : id === "sect33" ? 3 : 1);
              instance.select(columns(section)[0]);
            } else {
              const blockComponent = addContent(instance, id === "tb-spacer" ? "spacer" : id, instance.getSelected());
              instance.select(blockCell(blockComponent)?.components().at(0) || blockComponent);
            }
            refreshChanges();
          },
        },
        traitManager: { appendTo: traitsRef.current },
        styleManager: {
          appendTo: stylesRef.current,
          sectors: [
            { name: "Text", open: true, properties: ["font-family", "font-size", "font-weight", "color", "line-height", "text-align", "text-decoration"] },
            { name: "Spacing & size", open: false, properties: ["width", "max-width", "height", "padding", "margin"] },
            { name: "Background & border", open: false, properties: ["background-color", "border", "border-radius"] },
          ],
        },
        deviceManager: { devices: [
          { id: "Desktop", name: "Desktop", width: "600px" },
          { id: "Mobile", name: "Mobile", width: "360px", widthMedia: "480px" },
        ] },
        assetManager: { upload: false, embedAsBase64: false },
        plugins: [instance => { registerLayoutTypes(instance); newsletter(instance, {
          blocks: [],
          useCustomTheme: false,
          showStylesOnChange: false,
          showBlocksOnLoad: false,
          updateStyleManager: false,
          block: id => ({ category: ["sect100", "sect50"].includes(id) ? "Layouts" : "Content" }),
        }); }],
      });
      editorRef.current = editor;
      editor.Panels.getPanels().reset();
      const definitions = [
        ["sect100", "One column", "Layouts", sectionDefinition(1)],
        ["sect50", "Two columns", "Layouts", sectionDefinition(2)],
        ["sect33", "Three columns", "Layouts", sectionDefinition(3)],
        ["heading", "Heading", "Content", blockDefinition("heading")],
        ["text", "Text", "Content", blockDefinition("text")],
        ["button", "Button", "Content", blockDefinition("button")],
        ["image", "Image", "Content", blockDefinition("image")],
        ["divider", "Divider", "Content", blockDefinition("divider")],
        ["tb-spacer", "Spacer", "Content", blockDefinition("spacer")],
      ];
      definitions.forEach(([id, label, category, content]) => editor.BlockManager.add(id, { label, category, content }));

      // Personalisation inserted from this toolbar stays at the text cursor.
      editor.RichTextEditor.add("personalise", {
        icon: '<select aria-label="Insert personalisation"><option value="">Personalise</option>' + PERSONALISATION_FIELDS.map(field => `<option value="{{${field.key}}}">${field.label}</option>`).join("") + "</select>",
        event: "change",
        result: (rte, action) => {
          const select = action.btn.querySelector("select");
          if (select.value) rte.insertHTML(select.value);
          select.value = "";
        },
      });
      editor.RichTextEditor.add("bullet-list", { icon: "• List", attributes: { title: "Bulleted list" }, result: rte => rte.exec("insertUnorderedList") });
      editor.RichTextEditor.add("numbered-list", { icon: "1. List", attributes: { title: "Numbered list" }, result: rte => rte.exec("insertOrderedList") });

      editor.on("rte:enable", view => { activeTextViewRef.current = view; });
      editor.on("component:input", () => {
        activeTextDirtyRef.current = true;
        markDirty(true);
        setCanUndo(true);
        setCanRedo(false);
      });
      editor.on("component:selected", component => {
        component.setName?.(friendlyName(component));
        setSelectedName(friendlyName(component));
        setLayoutVersion(value => value + 1);
      });
      editor.on("component:deselected", () => { setSelectedName(""); setLayoutVersion(value => value + 1); });
      editor.on("asset:open", () => {
        editor.AssetManager.close();
        imageTargetRef.current = editor.getSelected();
        setImageUrl(editor.getSelected()?.getAttributes().src || "");
        setImageAlt(editor.getSelected()?.getAttributes().alt || "");
        setImageLink(editor.getSelected()?.parent()?.is("link") ? editor.getSelected().parent().getAttributes().href || "" : "");
        setImageError("");
        setImageOpen(true);
      });
      editor.on("load", () => {
        if (disposed) return;
        // Load the stylesheet first so inline styles parsed from HTML are not overwritten.
        editor.setStyle(template.css || "");
        editor.setComponents(template.html || "");
        prepareLayout(editor);
        editor.UndoManager.clear();
        baselineRef.current = JSON.stringify(snapshot());
        markDirty(!savedIdRef.current);
        editor.on("update undo redo", refreshChanges);
        setReady(true);
      });
    } catch (failure) {
      setError("The email editor could not start. Close it and try again.");
    }

    return () => {
      disposed = true;
      mountedRef.current = false;
      editorRef.current = null;
      // Let rich-text teardown finish before destroying its parser and model tree.
      const view = activeTextViewRef.current || editor?.getEditing?.()?.getView?.();
      const pending = textSyncRef.current || view?.disableEditing?.();
      Promise.resolve(pending).catch(() => {}).then(() => editor?.destroy());
    };
    // A new editor instance is created only when the selected template changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostReady]);

  useEffect(() => {
    const warnBeforeLeaving = event => {
      if (!dirtyRef.current && !savingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const keyboardSave = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    window.addEventListener("keydown", keyboardSave);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeLeaving);
      window.removeEventListener("keydown", keyboardSave);
    };
  }, [save]);

  function changeName(value) {
    nameRef.current = value;
    setName(value);
    refreshChanges();
  }

  function changeDevice(value) {
    setDevice(value);
    editorRef.current?.setDevice(value);
  }

  async function openImage() {
    await flushText();
    const selected = editorRef.current?.getSelected();
    imageTargetRef.current = selected?.is("image") ? selected : null;
    setImageUrl(imageTargetRef.current?.getAttributes().src || "");
    setImageAlt(imageTargetRef.current?.getAttributes().alt || "");
    setImageLink(imageTargetRef.current?.parent()?.is("link") ? imageTargetRef.current.parent().getAttributes().href || "" : "");
    setImageError("");
    setImageOpen(true);
  }

  async function uploadImage(file) {
    if (!file) return;
    if (!/\.(png|jpe?g|gif|webp)$/i.test(file.name) || file.size > 5 * 1024 * 1024) {
      setImageError("Choose a PNG, JPG, GIF, or WebP image up to 5 MB.");
      return;
    }
    setUploading(true);
    setImageError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await axios.post(API_URL + "/api/preview/images", form);
      if (!publicImageUrl(data.url)) throw new Error("The server did not return a usable image URL.");
      if (mountedRef.current) setImageUrl(data.url);
    } catch (failure) {
      if (mountedRef.current) setImageError(getErrorMessage(failure));
    } finally {
      if (mountedRef.current) setUploading(false);
    }
  }

  function insertImage() {
    const url = publicImageUrl(imageUrl.trim());
    if (!url) {
      setImageError("Enter a complete image URL starting with https:// or http://.");
      return;
    }
    const link = imageLink.trim() ? publicImageUrl(imageLink.trim()) : null;
    if (imageLink.trim() && !link) {
      setImageError("Enter a complete destination URL starting with https:// or http://.");
      return;
    }
    const editor = editorRef.current;
    const target = imageTargetRef.current;
    if (target?.is("image")) {
      target.addAttributes({ src: url, alt: imageAlt });
      const parent = target.parent();
      if (parent?.is("link")) {
        if (link) parent.addAttributes({ href: link });
        else parent.removeAttributes("href");
      } else if (link) {
        target.replaceWith({ type: "link", attributes: { href: link, target: "_blank", rel: "noopener noreferrer" }, components: [target.toJSON()] });
      }
    } else {
      const imageDefinition = { type: "image", attributes: { src: url, alt: imageAlt }, style: { "max-width": "100%", height: "auto", display: "block" } };
      const image = addContent(editor, "image", editor.getSelected(), link ? { type: "link", attributes: { href: link, target: "_blank", rel: "noopener noreferrer" }, components: [imageDefinition] } : imageDefinition);
      editor.select(image.find("img")[0] || image);
    }
    setImageOpen(false);
    refreshChanges();
  }

  async function insertToken(key) {
    if (!key) return;
    await flushText();
    const selected = editorRef.current?.getSelected();
    if (!selected || !["text", "link"].some(type => selected.is(type))) {
      setError("Select a text block first, or double-click text and use Personalise in its toolbar.");
      return;
    }
    selected.append({ type: "textnode", content: `{{${key}}}` });
    refreshChanges();
  }

  async function showPreview() {
    await flushText();
    setPreview(snapshot());
    setSampleContact(true);
  }

  return (
    <Dialog open fullScreen slotProps={{ transition: { onEntered: () => setHostReady(true) }, paper: { "aria-label": "Email template editor", "aria-labelledby": undefined } }} onClose={closeEditor} aria-label="Email template editor" className="template-editor-dialog">
      <div className="template-editor">
        <header className="te-header">
          <Button onClick={closeEditor} disabled={saving || uploading} startIcon={<ArrowLeft size={16} />}>Templates</Button>
          <div className="te-name"><label htmlFor="template-name">Template name</label><input id="template-name" disabled={!ready} value={name} maxLength={150} onChange={event => changeName(event.target.value)} /></div>
          <span className="te-save-status" role="status">{saving ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? <><Check size={14} />Saved {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</> : "All changes saved"}</span>
          <div className="te-header-actions"><Button variant="outlined" onClick={showPreview} disabled={!ready} startIcon={<Eye size={16} />}>Preview</Button><Button variant="contained" onClick={save} disabled={!ready || saving || (!dirty && !!savedIdRef.current)} startIcon={<Save size={16} />}>{saving ? "Saving…" : "Save template"}</Button></div>
        </header>
        {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}
        <div className="te-toolbar">
          <div className="te-tool-group"><Button size="small" onClick={async () => { await flushText(); editorRef.current?.UndoManager.undo(); refreshChanges(); }} disabled={!canUndo} startIcon={<Undo2 size={16} />}>Undo</Button><Button size="small" onClick={async () => { await flushText(); editorRef.current?.UndoManager.redo(); refreshChanges(); }} disabled={!canRedo} startIcon={<Redo2 size={16} />}>Redo</Button></div>
          <div className="te-devices" role="group" aria-label="Editor device"><button aria-pressed={device === "Desktop"} onClick={() => changeDevice("Desktop")}><Monitor size={15} />Desktop</button><button aria-pressed={device === "Mobile"} onClick={() => changeDevice("Mobile")}><Smartphone size={15} />Mobile</button></div>
          <Button size="small" disabled={!ready} startIcon={<ImagePlus size={16} />} onClick={openImage}>Add image</Button>
        </div>
        <div className="te-layout">
          <aside className="te-panel te-blocks">{ready && <SectionOutline editor={editorRef.current} beforeChange={flushText} changed={refreshChanges} />}<h2>Add content</h2><p>Drag or click a block to add it.</p><div ref={blocksRef} /><div className="te-personalisation"><h3>Make it personal</h3><p>Select a text block to add a contact field at its end. Use the inline toolbar to insert at the cursor.</p><select aria-label="Add contact field" disabled={!ready} value="" onChange={event => insertToken(event.target.value)}><option value="">Insert personalisation</option>{PERSONALISATION_FIELDS.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}</select></div></aside>
          <div className="te-canvas-area"><div className="te-canvas-label">{device === "Desktop" ? "600 px email" : "360 px mobile view"} · Double-click text to edit</div><div ref={canvasRef} className="te-canvas" />{!ready && <p className="te-loading">Preparing your email editor…</p>}</div>
          <aside className="te-panel te-settings">{ready && <LayoutControls editor={editorRef.current} beforeChange={flushText} changed={refreshChanges} />}<h2>{selectedName || "Block settings"}</h2><p>{selectedName ? "Adjust this block’s content and appearance." : "Click content in your email, then use its position and style controls."}</p><div ref={traitsRef} /><div ref={stylesRef} /><p className="te-settings-note">For buttons and links, edit the destination in the block settings. Select an image and choose Add image to replace it.</p></aside>
        </div>
      </div>

      <Dialog open={!!preview} onClose={() => setPreview(null)} fullWidth maxWidth="lg" aria-labelledby="preview-title">
        <DialogTitle id="preview-title">Preview your email</DialogTitle>
        <DialogContent><div className="te-preview-toolbar"><div className="te-devices" role="group" aria-label="Preview device"><button aria-pressed={device === "Desktop"} onClick={() => changeDevice("Desktop")}><Monitor size={15} />Desktop</button><button aria-pressed={device === "Mobile"} onClick={() => changeDevice("Mobile")}><Smartphone size={15} />Mobile</button></div><FormControlLabel control={<Switch checked={sampleContact} onChange={event => setSampleContact(event.target.checked)} />} label="Use sample contact" /></div><p className="field-hint">{sampleContact ? "Sample contact: Rahul Sharma · Example Ltd. Your saved personalisation stays unchanged." : "Showing the original personalisation fields."} Appearance can vary between email apps.</p><div className="te-preview-stage"><iframe title="Email preview" sandbox="" style={{ width: device === "Mobile" ? 360 : 600 }} srcDoc={preview ? previewDocument(preview.html, preview.css, sampleContact) : ""} /></div></DialogContent>
        <DialogActions><Button onClick={() => setPreview(null)}>Back to editing</Button></DialogActions>
      </Dialog>

      <Dialog open={confirmClose} onClose={() => setConfirmClose(false)} aria-labelledby="discard-title">
        <DialogTitle id="discard-title">Leave without saving?</DialogTitle><DialogContent>Your latest edits haven’t been saved. Keep editing or discard those changes.</DialogContent><DialogActions><Button onClick={() => setConfirmClose(false)}>Keep editing</Button><Button color="error" onClick={async () => { await flushText(); onClose(); }}>Discard changes</Button></DialogActions>
      </Dialog>

      <Dialog open={imageOpen} onClose={uploading ? undefined : () => setImageOpen(false)} fullWidth maxWidth="sm" aria-labelledby="image-title">
        <DialogTitle id="image-title">Add or replace an image</DialogTitle><DialogContent>{imageError && <Alert severity="error">{imageError}</Alert>}<p className="field-hint">Upload an image or use its public URL. Images must be publicly reachable to appear in recipients’ inboxes.</p><Button component="label" variant="outlined" disabled={uploading}>{uploading ? "Uploading…" : "Upload image"}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={event => { uploadImage(event.target.files[0]); event.target.value = ""; }} /></Button><p className="field-hint">PNG, JPG, GIF, or WebP · Up to 5 MB</p><TextField label="Image URL" fullWidth margin="normal" value={imageUrl} disabled={uploading} onChange={event => setImageUrl(event.target.value)} /><TextField label="Alternative text" helperText="Describe the image for people who cannot see it." fullWidth margin="normal" value={imageAlt} onChange={event => setImageAlt(event.target.value)} /><TextField label="Link URL (optional)" helperText="Where should someone go when they click this image?" fullWidth margin="normal" value={imageLink} onChange={event => setImageLink(event.target.value)} /></DialogContent><DialogActions><Button disabled={uploading} onClick={() => setImageOpen(false)}>Cancel</Button><Button variant="contained" disabled={uploading || !imageUrl.trim()} onClick={insertImage}>Use image</Button></DialogActions>
      </Dialog>
    </Dialog>
  );
}
