/**
 * InsightBox — amber-tinted callout.
 * `html` prop allows inline <b> tags for accent-coloured emphasis.
 */
export default function InsightBox({ html, children }) {
  if (html) {
    return <div className="insight" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <div className="insight">{children}</div>;
}
