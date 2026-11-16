import { createTheme } from "@mui/material/styles";

// Shared component styling keeps every page and dialog visually consistent.
const theme = createTheme({
  palette: {
    primary: { main: "#24342e", contrastText: "#ffffff" },
    secondary: { main: "#087f5b" },
    success: { main: "#087f5b" },
    error: { main: "#b63b40" },
    background: { default: "#f7f8f5", paper: "#ffffff" },
    text: { primary: "#24342e", secondary: "#66736b" },
    divider: "#e4e8e1",
  },
  typography: {
    fontFamily: '"Segoe UI", Inter, Arial, sans-serif',
    fontSize: 14,
    h4: { fontSize: "1.9rem", fontWeight: 650, letterSpacing: "-0.8px" },
    h5: { fontSize: "1.2rem", fontWeight: 650 },
    h6: { fontWeight: 650 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: {
      root: { borderRadius: 7, minHeight: 40, padding: "8px 18px", boxShadow: "none" },
      outlined: { borderColor: "#cdd5ce", backgroundColor: "#fff" },
      sizeSmall: { minHeight: 32, padding: "4px 11px" },
    } },
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: {
      root: { backgroundImage: "none" }, outlined: { borderColor: "#e4e8e1" },
    } },
    MuiTableContainer: { styleOverrides: { root: { border: "1px solid #e4e8e1", borderRadius: 10 } } },
    MuiTableCell: { styleOverrides: {
      root: { borderBottomColor: "#edf0ea", padding: "17px 18px", fontSize: 13 },
      head: { backgroundColor: "#f8faf7", color: "#69756c", fontWeight: 600, whiteSpace: "nowrap", fontSize: 12 },
    } },
    MuiTableRow: { styleOverrides: { root: { "&:last-child td": { borderBottom: 0 }, "&:hover td": { backgroundColor: "#fafcf9" } } } },
    MuiOutlinedInput: { styleOverrides: { root: { backgroundColor: "#fff", borderRadius: 7 }, notchedOutline: { borderColor: "#d7ddd5" } } },
    MuiTextField: { defaultProps: { size: "small" } },
    MuiFormControl: { defaultProps: { size: "small" } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 14, boxShadow: "0 20px 80px #192c2830" } } },
    MuiDialogTitle: { styleOverrides: { root: { fontSize: 21, fontWeight: 650, padding: "25px 26px 16px" } } },
    MuiDialogContent: { styleOverrides: { root: { padding: "12px 26px 24px" } } },
    MuiDialogActions: { styleOverrides: { root: { borderTop: "1px solid #e4e8e1", padding: "17px 26px", gap: 6, flexWrap: "wrap" } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 8, fontSize: 13 }, standardInfo: { backgroundColor: "#eef4f5", color: "#385960" } } },
    MuiLinearProgress: { styleOverrides: { root: { height: 5, borderRadius: 4, backgroundColor: "#e7ede6" }, bar: { backgroundColor: "#23a577" } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 5, fontWeight: 600 } } },
  },
});

export default theme;
