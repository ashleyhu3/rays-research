import InlineLegend from './InlineLegend';
import InsightBox from './InsightBox';

/**
 * ChartCard — standard panel wrapper used by every view.
 *
 * Props:
 *  title      {string}              Card heading
 *  src        {string}              Data-source annotation (monospace, dim)
 *  subtitle   {string}              One-line description under the heading
 *  legend     {[label, color][]}    Colour-key items → <InlineLegend>
 *  insight    {string}              HTML string for the amber callout box
 *  srcNote    {string}              Small footnote at the bottom
 *  isNew      {boolean}             Amber border variant
 *  span2      {boolean}             Spans both grid columns
 *  height     {number}              Chart canvas height in px (default 200)
 *  children   {ReactNode}           The chart component
 */
export default function ChartCard({
  title, src, subtitle, legend, insight, srcNote,
  isNew, span2, height = 200, children,
}) {
  const cls = ['cbox', span2 && 'span2'].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <div className="ch-head">
        <div className="ch-title">{title}</div>
        {src && <div className="ch-src">{src}</div>}
      </div>
      {subtitle && <div className="ch-sub">{subtitle}</div>}
      {legend && <InlineLegend items={legend} />}
      <div style={{ position: 'relative', height }}>
        {children}
      </div>
      {insight && <InsightBox html={insight} />}
      {srcNote && <div className="src-note">{srcNote}</div>}
    </div>
  );
}
