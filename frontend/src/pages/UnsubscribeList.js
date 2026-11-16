import React from "react";
import SuppressionList from "../component/SuppressionList";

export default function UnsubscribeList() {
  return <SuppressionList endpoint="/api/unsubscribelist" title="Unsubscribe list" />;
}
