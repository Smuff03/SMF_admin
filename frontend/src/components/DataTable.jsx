import { Fragment } from 'react';

export default function DataTable({ columns, rows, ctx, expanded, renderExpanded }) {
  return (
    <div className="tw">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.label || c.key} className={c.className}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.id}>
              <tr>
                {columns.map((c) => (
                  <td key={c.label || c.key} className={c.className} data-label={c.label}>{c.render ? c.render(r, ctx) : r[c.key]}</td>
                ))}
              </tr>
              {expanded === r.id && renderExpanded && (
                <tr className="expand"><td colSpan={columns.length}>{renderExpanded(r, ctx)}</td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
