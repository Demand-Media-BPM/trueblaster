import { previewDocument, publicImageUrl, STARTER_TEMPLATES } from "../utilities/templateContent";

test("preview substitutes only sample fields and preserves unknown personalisation", () => {
  const document = previewDocument("Hello {{firstName}} at {{ companyName }} {{customField}}", "p { color: red; }");
  expect(document).toContain("Hello Rahul at Example Ltd {{customField}}");
  expect(document).toContain("script-src 'none'");
  expect(document).toContain("p { color: red; }");
  expect(previewDocument("{{firstName}}", "", false)).toContain("{{firstName}}");
});

test("image URLs accept HTTP images and reject executable, embedded, or credential-bearing URLs", () => {
  expect(publicImageUrl("https://example.com/photo.png")).toBe("https://example.com/photo.png");
  for (const value of [["java", "script:alert(1)"].join(""), "data:image/svg+xml,bad", "/local.png", "https://user:password@example.com/image.png"]) expect(publicImageUrl(value)).toBeNull();
});

test("every starter includes editable email content and an unsubscribe placeholder", () => {
  expect(STARTER_TEMPLATES).toHaveLength(4);
  for (const starter of STARTER_TEMPLATES) {
    expect(starter.html).toContain("{{unsubscribeUrl}}");
    expect(starter.html).toContain("data-email-content");
    expect(starter.css).toContain("max-width: 600px");
  }
});
