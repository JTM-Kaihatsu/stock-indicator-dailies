import type { BacktestResult } from '@/types/backtest';

const money = (n: number) => `$${n.toFixed(2)}`;

export function TradeList({ result }: { result: BacktestResult }) {
  const { trades, stillHolding, finalValue } = result;
  if (trades.length === 0) {
    return <div className="settings-group-hint">No trades; the signal never left HOLD over this window.</div>;
  }
  return (
    <table className="trade-list">
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Price</th>
          <th>Portfolio value</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t, i) => (
          <tr key={i}>
            <td>{t.date}</td>
            <td className={t.type === 'BUY' ? 'sig-buy' : 'sig-sell'}>{t.type}</td>
            <td>{money(t.price)}</td>
            <td>{money(t.portfolioValue)}</td>
          </tr>
        ))}
        {stillHolding && (
          <tr className="trade-list-current">
            <td colSpan={3}>Current value, marked to market at the last close</td>
            <td>{money(finalValue)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
