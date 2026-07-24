import { useMemo } from 'react';
import { useData } from '../../context/DataContext';

function fmtPct(value) {
  return `${value.toFixed(1)}%`;
}

function rangeLabel(row) {
  return `${row.lower.toFixed(2)}–${row.upper.toFixed(2)}%`;
}

export default function FedWatch() {
  const { liveData, loading } = useData();
  const data = liveData?.fedWatch;
  const meetings = data?.meetings || [];
  const validMeetings = meetings.filter(meeting => !meeting.error);
  const nextMeeting = validMeetings[0];

  // Union of every rate range that appears across all meetings, so the table
  // has one consistent row set even as the distribution widens further out.
  const allRanges = useMemo(() => {
    const byUpper = new Map();
    validMeetings.forEach(meeting => {
      meeting.rows.forEach(row => {
        if (!byUpper.has(row.upper)) byUpper.set(row.upper, row);
      });
    });
    return [...byUpper.values()].sort((a, b) => b.upper - a.upper);
  }, [validMeetings]);

  return (
    <div className="macro-page">
      {data?.fetchedAt && (
        <div className="macro-update">
          CME 30-Day Fed Funds futures (derived) · refreshed {new Date(data.fetchedAt).toLocaleString()}
        </div>
      )}
      {!data && !loading && (
        <div className="macro-banner">Fed Watch data is unavailable. Use Refresh Data to retry.</div>
      )}
      {data && (
        <>
          <div className="cbox" style={{ marginBottom: 14 }}>
            <div className="ch-head">
              <div className="ch-title">Current target range</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
              {(data.currentTargetUpper.value - 0.25).toFixed(2)}–{data.currentTargetUpper.value.toFixed(2)}%
              <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ter)', marginLeft: 10 }}>
                EFFR {data.currentEffr.value.toFixed(2)}% as of {data.currentEffr.date}
              </span>
            </div>
          </div>

          {nextMeeting && (
            <div className="cbox" style={{ marginBottom: 14 }}>
              <div className="ch-head">
                <div className="ch-title">Next meeting — {nextMeeting.label}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {nextMeeting.rows.map(row => (
                  <div key={row.upper} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 100, fontSize: 12, fontFamily: 'var(--font-m)', color: 'var(--sec)' }}>
                      {rangeLabel(row)}
                    </div>
                    <div style={{ flex: 1, background: 'rgba(255,255,255,.06)', borderRadius: 4, height: 16 }}>
                      <div style={{ width: `${row.probability}%`, background: '#56b4e9', height: '100%', borderRadius: 4 }} />
                    </div>
                    <div style={{ width: 46, fontSize: 12, textAlign: 'right' }}>{fmtPct(row.probability)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="cbox">
            <div className="ch-head">
              <div className="ch-title">Target rate probabilities — aggregated</div>
            </div>
            <div className="ch-table-wrap">
              <table className="ch-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Rate range</th>
                    {meetings.map(meeting => (
                      <th key={meeting.date} title={meeting.error || undefined}>
                        {meeting.label.split(',')[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allRanges.map(range => (
                    <tr key={range.upper}>
                      <td style={{ textAlign: 'left' }}>{rangeLabel(range)}</td>
                      {meetings.map(meeting => {
                        const row = meeting.rows?.find(r => r.upper === range.upper);
                        return <td key={meeting.date}>{row ? fmtPct(row.probability) : '—'}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ch-source-row">
              <span className="ch-source-label">Source:</span>{' '}
              <span className="ch-src">CME 30-Day Fed Funds futures (ZQ) settlement prices, via Yahoo Finance</span>
            </div>
            <div className="src-note">{data.methodologyNote}</div>
          </div>
        </>
      )}
    </div>
  );
}
