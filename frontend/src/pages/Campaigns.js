import PageHeader from "../component/PageHeader";
import { Search, Plus, Mail, Megaphone } from "lucide-react";
import Grid from "@mui/material/GridLegacy";
import { API_URL, getErrorMessage, formatDate, statusLabel } from "../utilities/api";
import { downloadCampaignCsv } from "../utilities/downloads";
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Alert,
  AlertTitle,
  Paper,
  Tabs,
  Tab,
} from "@mui/material";
import axios from "axios";
import TemplateDropdown from "../component/TemplateDropdown";
import TestMailDialog from "../component/TestMailDialog";
import LinearProgress from "@mui/material/LinearProgress";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import dayjs from "dayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";

// Poll one campaign without overlapping requests or updating an unmounted component.
function CampaignProgress({ emailId }) {
  const [progress, setProgress] = React.useState(0);
  const [status, setStatus] = React.useState("Waiting...");

  React.useEffect(() => {
    let disposed = false;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const { data } = await axios.get(`${API_URL}/api/campaign/send-campaign-progress`, {
          params: { emailId },
        });
        if (!disposed) {
          setProgress(data.total ? Math.round((data.processed / data.total) * 100) : 0);
          setStatus(`${statusLabel(data.status)}: ${data.sent}/${data.total} accepted`);
        }
      } catch (error) {
        if (!disposed) setStatus("Unable to load progress");
      } finally {
        busy = false;
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [emailId]);

  return (
    <Box sx={{ width: "100%", mt: 1 }}>
      <LinearProgress variant="determinate" value={progress} />
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        {status}
      </Typography>
    </Box>
  );
}

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [error, setError] = useState("");
  const [mailReady, setMailReady] = useState(null);
  const [mailConfigurationMessage, setMailConfigurationMessage] = useState("");
  const pollBusy = useRef(false);
  const [listOptions, setListOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [selectedList, setSelectedList] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [style, setStyle] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [testOpen, setTestOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analyticsTab, setAnalyticsTab] = useState(0);
  const [dialogData, setDialogData] = useState([]);
  const [campaignSummary, setCampaignSummary] = useState(null);
  const [selectedEmailId, setSelectedEmailId] = useState(null);
  const [redirectUrl, setRedirectUrl] = useState("");
  const [scheduleTime, setScheduleTime] = useState(dayjs().add(5, "minute")); // Start with a future time so scheduling is valid.

  const BASE_URL = API_URL;

  // Load campaign summaries while keeping background refresh requests from overlapping.
  const fetchCampaigns = useCallback(async () => {
    if (pollBusy.current) return;
    pollBusy.current = true;
    try {
      const res = await axios.get(`${BASE_URL}/api/campaign/campaign-ids`, {
        headers: { "ngrok-skip-browser-warning": "true" },
      });
      const data = await Promise.all(
        res.data.map(async (id) => {
          const res2 = await axios.get(`${BASE_URL}/api/campaign/campaign-analytics`, {
            params: { emailId: id },
            headers: { "ngrok-skip-browser-warning": "true" },
          });
          return res2.data;
        })
      );
      setCampaigns(data);
      setError("");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      pollBusy.current = false;
    }
  }, [BASE_URL]);

  const fetchLists = useCallback(async () => {
    try {
      const res = await axios.get(`${BASE_URL}/api/campaign/contact-lists`, {
        headers: { "ngrok-skip-browser-warning": "true" },
      });
      setListOptions(Array.isArray(res.data) ? res.data.sort() : []);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [BASE_URL]);

  useEffect(() => {
    const controller = new AbortController();
    axios
      .get(API_URL + "/me", { signal: controller.signal })
      .then(({ data }) => {
        setMailReady(data.workspace.campaignConfigured ?? data.workspace.mailConfigured);
        setMailConfigurationMessage(data.workspace.mailConfigurationMessage || "");
      })
      .catch((err) => {
        if (err.code !== "ERR_CANCELED") setError(getErrorMessage(err));
      });
    return () => controller.abort();
  }, []);

  // Queue immediate delivery or submit the selected future time to the backend worker.
  const sendCampaign = async (sendNow = false) => {
    if (!mailReady) {
      setError("Email sending is not configured for this workspace.");
      return;
    }
    if (!campaignName || !subject || !body || !selectedList) {
      setError("Enter a campaign name, subject, template, and contact list.");
      return;
    }
    if (!sendNow && (!scheduleTime?.isValid() || !scheduleTime.isAfter(dayjs()))) {
      setError("Choose a future date and time to schedule this campaign.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setStatusText("Preparing campaign...");

      const { data } = await axios.post(
        `${BASE_URL}/api/campaign/send-campaign`,
        {
          emailId: campaignName,
          subject,
          body,
          style,
          listName: selectedList,
          redirectUrl,
          scheduleTime: !sendNow && scheduleTime ? scheduleTime.toISOString() : null,
        },
        { headers: { "ngrok-skip-browser-warning": "true" } }
      );

      setStatusText(data.message || "Campaign accepted for sending.");
      setLoading(false);
      setOpen(false);
      fetchCampaigns();
    } catch (err) {
      setLoading(false);
      setError(getErrorMessage(err));
    }
  };

  const openAnalytics = async (emailId) => {
    try {
      setSelectedEmailId(emailId);
      const [summaryRes, detailsRes] = await Promise.all([
        axios.get(`${BASE_URL}/api/campaign/campaign-analytics`, {
          params: { emailId },
          headers: { "ngrok-skip-browser-warning": "true" },
        }),
        axios.get(`${BASE_URL}/api/campaign/campaign-details`, {
          params: { emailId },
          headers: { "ngrok-skip-browser-warning": "true" },
        }),
      ]);
      setCampaignSummary(summaryRes.data);
      setDialogData(detailsRes.data);
      setAnalyticsTab(0);
      setAnalyticsOpen(true);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  useEffect(() => {
    const interval = setInterval(fetchCampaigns, 5000);
    fetchCampaigns();
    fetchLists();
    return () => clearInterval(interval);
  }, [fetchCampaigns, fetchLists]);

  useEffect(() => {
    if (!analyticsOpen || !selectedEmailId) return;

    const fetchDetails = async () => {
      try {
        const [summaryRes, detailsRes] = await Promise.all([
          axios.get(`${BASE_URL}/api/campaign/campaign-analytics`, {
            params: { emailId: selectedEmailId },
            headers: { "ngrok-skip-browser-warning": "true" },
          }),
          axios.get(`${BASE_URL}/api/campaign/campaign-details`, {
            params: { emailId: selectedEmailId },
            headers: { "ngrok-skip-browser-warning": "true" },
          }),
        ]);
        setCampaignSummary(summaryRes.data);
        setDialogData(detailsRes.data);
      } catch (err) {
        setError(getErrorMessage(err));
      }
    };

    fetchDetails(); // initial load
    const interval = setInterval(fetchDetails, 5000); // update every 5 seconds

    return () => clearInterval(interval); // clean up
  }, [analyticsOpen, selectedEmailId, BASE_URL]);

  return (
    <Box className="page">
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {mailReady === false && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {mailConfigurationMessage || "Email sending is not configured for this workspace."}
        </Alert>
      )}
      {statusText && !open && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {statusText}
        </Alert>
      )}
      <PageHeader title="Email campaigns" section="Marketing" description="Create meaningful messages. Keep an eye on every send." actions={<><Button variant="outlined" startIcon={<Mail size={16} />} onClick={() => setTestOpen(true)}>Send Test Mail</Button><Button variant="contained" startIcon={<Plus size={17} />} onClick={() => setOpen(true)}>Create Campaign</Button></>} />

      {loading && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <AlertTitle>Sending...</AlertTitle>
          {statusText}
        </Alert>
      )}

      <TestMailDialog open={testOpen} onClose={() => setTestOpen(false)} />

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth>
        <DialogTitle>Create New Campaign</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error">{error}</Alert>}
          <p className="field-hint">Set up your audience and content, then send now or choose a time.</p>
          <h3 className="form-section-title"><span>1</span>Campaign &amp; audience</h3>
          <TextField
            fullWidth
            label="Campaign Name"
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            margin="normal"
          />
          <FormControl fullWidth margin="normal">
            <InputLabel id="receiver-list-label">Receiver List</InputLabel>
            <Select
              labelId="receiver-list-label"
              label="Receiver List"
              value={selectedList}
              onChange={(e) => setSelectedList(e.target.value)}
            >
              {listOptions.map((name) => (
                <MenuItem key={name} value={name}>
                  {name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <h3 className="form-section-title"><span>2</span>Message details</h3>
          <TextField
            fullWidth
            label="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            margin="normal"
          />
          <TextField
            fullWidth
            label="Redirect URL"
            value={redirectUrl}
            onChange={(e) => setRedirectUrl(e.target.value)}
            margin="normal"
          />

          <div className="template-field"><p className="field-hint">Email template</p>
            <TemplateDropdown
              onSelect={(template) => {
                setBody(template?.html || "");
                setStyle(template?.css || "");
              }}
            />
          </div>

          <h3 className="form-section-title"><span>3</span>Delivery</h3>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <FormControl fullWidth margin="normal">
              <DateTimePicker
                label="Schedule Time"
                value={scheduleTime}
                onChange={(newValue) => setScheduleTime(newValue)}
                slotProps={{ textField: { fullWidth: true } }}
              />
            </FormControl>
          </LocalizationProvider>


        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>

          {/* Send Now (force immediate send) */}
          <Button
            variant="contained"
            color="success"
            onClick={() => {
              setScheduleTime(null); // override scheduling
              sendCampaign(true);
            }}
            disabled={loading || mailReady !== true}
          >
            Send Now
          </Button>

          {/* Schedule (respects selected date/time) */}
          <Button variant="contained" onClick={() => sendCampaign(false)} disabled={loading || mailReady !== true}>
            Schedule
          </Button>
        </DialogActions>
      </Dialog>

      <div className="toolbar"><label className="search-control"><Search size={17} /><input aria-label="Search campaigns" placeholder="Search campaigns..." value={campaignSearch} onChange={event => setCampaignSearch(event.target.value)} /></label><span className="toolbar-meta">{campaigns.length} {campaigns.length === 1 ? "campaign" : "campaigns"}</span></div>
      {campaigns.length === 0 ? <div className="empty-state"><Megaphone size={34} /><h3>Your next connection starts here</h3><p>Create your first campaign, choose a contact list, and make it yours.</p></div> :
        <div className="surface" style={{ overflowX: "auto" }}><Table className="campaign-table" aria-label="Email campaigns"><TableHead><TableRow><TableCell>Campaign</TableCell><TableCell>Status</TableCell><TableCell align="right">Accepted</TableCell><TableCell align="right">Delivered</TableCell><TableCell align="right">Opens</TableCell><TableCell align="right">Clicks</TableCell><TableCell align="right">Bounces</TableCell><TableCell align="right">Report</TableCell></TableRow></TableHead><TableBody>
        {[...campaigns].reverse().filter(campaign => campaign.emailId.toLowerCase().includes(campaignSearch.toLowerCase())).map(campaign => <TableRow key={campaign.emailId}>
          <TableCell><span className="campaign-name">{campaign.emailId}</span><span className="campaign-date">Created {formatDate(campaign.lastActivity)}</span></TableCell>
          <TableCell><span className={"status-badge status-" + campaign.status}>{statusLabel(campaign.status)}</span><div className="campaign-progress"><CampaignProgress emailId={campaign.emailId} /></div></TableCell>
          <TableCell align="right"><span className="metric-value">{campaign.totalSent ?? 0}</span></TableCell>
          <TableCell align="right">{campaign.deliveredCount ?? 0}</TableCell>
          <TableCell align="right">{campaign.totalOpens ?? 0}</TableCell><TableCell align="right">{campaign.totalClicks ?? 0}</TableCell>
          <TableCell align="right">{(campaign.hardBounceCount || 0) + (campaign.softBounceCount || 0)}</TableCell>
          <TableCell align="right"><Button variant="outlined" size="small" onClick={() => openAnalytics(campaign.emailId)}>View Details</Button></TableCell>
        </TableRow>)}
        {!campaigns.some(campaign => campaign.emailId.toLowerCase().includes(campaignSearch.toLowerCase())) && <TableRow><TableCell colSpan={8}>No campaigns match your search.</TableCell></TableRow>}
        </TableBody></Table></div>}

      <Dialog open={analyticsOpen} onClose={() => setAnalyticsOpen(false)} fullWidth maxWidth="xl">
        <DialogTitle>Campaign Analytics</DialogTitle>
        <DialogContent>
          <Tabs value={analyticsTab} onChange={(_, value) => setAnalyticsTab(value)} variant="scrollable" scrollButtons="auto" aria-label="Campaign analytics tabs" sx={{ mb: 3 }}>
            {['Overview', 'Deliverability', 'Opens', 'Clicks', 'Unsubscribes', 'Contact details'].map((label, index) => (
              <Tab key={label} label={label} id={'analytics-tab-' + index} aria-controls={'analytics-panel-' + index} />
            ))}
          </Tabs>
          <Box role="tabpanel" id={'analytics-panel-' + analyticsTab} aria-labelledby={'analytics-tab-' + analyticsTab}>
          {campaignSummary && analyticsTab < 5 && (
            <Box mb={3}>
              <Grid container spacing={2}>
                {Object.entries((() => {
                  const c = campaignSummary;
                  const percent = (value) => (Number(value) || 0).toFixed(2) + '%';
                  const delivery = { Delivered: c.deliveredCount, 'Delivery rate': percent(c.deliveryRate) };
                  const opens = { Opens: c.uniqueOpens, 'Open rate': percent(c.openRate), 'Total opens': c.totalOpens };
                  const clicks = { Clicks: c.uniqueClicks, 'Click rate': percent(c.clickRate), 'Total clicks': c.totalClicks };
                  const unsubscribe = { Unsubscribed: c.unsubscribeCount, 'Unsubscribe rate': percent(c.unsubscribeRate) };
                  return [
                    { Campaign: c.emailId, Status: statusLabel(c.status), Subject: c.subject || 'N/A',
                      Sender: [c.senderName, c.senderEmail].filter(Boolean).join(' · ') || 'N/A',
                      'Contact list': c.listName || 'N/A', 'Total recipients': c.totalRecipients,
                      Created: formatDate(c.createdAt || c.lastActivity), Scheduled: formatDate(c.scheduleTime), Completed: formatDate(c.completedAt),
                      'Sent to': c.totalSent, ...delivery, ...opens, ...clicks, ...unsubscribe },
                    { 'Sent to': c.totalSent, 'Accepted by provider': c.totalSent, Attempted: c.attemptedCount,
                      Processed: c.processedCount, ...delivery, 'Soft bounce': c.softBounceCount, 'Hard bounce': c.hardBounceCount,
                      'Bounce rate': percent(c.bounceRate), 'Deferred (current)': c.deferredCount, Dropped: c.droppedCount,
                      'Spam reports': c.spamReportCount, Blocked: c.blockedCount, 'Permanent message blocks': c.permanentBlockCount,
                      'Unclassified failures': c.unclassifiedBounceCount, 'Ever deferred': c.everDeferredCount,
                      'Ever soft bounced': c.everSoftBounceCount },
                    { ...opens, 'Privacy proxy opens': c.machineOpenCount }, clicks, unsubscribe
                  ][analyticsTab];
                })()).map(([label, value]) => (
                  <Grid item xs={12} sm={6} md={3} key={label}>
                    <Paper variant="outlined" sx={{ p: 2, height: '100%', overflowWrap: 'anywhere' }}>
                      <Typography variant="body2" color="text.secondary">{label}</Typography>
                      <Typography variant="h6">{value ?? 0}</Typography>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
                Sent to counts emails accepted by the provider. All rates use this count as the denominator.
                Opens and clicks count unique recipients; total opens and total clicks include repeat activity.
              </Typography>
            </Box>
          )}
          <Alert severity="info" sx={{ mb: 2 }}>
            Opens can include privacy proxies and automated scans. Accepted means the provider accepted the request;
            delivered means the recipient server accepted the email. Completed means campaign submissions finished.
            Deferred and soft bounce counts show current outcomes; historical counts include recovered deliveries.
            Location is approximate network information and may belong to a proxy or scanner. Device/browser/OS are inferred from available user-agent data.
            Complaints and opt-outs can overlap delivery; do not add them to final delivery outcomes.
          </Alert>
          {analyticsTab === 5 && <Box maxHeight="500px" overflow="auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Campaign</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Last activity</TableCell>
                  <TableCell>Delivery status</TableCell>
                  <TableCell>Notes</TableCell>
                  <TableCell>Bounced</TableCell>
                  <TableCell>IP</TableCell>
                  <TableCell>City</TableCell>
                  <TableCell>Region</TableCell>
                  <TableCell>Country</TableCell>
                  <TableCell>ISP / organization</TableCell>
                  <TableCell>ASN</TableCell>
                  <TableCell>Traffic / location status</TableCell>
                  <TableCell>User-Agent</TableCell>
                  <TableCell>Device</TableCell>
                  <TableCell>Browser</TableCell>
                  <TableCell>OS</TableCell>
                  <TableCell>Click count</TableCell>
                  <TableCell>Open count</TableCell>
                  <TableCell>Send At</TableCell>
                  <TableCell>Last Open</TableCell>
                  <TableCell>Processed At</TableCell>
                  <TableCell>Clicked URL</TableCell>
                  <TableCell>Campaign ID</TableCell>
                  <TableCell>Last Click</TableCell>
                  <TableCell>Unsubscribed</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {dialogData.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell>{row.emailId}</TableCell>
                    <TableCell>{row.recipientId || row.recipient}</TableCell>
                    <TableCell>{formatDate([row.sendAt, row.processedAt, row.lastDeliveryEventAt, row.lastOpen, row.lastClick, row.lastEngagementAt].filter(value => value && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(b) - Date.parse(a))[0])}</TableCell>
                    <TableCell>{statusLabel(row.deliveryStatus || row.status)}</TableCell>
                    <TableCell>{[row.deliveryReason, row.smtpStatus, row.error].filter(Boolean).join(" · ") || "?"}</TableCell>

                    <TableCell
                      sx={{
                        color:
                          row.bounceStatus === "hard"
                            ? "red"
                            : row.bounceStatus === "soft"
                              ? "orange"
                              : row.bounceStatus === "no"
                                ? "green"
                                : row.bounceStatus === "dnd"
                                  ? "blue"
                                  : "grey",
                        fontWeight: "bold",
                      }}
                    >
                      {row.bounceStatus
                        ? row.bounceStatus.charAt(0).toUpperCase() + row.bounceStatus.slice(1) // pretty-print
                        : "NA"}
                    </TableCell>

                    <TableCell>{row.ip}</TableCell>
                    <TableCell>{row.city}</TableCell>
                    <TableCell>{row.region}</TableCell>
                    <TableCell>{row.country}</TableCell>
                    <TableCell>{row.organization || "N/A"}</TableCell>
                    <TableCell>{row.asn || "N/A"}</TableCell>
                    <TableCell>{row.trafficType || "unknown"} / {row.geoStatus || "not_provided"}</TableCell>
                    <TableCell sx={{ maxWidth: 260, overflowWrap: "anywhere" }}>{row.userAgent || "N/A"}</TableCell>
                    <TableCell>{row.device}</TableCell>
                    <TableCell>{row.browser}</TableCell>
                    <TableCell>{row.os}</TableCell>
                    <TableCell>{row.totalClick}</TableCell>
                    <TableCell>{row.totalOpen}</TableCell>
                    <TableCell>{formatDate(row.sendAt)}</TableCell>
                    <TableCell>{formatDate(row.lastOpen)}</TableCell>
                    <TableCell>{formatDate(row.processedAt)}</TableCell>
                    <TableCell sx={{ maxWidth: 260, overflowWrap: "anywhere" }}>{row.clickedUrl || "N/A"}</TableCell>
                    <TableCell>{row.campaignId || "N/A"}</TableCell>
                    <TableCell>{formatDate(row.lastClick)}</TableCell>
                    <TableCell
                      sx={{
                        color: row.unsubscribe ? "red" : "green",
                        fontWeight: "bold",
                      }}
                    >
                      {row.unsubscribe ? "Yes" : "No"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnalyticsOpen(false)}>Close</Button>

          <Button
            variant="contained"
            disabled={!campaignSummary}
            onClick={async () => {
              try {
                await downloadCampaignCsv(campaignSummary.emailId);
              } catch (error) {
                setError(getErrorMessage(error));
              }
            }}
          >
            Download CSV
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
