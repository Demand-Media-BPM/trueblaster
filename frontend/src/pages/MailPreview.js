import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Menu, MenuItem, TextField } from "@mui/material";
import { MoreHorizontal, PanelsTopLeft, Plus, Search, X } from "lucide-react";
import PageHeader from "../component/PageHeader";
import TemplateEditor from "../component/TemplateEditor";
import { API_URL, getErrorMessage } from "../utilities/api";
import { previewDocument, STARTER_TEMPLATES } from "../utilities/templateContent";
import "../styling/TemplateEditor.css";

export default function MailPreview() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [starterId, setStarterId] = useState("welcome");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    axios.get(API_URL + "/api/preview", { signal: controller.signal })
      .then(({ data }) => setTemplates(Array.isArray(data) ? data : []))
      .catch(failure => { if (!controller.signal.aborted) setError(getErrorMessage(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const saved = useCallback(template => {
    setTemplates(previous => [template, ...previous.filter(item => item._id !== template._id)]);
  }, []);

  const closeEditor = useCallback(() => setEditing(null), []);

  function openDialog(kind, template = null) {
    setMenu(null);
    setError("");
    setDraftName(kind === "duplicate" ? `${template.name} copy` : template?.name || "");
    setStarterId("welcome");
    setDialog({ kind, template });
  }

  async function submitDialog(event) {
    event.preventDefault();
    if (busy) return;
    const name = draftName.trim();
    if (dialog.kind !== "delete" && (!name || name.length > 150)) {
      setError("Enter a template name between 1 and 150 characters.");
      return;
    }
    if (dialog.kind === "create") {
      const starter = STARTER_TEMPLATES.find(item => item.id === starterId);
      setEditing({ name, html: starter.html, css: starter.css });
      setDialog(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { template, kind } = dialog;
      if (kind === "delete") {
        await axios.delete(`${API_URL}/api/preview/${template._id}`);
        setTemplates(previous => previous.filter(item => item._id !== template._id));
      } else {
        const { data } = kind === "rename"
          ? await axios.patch(`${API_URL}/api/preview/${template._id}/rename`, { name })
          : await axios.post(`${API_URL}/api/preview/${template._id}/duplicate`, { name });
        saved(data);
      }
      setDialog(null);
    } catch (failure) {
      setError(getErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const filtered = templates.filter(template => template.name?.toLowerCase().includes(search.toLowerCase()));
  const dialogTitle = { create: "Create an email template", rename: "Rename template", duplicate: "Duplicate template", delete: "Delete template?" }[dialog?.kind];

  return (
    <div className="page">
      <PageHeader title="Email templates" section="Marketing" description="Start with a design, make it yours, and use it in your next campaign." actions={<Button variant="contained" startIcon={<Plus size={17} />} onClick={() => openDialog("create")}>Create New Template</Button>} />
      {error && !dialog && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <div className="toolbar">
        <label className="search-control"><Search size={17} /><input aria-label="Search templates" placeholder="Search templates..." value={search} onChange={event => setSearch(event.target.value)} />{search && <button aria-label="Clear template search" onClick={() => setSearch("")}><X size={15} /></button>}</label>
        <span className="toolbar-meta">{templates.length} {templates.length === 1 ? "template" : "templates"}</span>
      </div>
      {loading ? <CircularProgress aria-label="Loading templates" /> : <div className="template-grid">
        {filtered.map(template => <article key={template._id} className="template-card">
          <div className="template-preview"><iframe title={"Preview: " + template.name} sandbox="" tabIndex={-1} srcDoc={previewDocument(template.html || "", template.css || "")} /></div>
          <div className="template-card-content">
            <h3>{template.name || "Untitled Template"}</h3><p>Workspace email template</p>
            <div className="template-card-actions"><Button size="small" variant="outlined" onClick={() => { setError(""); setEditing(template); }}>Edit template</Button><Button size="small" className="template-more" aria-label={"More actions for " + template.name} aria-haspopup="menu" onClick={event => setMenu({ anchor: event.currentTarget, template })}><MoreHorizontal size={18} /></Button></div>
          </div>
        </article>)}
        {!filtered.length && <div className="empty-state"><PanelsTopLeft size={34} /><h3>{search ? "No matching templates" : "Make your first impression"}</h3><p>{search ? "Try another name or clear your search." : "Start with a welcome email, newsletter, or announcement."}</p>{!search && <Button onClick={() => openDialog("create")}>Choose a starting design</Button>}</div>}
      </div>}

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => openDialog("rename", menu.template)}>Rename</MenuItem>
        <MenuItem onClick={() => openDialog("duplicate", menu.template)}>Duplicate</MenuItem>
        <MenuItem onClick={() => openDialog("delete", menu.template)} sx={{ color: "error.main" }}>Delete</MenuItem>
      </Menu>

      <Dialog open={!!dialog} onClose={busy ? undefined : () => setDialog(null)} fullWidth maxWidth={dialog?.kind === "create" ? "md" : "sm"} aria-labelledby="template-dialog-title">
        <form onSubmit={submitDialog}>
          <DialogTitle id="template-dialog-title">{dialogTitle}</DialogTitle>
          <DialogContent>
            {error && <Alert severity="error">{error}</Alert>}
            {dialog?.kind === "delete" ? <p>Delete “{dialog.template.name}” from your library? Existing campaigns keep their saved email content.</p> : <TextField autoFocus label="Template name" value={draftName} onChange={event => setDraftName(event.target.value)} fullWidth margin="normal" required inputProps={{ maxLength: 150 }} disabled={busy} />}
            {dialog?.kind === "create" && <><p className="field-hint">Choose a starting design. You can change every part of it in the editor.</p><div className="starter-grid">{STARTER_TEMPLATES.map(starter => <button type="button" key={starter.id} className="starter-card" aria-pressed={starterId === starter.id} onClick={() => setStarterId(starter.id)}><div className={"starter-art starter-art-" + starter.id}><span /><span /><span /></div><strong>{starter.name}</strong><small>{starter.description}</small></button>)}</div><p className="field-hint">Before sending, replace sample links and the company address in the footer.</p></>}
          </DialogContent>
          <DialogActions><Button onClick={() => setDialog(null)} disabled={busy}>Cancel</Button><Button type="submit" variant="contained" color={dialog?.kind === "delete" ? "error" : "primary"} disabled={busy}>{busy ? "Please wait…" : dialog?.kind === "create" ? "Start designing" : dialog?.kind === "delete" ? "Delete template" : "Save"}</Button></DialogActions>
        </form>
      </Dialog>

      {editing && <TemplateEditor key={editing._id || "new-template"} template={editing} onClose={closeEditor} onSaved={saved} />}
    </div>
  );
}
