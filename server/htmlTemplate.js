const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@300;400;500;600&family=Fira+Code:wght@400&family=Noto+Sans+TC:wght@400;500&display=swap';

/**
 * Returns the full HTML shell for the app.
 * @param {{ head?: string, body?: string }} opts
 */
module.exports = function htmlTemplate({ head = '', body = '' } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SIGNAL — AI Demand Tracker</title>
    <link href="${FONTS_URL}" rel="stylesheet" />
    ${head}
  </head>
  <body>
    <div id="root"></div>
    ${body}
  </body>
</html>`;
};
