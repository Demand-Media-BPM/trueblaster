import PageHeader from "../component/PageHeader";
import { Upload, Download } from "lucide-react";
import { API_URL, getErrorMessage, formatDate } from "../utilities/api";
// contact.js
import React, { useEffect, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  CircularProgress,
  Alert,
  InputAdornment,
} from "@mui/material";
import { Delete, Close } from "@mui/icons-material";
import axios from "axios";

const BASE_URL = API_URL;

export default function Contact() {
  const [open, setOpen] = useState(false);
  const [listName, setListName] = useState("");
  const [file, setFile] = useState(null);
  const [lists, setLists] = useState([]);
  const [filteredLists, setFilteredLists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [viewData, setViewData] = useState([]);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewTitle, setViewTitle] = useState("");
  const [search, setSearch] = useState("");

  const fetchLists = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      const { data } = await axios.get(BASE_URL + "/api/contact/lists", { signal });
      setLists(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err.code !== "ERR_CANCELED") setError(getErrorMessage(err));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetchLists(controller.signal);
    return () => controller.abort();
  }, [fetchLists]);

  // search filter logic
  useEffect(() => {
    if (search.trim() === "") {
      setFilteredLists(lists);
    } else {
      const filtered = lists.filter((list) =>
        list.listName.toLowerCase().includes(search.toLowerCase())
      );
      setFilteredLists(filtered);
    }
  }, [search, lists]);

  const downloadTemplate = () => {
    const data = [
      {
        FirstName: "",
        LastName: "",
        Email: "",
        ContactNo: "",
        JobTitle: "",
        CompanyName: "",
        LinkdinLink: "",
      },
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contacts_Template");
    XLSX.writeFile(wb, "contact_template.xlsx");
  };

  // Validate the upload locally, then let the backend normalize and store its contacts.
  const handleSubmit = async () => {
    if (!listName.trim() || !file) {
      setError("Enter a list name and choose a contact file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Choose a file smaller than 10 MB.");
      return;
    }
    setUploading(true);
    setError("");
    const formData = new FormData();
    formData.append("listName", listName.trim());
    formData.append("file", file);
    try {
      await axios.post(`${BASE_URL}/api/contact/upload-contact`, formData, {
        headers: { "ngrok-skip-browser-warning": "true" },
      });
      await fetchLists();
      setOpen(false);
      setListName("");
      setFile(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (list) => {
    if (!window.confirm("Delete this contact list?")) return;
    try {
      await axios.delete(BASE_URL + "/api/contact/delete-list", { data: { listName: list } });
      await fetchLists();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleView = async (list) => {
    try {
      const res = await axios.get(`${BASE_URL}/api/contact/view-list-data`, {
        params: { listName: list },
        headers: { "ngrok-skip-browser-warning": "true" },
      });
      setViewTitle(list);
      setViewData(res.data);
      setViewDialogOpen(true);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <Box className="page">
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <PageHeader title="Contact lists" section="Audience" description="Organise your audience into lists and choose who hears from you." actions={<><Button variant="outlined" startIcon={<Download size={16} />} onClick={downloadTemplate}>Download template</Button><Button variant="contained" startIcon={<Upload size={16} />} onClick={() => setOpen(true)}>Import contacts</Button></>} />
      {/* search box */}
      <TextField
        placeholder="Search contact lists..."
        inputProps={{ "aria-label": "Search contact lists" }}
        variant="outlined"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        fullWidth
        sx={{
          mb: 3,
          borderRadius: "30px",
          backgroundColor: "#f9f9f9",
        }}
        InputProps={{
          endAdornment: search && (
            <InputAdornment position="end">
              <IconButton aria-label="Clear contact list search" onClick={() => setSearch("")}>
                <Close />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />

      {/* dialog for creating new list */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth>
        <DialogTitle>Import contacts</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error">{error}</Alert>}
          <p className="field-hint">Upload a CSV or Excel file up to 10 MB. Use the template to match your columns.</p>
          <TextField
            label="List Name"
            fullWidth
            margin="normal"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
          />
          <Button component="label" variant="outlined" fullWidth sx={{ my: 2 }}>
            {file ? file.name : "Choose CSV or Excel file"}
            <input
              type="file"
              hidden
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setFile(e.target.files[0])}
            />
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} variant="contained" disabled={uploading}>
            {uploading ? "Importing..." : "Import contacts"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* dialog for view data */}
      <Dialog
        open={viewDialogOpen}
        onClose={() => setViewDialogOpen(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>List Name: {viewTitle}</DialogTitle>
        <Typography sx={{ px: 3 }}>Preview shows up to 100 contacts.</Typography>
        <DialogContent dividers>
          {viewData.length === 0 ? (
            <Typography>No data found</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Sr. No.</TableCell>
                  <TableCell>FirstName</TableCell>
                  <TableCell>LastName</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>ContactNo</TableCell>
                  <TableCell>JobTitle</TableCell>
                  <TableCell>CompanyName</TableCell>
                  <TableCell>LinkdinLink</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {viewData.map((row, index) => (
                  <TableRow key={index}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>{row.FirstName || "-"}</TableCell>
                    <TableCell>{row.LastName || "-"}</TableCell>
                    <TableCell>{row.Email || "-"}</TableCell>
                    <TableCell>{row.ContactNo || "-"}</TableCell>
                    <TableCell>{row.JobTitle || "-"}</TableCell>
                    <TableCell>{row.CompanyName || "-"}</TableCell>
                    <TableCell>{row.LinkdinLink || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* table for lists */}
      <Box mt={3}>
        {loading ? (
          <CircularProgress />
        ) : filteredLists.length === 0 ? (
          <Typography color="textSecondary" align="center">
            {search ? "No lists match your search." : "Your audience starts here. Import a contact list to get started."}
          </Typography>
        ) : (
          <TableContainer
            component={Paper}
            sx={{
              maxHeight: 400, // adjust height as needed
              overflowY: "auto",
            }}
          >
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>List Name</TableCell>
                  <TableCell>No. of Contacts</TableCell>
                  <TableCell>Created At</TableCell>
                  <TableCell>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredLists.map((row, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{row.listName}</TableCell>
                    <TableCell>{row.count}</TableCell>
                    <TableCell>{formatDate(row.createdAt)}</TableCell>
                    <TableCell>
                      <Box display="flex" gap={1}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => handleView(row.listName)}
                        >
                          View contacts
                        </Button>
                        <IconButton aria-label={"Delete " + row.listName} color="error" onClick={() => handleDelete(row.listName)}>
                          <Delete />
                        </IconButton>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
    </Box>
  );
}
