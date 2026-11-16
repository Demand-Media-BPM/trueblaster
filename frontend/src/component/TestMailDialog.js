import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
} from "@mui/material";
import axios from "axios";
import TemplateDropdown from "./TemplateDropdown";
import { API_URL, getErrorMessage } from "../utilities/api";

export default function TestMailDialog({ open, onClose }) {
  const [sender, setSender] = useState("");
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [receiver, setReceiver] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [style, setStyle] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setChecking(true);
    setReady(false);
    setError("");
    setSuccess(false);
    setBody("");
    setStyle("");
    axios
      .get(API_URL + "/me", { signal: controller.signal })
      .then(({ data }) => {
        setSender(data.workspace.senderEmail || "");
        setReady(data.workspace.mailConfigured);
      })
      .catch((err) => {
        if (err.code !== "ERR_CANCELED") setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [open]);
  // The backend selects the workspace sender; the form supplies the test recipient and content.
  const send = async () => {
    if (!receiver.trim() || !subject.trim() || !body) {
      setError("Enter a receiver, subject, and email template.");
      return;
    }
    setSending(true);
    setError("");
    setSuccess(false);
    try {
      await axios.post(API_URL + "/api/campaign/send-test-mail", {
        receiver: receiver.trim(),
        subject,
        body,
        style,
      });
      setSuccess(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };
  return (
    <Dialog open={open} onClose={sending ? undefined : onClose} fullWidth>
      <DialogTitle>Send Test Mail</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error">{error}</Alert>}
        {!checking && !ready && !error && (
          <Alert severity="info">Email sending is not configured for this workspace.</Alert>
        )}
        {success && <Alert severity="success">Test email sent.</Alert>}
        <TextField
          label="Sender email"
          value={sender}
          fullWidth
          margin="normal"
          InputProps={{ readOnly: true }}
          helperText="Uses your workspace sender."
        />
        <TextField
          label="Receiver email"
          type="email"
          value={receiver}
          onChange={(e) => setReceiver(e.target.value)}
          disabled={sending}
          fullWidth
          margin="normal"
        />
        <TextField
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={sending}
          fullWidth
          margin="normal"
        />
        <TemplateDropdown
          disabled={sending}
          onSelect={(template) => {
            setBody(template?.html || "");
            setStyle(template?.css || "");
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={sending}>
          Close
        </Button>
        <Button onClick={send} variant="contained" disabled={checking || !ready || sending}>
          {sending ? "Sending..." : "Send Test"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
