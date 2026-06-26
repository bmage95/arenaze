// Analytics (admin) — ported from the design's Analytics charts, wired to
// /api/analytics/overview. Two charts: utilization by hour (value is already a
// percentage) and revenue over the last 7 days (paise, scaled to the max bar).
import { formatPaise } from '@arenaze/shared';
import { useAnalyticsOverview } from '../api/queries';
import { ApiError } from '../api/client';
import { Metric } from '../components/Metric';

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function Analytics() {
  const overviewQ = useAnalyticsOverview();

  if (overviewQ.isLoading) {
    return <div className="empty">Loading analytics…</div>;
  }
  if (overviewQ.isError) {
    const e = overviewQ.error;
    if (e instanceof ApiError && e.code === 'forbidden') {
      return <div className="empty">Admin access required</div>;
    }
    return <div className="empty">{e instanceof ApiError ? e.message : 'Failed to load analytics'}</div>;
  }

  const data = overviewQ.data;
  if (!data) return <div className="empty">No analytics</div>;

  const { metrics, utilByHour, revenueByDay } = data;
  const maxRev = Math.max(1, ...revenueByDay.map((d) => d.valuePaise));
  const weekTotal = revenueByDay.reduce((sum, d) => sum + d.valuePaise, 0);
  const avgHours = (metrics.avgSessionMinutes / 60).toFixed(1).replace(/\.0$/, '');

  return (
    <>
      <div className="metrics">
        <Metric k="Utilization · now" v={metrics.utilizationNow} unit="%" sub="live floor" subc="up" />
        <Metric
          k="Revenue · today"
          v={formatPaise(metrics.revenueTodayPaise, { compact: true })}
          sub="billed sessions"
        />
        <Metric k="Sessions · today" v={metrics.sessionsToday} sub="started today" />
        <Metric
          k="Avg. session"
          v={avgHours}
          unit="h"
          sub={`${formatPaise(metrics.avgTicketPaise)} avg ticket`}
        />
      </div>

      <div className="charts">
        <div className="chart">
          <div className="shead" style={{ margin: 0 }}>
            <div className="t" style={{ fontSize: 15 }}>
              Utilization by hour
            </div>
          </div>
          {utilByHour.length === 0 ? (
            <div className="empty">No data</div>
          ) : (
            <div className="bars">
              {utilByHour.map((x) => (
                <div key={x.hour} className="b" title={`${x.hour} · ${x.value}%`}>
                  <div className="col2" style={{ height: clamp(x.value) + '%' }} />
                  <div className="lb">{x.hour}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="chart">
          <div className="shead" style={{ margin: 0 }}>
            <div className="t" style={{ fontSize: 15 }}>
              Revenue · 7d
              <span className="ct" style={{ marginLeft: 8 }}>
                {formatPaise(weekTotal, { compact: true })}
              </span>
            </div>
          </div>
          {revenueByDay.length === 0 ? (
            <div className="empty">No data</div>
          ) : (
            <div className="bars">
              {revenueByDay.map((x) => (
                <div key={x.day} className="b alt" title={`${x.day} · ${formatPaise(x.valuePaise)}`}>
                  <div className="col2" style={{ height: (x.valuePaise / maxRev) * 100 + '%' }} />
                  <div className="lb">{x.day}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
