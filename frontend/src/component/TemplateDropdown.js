import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_URL, getErrorMessage } from "../utilities/api";
const TemplateDropdown = ({ onSelect, disabled = false }) => {
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    axios
      .get(API_URL + "/api/preview", { signal: controller.signal })
      .then(({ data }) => setTemplates(Array.isArray(data) ? data : []))
      .catch((err) => {
        if (err.code !== "ERR_CANCELED") setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  return (
    <>
      <select
        className="template-select"
        aria-label="Email template"
        disabled={disabled || loading}
        defaultValue=""
        onChange={(e) => onSelect(templates.find((t) => t._id === e.target.value))}
      >
        <option value="">{loading ? "Loading templates..." : "Select Template"}</option>
        {templates.map((t) => (
          <option key={t._id} value={t._id}>
            {t.name}
          </option>
        ))}
      </select>
      {error && <p role="alert">{error}</p>}
    </>
  );
};
export default TemplateDropdown;
