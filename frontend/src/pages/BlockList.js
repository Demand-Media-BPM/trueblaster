import React from "react";
import SuppressionList from "../component/SuppressionList";

export default function BlockList() {
  return <SuppressionList endpoint="/api/blocklist" title="Blocklist" allowAdd />;
}
