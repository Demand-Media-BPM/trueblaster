// Keep starter content and preview-only data separate from saved customer content.
export const PERSONALISATION_FIELDS = [
  { key: "firstName", label: "First name", sample: "Rahul" },
  { key: "lastName", label: "Last name", sample: "Sharma" },
  { key: "email", label: "Email address", sample: "rahul@example.com" },
  { key: "companyName", label: "Company name", sample: "Example Ltd" },
];

const emailCss = `
  body { margin: 0; background-color: #f3f5f0; font-family: Arial, sans-serif; color: #24342e; }
  table { border-collapse: collapse; }
  img { max-width: 100%; height: auto; }
  .email-container { width: 100%; max-width: 600px; margin: 0 auto; background: #ffffff; }
  .email-content { padding: 36px; }
  .email-content h1 { font-size: 30px; line-height: 1.25; margin: 0 0 20px; }
  .email-content p { font-size: 16px; line-height: 1.7; margin: 0 0 20px; }
  .email-button { display: inline-block; padding: 14px 24px; background-color: #24342e; color: #ffffff; text-decoration: none; border-radius: 5px; }
  @media (max-width: 480px) { .email-content { padding: 24px !important; } }
`;

function layout(content) {
  return `<table role="presentation" width="100%"><tbody><tr><td style="padding:24px 12px"><table role="presentation" class="email-container" align="center" width="600"><tbody><tr><td class="email-content" data-email-content="true">${content}</td></tr><tr><td style="padding:24px 36px;color:#7c8774;font-size:12px;line-height:1.6"><p>Your company · Your postal address</p><a href="{{unsubscribeUrl}}" style="color:#536b56">Unsubscribe</a></td></tr></tbody></table></td></tr></tbody></table>`;
}

export const STARTER_TEMPLATES = [
  {
    id: "blank",
    name: "Simple start",
    description: "A clean canvas with text and a footer.",
    html: layout("<h1>Your message starts here</h1><p>Hello {{firstName}},</p><p>Write something worth opening.</p>"),
    css: emailCss,
  },
  {
    id: "welcome",
    name: "Welcome email",
    description: "Introduce your brand and say hello.",
    html: layout('<p style="color:#087f5b;font-size:12px;letter-spacing:2px">A NEW CONNECTION</p><h1>Welcome, {{firstName}}.</h1><p>We’re glad you’re here. Here’s a little introduction to what we do and what you can expect from us.</p><p>Make yourself at home.</p><p><a class="email-button" href="https://example.com">Discover more</a></p>'),
    css: emailCss,
  },
  {
    id: "newsletter",
    name: "Newsletter",
    description: "Share your latest news and useful updates.",
    html: layout('<p style="color:#087f5b;font-size:12px;letter-spacing:2px">THE MONTHLY EDIT</p><h1>A few things worth sharing.</h1><p>Hello {{firstName}}, here’s what’s new this month.</p><hr style="border:0;border-top:1px solid #e4e8e1;margin:24px 0"><h2>What’s happening</h2><p>Add your main story here. Keep it helpful, personal, and easy to read.</p><h2>Something to explore</h2><p>Share a tip, an update, or a useful resource for your audience.</p><p><a class="email-button" href="https://example.com">Read the full story</a></p>'),
    css: emailCss,
  },
  {
    id: "announcement",
    name: "Announcement",
    description: "Put one important update in the spotlight.",
    html: layout('<p style="color:#087f5b;font-size:12px;letter-spacing:2px">SOMETHING NEW</p><h1>We have news for you.</h1><p>Hello {{firstName}},</p><p>Introduce your announcement here. Explain what’s changing and why it matters to your audience.</p><p><a class="email-button" href="https://example.com">Take a look</a></p>'),
    css: emailCss,
  },
];

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function previewDocument(html, css, useSamples = true) {
  const values = Object.fromEntries(PERSONALISATION_FIELDS.map(field => [field.key, field.sample]));
  const content = useSamples
    ? html.replace(/{{\s*(\w+)\s*}}/g, (token, key) => values[key] ? escapeHtml(values[key]) : token)
    : html;

  // The sandbox and policy keep template scripts, forms, and navigation inactive.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https: http:; font-src https: http: data:; script-src 'none'; form-action 'none'; base-uri 'none'"><style>${css}
a, button, input, select, textarea { pointer-events: none !important; }</style></head><body>${content}</body></html>`;
}

export function publicImageUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
