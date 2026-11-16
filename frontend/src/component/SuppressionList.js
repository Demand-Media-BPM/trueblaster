import PageHeader from "./PageHeader";
import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Box,
  Button,
  TextField,
  Alert,
  CircularProgress,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
} from "@mui/material";
import { API_URL, getErrorMessage, formatDate } from "../utilities/api";
const fields = {
  FirstName: "First name",
  LastName: "Last name",
  Email: "Email",
  ContactNo: "Contact number",
  JobTitle: "Job title",
  CompanyName: "Company",
  CampaignId: "Campaign",
  LinkedinLink: "LinkedIn",
};
const empty = () => Object.fromEntries(Object.keys(fields).map((key) => [key, ""]));

// Share search and removal behavior between blocked and unsubscribed contacts.
export default function SuppressionList({ endpoint, title, allowAdd = false }) {
  const [contacts, setContacts] = useState([]),
    [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [open, setOpen] = useState(false),
    [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        setLoading(true);
        setError("");
        try {
          const { data } = await axios.get(
            API_URL + endpoint + (search.trim() ? "/search" : "/list"),
            { params: search.trim() ? { email: search.trim() } : {}, signal: controller.signal }
          );
          setContacts(Array.isArray(data) ? data : []);
        } catch (err) {
          if (err.code !== "ERR_CANCELED") setError(getErrorMessage(err));
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      },
      search ? 250 : 0
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, search, reload]);
  const add = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await axios.post(API_URL + endpoint + "/upload", form);
      setOpen(false);
      setForm(empty());
      setReload((v) => v + 1);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id) => {
    setBusy(true);
    setError("");
    try {
      await axios.delete(API_URL + endpoint + "/remove/" + encodeURIComponent(id));
      setReload((v) => v + 1);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box className="page">
      <PageHeader title={title} section="Audience" description={allowAdd ? "Manage contacts you have excluded from campaign sends." : "Respect your audience’s preferences. These contacts are excluded from future campaigns."} />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Box className="toolbar">
        <TextField
          label="Search by email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {allowAdd && (
          <Button
            onClick={() => {
              setError("");
              setOpen(true);
            }}
            variant="contained"
          >
            Add blocked contact
          </Button>
        )}
      </Box>
      <p className="field-hint">{allowAdd ? "Removing a manual block does not remove an existing unsubscribe or bounce restriction." : "Only remove an unsubscribe when the contact has explicitly opted back in."}</p>
      {search.trim() && <Typography sx={{ mb: 1 }}>Showing up to 5 matching contacts.</Typography>}
      {loading ? (
        <CircularProgress aria-label="Loading contacts" />
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {[
                  "First name",
                  "Last name",
                  "Email",
                  "Contact number",
                  "Job title",
                  "Company",
                  "Campaign",
                  "LinkedIn",
                  "Added on",
                  "Action",
                ].map((label) => (
                  <TableCell key={label}>{label}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {!contacts.length && (
                <TableRow>
                  <TableCell colSpan={10}>No contacts found.</TableCell>
                </TableRow>
              )}
              {contacts.map((contact) => (
                <TableRow key={contact._id}>
                  {[
                    contact.FirstName,
                    contact.LastName,
                    contact.Email,
                    contact.ContactNo,
                    contact.JobTitle,
                    contact.CompanyName,
                    contact.CampaignName || contact.CampaignId,
                    contact.LinkedIn || contact.LinkedinLink,
                    formatDate(contact.UnsubscribeOn || contact.createdAt),
                  ].map((value, index) => (
                    <TableCell key={index}>{value || "—"}</TableCell>
                  ))}
                  <TableCell>
                    <Button disabled={busy} onClick={() => remove(contact._id)}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Dialog open={open} onClose={busy ? undefined : () => setOpen(false)} fullWidth>
        <form onSubmit={add}>
          <DialogTitle>Add blocked contact</DialogTitle>
          <DialogContent>
            {error && <Alert severity="error">{error}</Alert>}
            {Object.entries(fields).map(([key, label]) => (
              <TextField
                key={key}
                label={label}
                type={key === "Email" ? "email" : "text"}
                required={key === "Email"}
                value={form[key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                fullWidth
                margin="normal"
                disabled={busy}
              />
            ))}
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} type="submit" variant="contained">
              {busy ? "Saving..." : "Save"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
