// Wraps the curated HTML body in the styled dark-theme email shell.
// Ported from the original compoase_email.js n8n node.

import { config } from "../config.js";

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500&family=Inter:wght@300;400;500&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #0d1117;
    font-family: 'Inter', sans-serif;
    color: #c8c0b0;
  }

  .wrap {
    max-width: 680px;
    margin: 0 auto;
    background: #0d1117;
    padding: 0 0 40px;
  }

  .head {
    padding: 52px 48px 44px;
    border-bottom: 1px solid #1e2530;
  }

  .head-vol {
    font-size: 10px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #c9a84c;
    margin-bottom: 18px;
    font-weight: 400;
  }

  .head-title {
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 48px;
    font-weight: 400;
    color: #e8e0d0;
    line-height: 1;
    letter-spacing: -0.5px;
  }

  .head-date {
    font-size: 12px;
    color: #5a6070;
    letter-spacing: 1px;
    margin-top: 14px;
    font-weight: 300;
  }

  .body {
    padding: 0 48px 48px;
  }

  h2 {
    font-size: 10px !important;
    letter-spacing: 3px !important;
    text-transform: uppercase !important;
    color: #c9a84c !important;
    font-weight: 500 !important;
    font-family: 'Inter', sans-serif !important;
    display: flex !important;
    align-items: center !important;
    gap: 10px !important;
    margin: 36px 0 22px !important;
    padding: 36px 0 0 !important;
    border-top: 1px solid #1a2030 !important;
    border-bottom: none !important;
  }

  h2::before {
    content: '';
    display: block;
    width: 2px;
    height: 14px;
    background: #c9a84c;
    border-radius: 1px;
    flex-shrink: 0;
  }

  ul {
    list-style: none !important;
    padding: 0 !important;
    margin: 0 !important;
  }

  li {
    margin-bottom: 26px !important;
    padding-bottom: 26px !important;
    border-bottom: 1px solid #151c28 !important;
  }

  li:last-child {
    border-bottom: none !important;
    margin-bottom: 0 !important;
    padding-bottom: 0 !important;
  }

  a {
    font-size: 15px !important;
    font-weight: 500 !important;
    color: #ddd5c5 !important;
    text-decoration: none !important;
    line-height: 1.4 !important;
  }

  a:hover { color: #e8e0d0 !important; }

  p {
    font-size: 13px !important;
    color: #4e5a6a !important;
    margin-top: 5px !important;
    line-height: 1.6 !important;
    font-weight: 300 !important;
    font-family: 'Inter', sans-serif !important;
  }

  img {
    border-radius: 3px !important;
    max-width: 100% !important;
    display: block !important;
  }

  .foot {
    padding: 24px 48px;
    border-top: 1px solid #1a2030;
    font-size: 10px;
    color: #2e3a4a;
    letter-spacing: 2px;
    text-transform: uppercase;
  }
`;

export function composeEmail(contentHtml, bannerDataUri = null) {
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${styles}</style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <div class="head-vol">${date}</div>
      <div class="head-title">${config.email.title}</div>
      <div class="head-date">${config.email.subtitle}</div>
    </div>
    ${bannerDataUri ? `<img src="${bannerDataUri}" alt="" style="width:100%;display:block;max-width:100%;border-radius:0;margin:0;border:0">` : ""}
    <div class="body">
      ${contentHtml}
    </div>
    <div class="foot">${config.email.footer}</div>
  </div>
</body>
</html>`;
}
